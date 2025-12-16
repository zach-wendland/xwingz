/**
 * FlightMode - Space combat with X-Wing vs TIE fighters
 * Handles both sandbox missions and Yavin defense scenario
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent, defineQuery } from "bitecs";
import { AssetLoader, KENNEY_ASSETS, createProceduralShip, type ShipType } from "@xwingz/render";
import {
  createRng,
  deriveSeed,
  getEncounter,
  getFighterArchetype,
  getMission,
  type MissionDef,
  type SystemDef,
  GalaxyCache
} from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  computeInterceptTime,
  createSpaceInput,
  type SpaceInputState,
  dogfightAISystem,
  getPlayerShip,
  getProjectiles,
  getTargetables,
  aiWeaponSystem,
  spaceflightSystem,
  spawnPlayerShip,
  targetingSystem,
  weaponSystem,
  projectileSystem,
  rebuildTargetSpatialHash,
  shieldRegenSystem,
  consumeImpactEvents,
  FighterBrain,
  Shield,
  Health,
  HitRadius,
  Team,
  Projectile,
  LaserWeapon,
  Ship,
  Targetable,
  Targeting,
  Transform,
  Velocity,
  torpedoLockSystem,
  torpedoFireSystem,
  torpedoProjectileSystem,
  weaponSwitchSystem,
  getTorpedoState,
  // Capital ship imports
  CapitalShipV2,
  Turret,
  Subsystem,
  capitalShipMovementSystem,
  capitalShipShieldSystem,
  turretTargetingSystem,
  turretRotationSystem,
  turretFireSystem,
  turretProjectileSystem,
  subsystemEffectsSystem,
  parentChildTransformSystem,
  spawnCapitalShipV2,
  removeCapitalShipV2,
  consumeTurretFireEvents,
  consumeSubsystemDestroyedEvents,
  rebuildFighterSpatialHash
} from "@xwingz/gameplay";

// Local copies of const enums (can't import const enums with verbatimModuleSyntax)
const SubsystemType = {
  Bridge: 0,
  ShieldGen: 1,
  Engines: 2,
  Targeting: 3,
  Power: 4,
  Hangar: 5
} as const;
const TurretType = {
  PointDefense: 0,
  Medium: 1,
  Heavy: 2,
  Ion: 3
} as const;
import type { ModeHandler, ModeContext, ModeTransitionData, FlightScenario } from "./types";
import { isFlightTransition } from "./types";
import { disposeObject } from "../rendering/MeshManager";
import {
  ExplosionManager,
  getBoltGeometry,
  getBoltMaterial,
  makeBoltGlow,
  buildStarfield
} from "../rendering/effects";
import { computePlayerStats } from "../state/UpgradeManager";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

type FlightHudElements = {
  speed: HTMLDivElement;
  throttle: HTMLDivElement;
  shield: HTMLDivElement;
  hp: HTMLDivElement;
  torpedo: HTMLDivElement;
  system: HTMLDivElement;
  faction: HTMLDivElement;
  credits: HTMLDivElement;
  target: HTMLDivElement;
  lock: HTMLDivElement;
  mission: HTMLDivElement;
  bracket: HTMLDivElement;
  lead: HTMLDivElement;
  landPrompt: HTMLDivElement;
  // Capital ship HUD
  capitalPanel: HTMLDivElement;
  capShieldFront: HTMLDivElement;
  capShieldRear: HTMLDivElement;
  capHullFore: HTMLDivElement;
  capHullMid: HTMLDivElement;
  capHullAft: HTMLDivElement;
  capSubsystems: HTMLDivElement;
};

type TerrainParams = {
  a1: number;
  f1: number;
  p1: number;
  a2: number;
  f2: number;
  p2: number;
  yOffset: number;
};

type MissionRuntime = {
  def: MissionDef;
  kills: number;
  wave: number;
  completed: boolean;
  message: string;
  messageTimer: number;
};

type YavinDefenseState = {
  phase: "launch" | "combat" | "success" | "fail";
  baseHpMax: number;
  enemiesTotal: number;
  enemiesKilled: number;
  rewardCredits: number;
  message: string;
  messageTimer: number;
};

type StarDestroyerMissionPhase = "approach" | "shields" | "subsystems" | "final" | "success" | "fail";

type StarDestroyerMissionState = {
  phase: StarDestroyerMissionPhase;
  starDestroyerEid: number;
  tieFighterCount: number;
  tieFightersKilled: number;
  subsystemsDestroyed: number;
  totalSubsystems: number;
  shieldsDown: boolean;
  rewardCredits: number;
  message: string;
  messageTimer: number;
};

type ScreenPoint = { x: number; y: number; onScreen: boolean; behind: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// FlightMode Handler
// ─────────────────────────────────────────────────────────────────────────────

export class FlightMode implements ModeHandler {
  // Scenario state
  private scenario: FlightScenario = "sandbox";
  private currentSystem: SystemDef | null = null;
  private jumpIndex = 0;
  private cache: GalaxyCache | null = null;

  // Scene objects
  private starfield: THREE.Points | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private treeTrunks: THREE.InstancedMesh | null = null;
  private treeCanopies: THREE.InstancedMesh | null = null;
  private terrainParams: TerrainParams | null = null;

  // Player
  private shipEid: number | null = null;
  private shipMesh: THREE.Object3D | null = null;
  private playerDead = false;
  private respawnTimer = 0;
  private readonly RESPAWN_DELAY = 2.0;

  // Base (Yavin)
  private baseEid: number | null = null;
  private baseMesh: THREE.Object3D | null = null;

  // Targets (enemies)
  private targetEids: number[] = [];
  private targetMeshes = new Map<number, THREE.Object3D>();

  // Allies
  private allyEids: number[] = [];
  private allyMeshes = new Map<number, THREE.Object3D>();

  // Projectiles
  private projectileMeshes = new Map<number, THREE.Mesh>();
  private boltForward = new THREE.Vector3(0, 0, 1);

  // Capital ships
  private capitalShipEids: number[] = [];
  private capitalShipMeshes = new Map<number, THREE.Object3D>();
  private turretMeshes = new Map<number, THREE.Object3D>();
  private subsystemMeshes = new Map<number, THREE.Object3D>();
  private turretProjectileMeshes = new Map<number, THREE.Mesh>();

  // Asset loading
  private assetLoader = new AssetLoader({ basePath: '/assets/models/' });
  private assetsReady = false;

  // Targeting / lock
  private lockValue = 0;
  private lockTargetEid = -1;

  // Mission state
  private mission: MissionRuntime | null = null;
  private yavin: YavinDefenseState | null = null;
  private starDestroyerMission: StarDestroyerMissionState | null = null;

  // Input
  private input: ReturnType<typeof createSpaceInput> | null = null;
  private simInput: SpaceInputState = {
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttleDelta: 0,
    boost: false,
    brake: false,
    firePrimary: false,
    fireSecondary: false,
    cycleTarget: false,
    hyperspace: false,
    toggleMap: false,
    switchWeapon: false,
    land: false
  };

  // Landing state
  private canLand = false;
  private readonly LANDING_ALTITUDE = 150; // altitude threshold for landing prompt
  private smPitch = 0;
  private smYaw = 0;
  private smRoll = 0;
  private smThrottleDelta = 0;

  // HUD
  private flightHud: FlightHudElements | null = null;

  // Camera
  private camInit = false;
  private camSmoothPos = new THREE.Vector3();
  private camSmoothLook = new THREE.Vector3();

  // VFX
  private explosions: ExplosionManager | null = null;

  // Temp vectors (reused to avoid allocations)
  private tmpMat = new THREE.Matrix4();
  private tmpNdc = new THREE.Vector3();
  private tmpHudTargetPos = new THREE.Vector3();
  private tmpHudLeadPos = new THREE.Vector3();
  private tmpHudQ = new THREE.Quaternion();
  private tmpHudForward = new THREE.Vector3();
  private tmpHudDir = new THREE.Vector3();
  private tmpTargetScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };
  private tmpLeadScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };
  private tmpCamOffset = new THREE.Vector3();
  private tmpLookOffset = new THREE.Vector3();
  private tmpLookAt = new THREE.Vector3();
  private tmpExplosionPos = new THREE.Vector3();
  private tmpProjVel = new THREE.Vector3();

  // ───────────────────────────────────────────────────────────────────────────
  // ModeHandler Interface
  // ───────────────────────────────────────────────────────────────────────────

  enter(ctx: ModeContext, data?: ModeTransitionData): void {
    ctx.controls.enabled = false;
    this.camInit = false;
    this.playerDead = false;
    this.respawnTimer = 0;
    this.mission = null;
    this.yavin = null;
    this.jumpIndex = 0;

    // Initialize cache for hyperspace
    this.cache = new GalaxyCache({ globalSeed: 42n }, { maxSectors: 256 });

    // Extract flight parameters from transition data
    if (isFlightTransition(data)) {
      this.scenario = data.scenario;
      this.currentSystem = data.system;
    } else {
      // Fallback if called without proper data
      this.scenario = "sandbox";
      this.currentSystem = null;
    }

    // Initialize explosion manager
    this.explosions = new ExplosionManager(ctx.scene);

    // Initialize input
    this.input = createSpaceInput(window);

    // Clear scene
    this.clearPlanetaryScene(ctx);
    ctx.scene.clear();

    // Preload 3D assets (async, will be ready for capital ship spawning)
    this.assetsReady = false;
    this.assetLoader.preload([
      KENNEY_ASSETS.TURRET_SINGLE,
      KENNEY_ASSETS.TURRET_DOUBLE,
    ]).then(() => {
      this.assetsReady = true;
      console.log('[FlightMode] Turret assets loaded');
    }).catch(err => {
      console.warn('[FlightMode] Failed to load turret assets, using procedural:', err);
    });

    // Setup lighting
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(200, 400, 150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 9000;
    sun.shadow.camera.left = -2400;
    sun.shadow.camera.right = 2400;
    sun.shadow.camera.top = 2400;
    sun.shadow.camera.bottom = -2400;
    ctx.scene.add(sun);
    ctx.scene.add(new THREE.PointLight(0x88aaff, 0.6, 0, 2));

    // Build scene based on scenario
    if (this.scenario === "yavin_defense" && this.currentSystem) {
      this.buildYavinPlanet(ctx, this.currentSystem.seed);
    } else if (this.scenario === "destroy_star_destroyer" && this.currentSystem) {
      this.buildLocalStarfield(ctx, this.currentSystem.seed);
    } else if (this.currentSystem) {
      this.buildLocalStarfield(ctx, this.currentSystem.seed);
    }

    // Spawn player
    this.respawnPlayer(ctx);

    // Start mission/scenario
    if (this.scenario === "yavin_defense" && this.currentSystem) {
      this.startYavinDefense(ctx, this.currentSystem);
    } else if (this.scenario === "destroy_star_destroyer" && this.currentSystem) {
      this.startStarDestroyerMission(ctx, this.currentSystem);
    } else if (this.currentSystem) {
      this.startMission(ctx, this.currentSystem);
    }

    // Camera
    ctx.camera.position.set(0, 6, 20);
    ctx.camera.lookAt(0, 0, -50);

    // Setup HUD
    this.setupFlightHud(ctx);
    this.updateFlightHud(ctx);
  }

  tick(ctx: ModeContext, dt: number): void {
    if (!this.input) {
      ctx.renderer.render(ctx.scene, ctx.camera);
      return;
    }

    // Update input with smoothing
    this.input.update();
    const a = clamp(dt * 8, 0, 1);
    this.smPitch += (this.input.state.pitch - this.smPitch) * a;
    this.smYaw += (this.input.state.yaw - this.smYaw) * a;
    this.smRoll += (this.input.state.roll - this.smRoll) * a;
    this.smThrottleDelta += (this.input.state.throttleDelta - this.smThrottleDelta) * a;

    this.simInput.pitch = this.smPitch;
    this.simInput.yaw = this.smYaw;
    this.simInput.roll = this.smRoll;
    this.simInput.throttleDelta = this.smThrottleDelta;
    this.simInput.boost = this.input.state.boost;
    this.simInput.brake = this.input.state.brake;
    this.simInput.firePrimary = this.input.state.firePrimary;
    this.simInput.cycleTarget = this.input.state.cycleTarget;
    this.simInput.hyperspace = this.input.state.hyperspace;
    this.simInput.toggleMap = this.input.state.toggleMap;
    this.simInput.fireSecondary = this.input.state.fireSecondary;
    this.simInput.switchWeapon = this.input.state.switchWeapon;
    this.simInput.land = this.input.state.land;

    // Check for mode exit
    if (this.simInput.toggleMap) {
      ctx.requestModeChange("map", { type: "map" });
      return;
    }

    // Landing detection (only in scenarios with terrain)
    if (this.scenario === "yavin_defense" && this.shipEid !== null) {
      const altitude = (Transform.y[this.shipEid] ?? 0) - this.yavinTerrainHeight(
        Transform.x[this.shipEid] ?? 0,
        Transform.z[this.shipEid] ?? 0
      );
      this.canLand = altitude < this.LANDING_ALTITUDE;

      // Handle landing request
      if (this.simInput.land && this.canLand) {
        const playerX = Transform.x[this.shipEid] ?? 0;
        const playerZ = Transform.z[this.shipEid] ?? 0;
        const groundY = this.yavinTerrainHeight(playerX, playerZ);

        ctx.requestModeChange("ground", {
          type: "ground_from_flight",
          landingPosition: {
            x: playerX,
            y: groundY,
            z: playerZ
          },
          playerState: {
            health: Health.hp[this.shipEid] ?? 100,
            maxHealth: Health.maxHp[this.shipEid] ?? 100,
            shields: Shield.sp[this.shipEid] ?? 0,
            maxShields: Shield.maxSp[this.shipEid] ?? 0
          },
          planetIndex: 0, // Yavin
          system: this.currentSystem // Pass system for return transition
        });
        return;
      }
    }

    // Handle Yavin restart
    if (
      this.scenario === "yavin_defense" &&
      this.currentSystem &&
      this.yavin &&
      (this.yavin.phase === "success" || this.yavin.phase === "fail") &&
      this.simInput.hyperspace
    ) {
      ctx.requestModeChange("flight", {
        type: "flight",
        system: this.currentSystem,
        scenario: "yavin_defense"
      });
      return;
    }

    // Block hyperspace in Yavin combat
    if (this.scenario === "yavin_defense" && this.yavin && this.yavin.phase === "combat" && this.simInput.hyperspace) {
      this.yavin.message = "HYPERSPACE DISABLED - COMPLETE OBJECTIVE";
      this.yavin.messageTimer = 2;
    }

    // Handle Star Destroyer restart
    if (
      this.scenario === "destroy_star_destroyer" &&
      this.currentSystem &&
      this.starDestroyerMission &&
      (this.starDestroyerMission.phase === "success" || this.starDestroyerMission.phase === "fail") &&
      this.simInput.hyperspace
    ) {
      ctx.requestModeChange("flight", {
        type: "flight",
        system: this.currentSystem,
        scenario: "destroy_star_destroyer"
      });
      return;
    }

    // Block hyperspace in Star Destroyer mission
    if (this.scenario === "destroy_star_destroyer" && this.starDestroyerMission &&
        this.starDestroyerMission.phase !== "success" && this.starDestroyerMission.phase !== "fail" &&
        this.simInput.hyperspace) {
      this.starDestroyerMission.message = "HYPERSPACE DISABLED - DESTROY THE STAR DESTROYER";
      this.starDestroyerMission.messageTimer = 2;
    }

    // Handle player death
    if (this.playerDead) {
      this.respawnTimer += dt;
      if (this.scenario !== "yavin_defense" && this.scenario !== "destroy_star_destroyer" &&
          this.respawnTimer >= this.RESPAWN_DELAY && this.currentSystem) {
        this.clearProjectiles(ctx);
        this.respawnPlayer(ctx);
        this.startMission(ctx, this.currentSystem);
        this.playerDead = false;
        this.respawnTimer = 0;
      }
      this.updateFlightHud(ctx, dt);
      this.explosions?.update(dt);
      ctx.renderer.render(ctx.scene, ctx.camera);
      return;
    }

    // Run game systems
    targetingSystem(ctx.world, this.simInput);
    dogfightAISystem(ctx.world, dt);
    spaceflightSystem(ctx.world, this.simInput, dt);
    weaponSystem(ctx.world, this.simInput, dt);
    aiWeaponSystem(ctx.world, dt);
    rebuildTargetSpatialHash(ctx.world);
    rebuildFighterSpatialHash(ctx.world); // For capital ship turret targeting
    projectileSystem(ctx.world, dt);
    weaponSwitchSystem(ctx.world, this.simInput);
    torpedoLockSystem(ctx.world, this.simInput, dt);
    torpedoFireSystem(ctx.world, this.simInput, dt);
    torpedoProjectileSystem(ctx.world, dt);
    shieldRegenSystem(ctx.world, dt);

    // Capital ship systems
    if (this.capitalShipEids.length > 0) {
      capitalShipMovementSystem(ctx.world, dt);
      capitalShipShieldSystem(ctx.world, dt);
      parentChildTransformSystem(ctx.world);
      turretTargetingSystem(ctx.world, dt);
      turretRotationSystem(ctx.world, dt);
      turretFireSystem(ctx.world, dt);
      turretProjectileSystem(ctx.world, dt);
      subsystemEffectsSystem(ctx.world, dt);
    }

    // Handle impacts
    const impacts = consumeImpactEvents();
    for (const hit of impacts) {
      const color = hit.team === 0 ? 0xff6666 : 0x77ff88;
      this.explosions?.spawn(
        this.tmpExplosionPos.set(hit.x, hit.y, hit.z),
        color,
        hit.killed ? 0.55 : 0.18,
        hit.killed ? 9 : 2.4
      );
    }

    // Check base destruction (Yavin)
    if (this.scenario === "yavin_defense" && this.yavin && this.yavin.phase === "combat") {
      const baseAlive =
        this.baseEid !== null &&
        hasComponent(ctx.world, Health, this.baseEid) &&
        (Health.hp[this.baseEid] ?? 0) > 0;
      if (!baseAlive) {
        this.yavin.phase = "fail";
        this.yavin.message = "MISSION FAILED - GREAT TEMPLE DESTROYED";
        this.yavin.messageTimer = 8;
        if (this.baseMesh) {
          this.explosions?.spawn(
            this.tmpExplosionPos.set(
              this.baseMesh.position.x,
              this.baseMesh.position.y + 45,
              this.baseMesh.position.z
            ),
            0xff4444
          );
          ctx.scene.remove(this.baseMesh);
          disposeObject(this.baseMesh);
          this.baseMesh = null;
        }
        ctx.scheduleSave();
      }
    }

    // Update Star Destroyer mission
    if (this.scenario === "destroy_star_destroyer" && this.starDestroyerMission) {
      this.updateStarDestroyerMission(ctx, dt);
    }

    // Check player death
    const player = getPlayerShip(ctx.world);
    if (player === null) {
      if (this.scenario === "yavin_defense" && this.yavin && this.yavin.phase === "combat") {
        this.yavin.phase = "fail";
        this.yavin.message = "MISSION FAILED - YOU WERE SHOT DOWN";
        this.yavin.messageTimer = 8;
        ctx.scheduleSave();
      }
      if (this.scenario === "destroy_star_destroyer" && this.starDestroyerMission &&
          this.starDestroyerMission.phase !== "success" && this.starDestroyerMission.phase !== "fail") {
        this.starDestroyerMission.phase = "fail";
        this.starDestroyerMission.message = "MISSION FAILED - YOU WERE SHOT DOWN";
        this.starDestroyerMission.messageTimer = 8;
        ctx.scheduleSave();
      }
      this.playerDead = true;
      this.respawnTimer = 0;
      this.clearProjectiles(ctx);
      if (this.shipMesh) {
        this.explosions?.spawn(this.tmpExplosionPos.copy(this.shipMesh.position), 0xff5555);
        ctx.scene.remove(this.shipMesh);
        disposeObject(this.shipMesh);
        this.shipMesh = null;
      }
      this.shipEid = null;
      this.updateFlightHud(ctx, dt);
      this.explosions?.update(dt);
      ctx.renderer.render(ctx.scene, ctx.camera);
      return;
    }

    // Terrain clamping (Yavin)
    if (this.scenario === "yavin_defense") {
      this.clampEntityAboveYavinTerrain(ctx, player, 6);
      for (const eid of this.allyEids) this.clampEntityAboveYavinTerrain(ctx, eid, 6);
      for (const eid of this.targetEids) this.clampEntityAboveYavinTerrain(ctx, eid, 6);
    }

    // Update player mesh
    if (player !== null && this.shipMesh) {
      this.shipMesh.position.set(Transform.x[player], Transform.y[player], Transform.z[player]);
      this.shipMesh.quaternion.set(
        Transform.qx[player],
        Transform.qy[player],
        Transform.qz[player],
        Transform.qw[player]
      );

      // Camera follow
      const q = this.shipMesh.quaternion;
      const pos = this.shipMesh.position;
      const boostFov = (Ship.throttle[player] ?? 0) > 0.9 && this.simInput.boost ? 6 : 0;
      ctx.camera.fov = 70 + boostFov;
      ctx.camera.updateProjectionMatrix();

      const camOffset = this.tmpCamOffset.set(0, 6, 22).applyQuaternion(q);
      const lookOffset = this.tmpLookOffset.set(0, 1.0, -48).applyQuaternion(q);
      const desiredPos = this.tmpLookAt.copy(pos).add(camOffset);
      const desiredLook = this.tmpExplosionPos.copy(pos).add(lookOffset);

      const k = 1 - Math.exp(-dt * 6.5);
      if (!this.camInit) {
        this.camSmoothPos.copy(desiredPos);
        this.camSmoothLook.copy(desiredLook);
        this.camInit = true;
      } else {
        this.camSmoothPos.lerp(desiredPos, k);
        this.camSmoothLook.lerp(desiredLook, k);
      }
      ctx.camera.position.copy(this.camSmoothPos);
      ctx.camera.lookAt(this.camSmoothLook);
    }

    // Sync meshes
    this.syncTargets(ctx);
    if (this.scenario === "yavin_defense" && this.yavin) {
      this.syncAllies(ctx);
    }

    // Spawn next wave if needed
    if (
      this.mission &&
      this.currentSystem &&
      !this.mission.completed &&
      this.mission.kills < this.mission.def.goalKills &&
      this.targetEids.length === 0
    ) {
      this.spawnMissionWave(ctx, this.currentSystem);
    }

    this.syncProjectiles(ctx);

    // Capital ship sync
    if (this.capitalShipEids.length > 0) {
      this.syncCapitalShips(ctx);
      this.syncTurretProjectiles(ctx);
    }

    // Hyperspace jump (sandbox only)
    if (this.scenario !== "yavin_defense" && this.scenario !== "destroy_star_destroyer" && this.simInput.hyperspace) {
      this.hyperspaceJump(ctx);
    }

    // Update timers
    if (this.mission && this.mission.messageTimer > 0) {
      this.mission.messageTimer = Math.max(0, this.mission.messageTimer - dt);
    }
    if (this.yavin && this.yavin.messageTimer > 0) {
      this.yavin.messageTimer = Math.max(0, this.yavin.messageTimer - dt);
    }
    if (this.starDestroyerMission && this.starDestroyerMission.messageTimer > 0) {
      this.starDestroyerMission.messageTimer = Math.max(0, this.starDestroyerMission.messageTimer - dt);
    }

    this.updateFlightHud(ctx, dt);
    this.explosions?.update(dt);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  exit(ctx: ModeContext): void {
    // Clear projectiles
    this.clearProjectiles(ctx);

    // Clear targets
    for (const eid of this.targetEids) {
      removeEntity(ctx.world, eid);
    }
    this.targetEids = [];
    for (const mesh of this.targetMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.targetMeshes.clear();

    // Clear allies
    this.clearAllies(ctx);

    // Clear player
    if (this.shipEid !== null) {
      removeEntity(ctx.world, this.shipEid);
      this.shipEid = null;
    }
    if (this.shipMesh) {
      ctx.scene.remove(this.shipMesh);
      disposeObject(this.shipMesh);
      this.shipMesh = null;
    }

    // Clear planetary scene
    this.clearPlanetaryScene(ctx);

    // Dispose starfield
    if (this.starfield) {
      ctx.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
      this.starfield = null;
    }

    // Dispose explosions
    this.explosions?.dispose();
    this.explosions = null;

    // Reset HUD
    this.flightHud = null;

    // Clear capital ships
    this.clearCapitalShips(ctx);

    // Reset state
    this.yavin = null;
    this.mission = null;
    this.starDestroyerMission = null;
    this.camInit = false;
    this.input = null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scene Building
  // ───────────────────────────────────────────────────────────────────────────

  private buildLocalStarfield(ctx: ModeContext, seed: bigint): void {
    if (this.starfield) {
      ctx.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
      this.starfield = null;
    }
    this.starfield = buildStarfield(seed);
    ctx.scene.add(this.starfield);
  }

  private buildYavinPlanet(ctx: ModeContext, seed: bigint): void {
    const rng = createRng(deriveSeed(seed, "yavin_terrain"));
    this.terrainParams = {
      a1: 34,
      f1: 0.0012 + rng.range(0, 0.0006),
      p1: rng.range(0, Math.PI * 2),
      a2: 18,
      f2: 0.0021 + rng.range(0, 0.001),
      p2: rng.range(0, Math.PI * 2),
      yOffset: -12
    };

    ctx.scene.fog = new THREE.Fog(0x05060b, 220, 5200);

    const size = 9000;
    const seg = 140;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      pos.setZ(i, this.yavinTerrainHeight(x, z) - (this.terrainParams?.yOffset ?? 0));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 1.0 });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = this.terrainParams.yOffset;
    this.groundMesh.receiveShadow = true;
    ctx.scene.add(this.groundMesh);

    // Trees
    const treeCount = 260;
    const trunkGeo = new THREE.CylinderGeometry(0.9, 1.3, 14, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1.0 });
    this.treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    this.treeTrunks.castShadow = true;
    this.treeTrunks.receiveShadow = true;

    const canopyGeo = new THREE.ConeGeometry(6.5, 18, 8);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1b5a34, roughness: 1.0 });
    this.treeCanopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    this.treeCanopies.castShadow = true;
    this.treeCanopies.receiveShadow = true;

    for (let i = 0; i < treeCount; i++) {
      let x = rng.range(-1800, 1800);
      let z = rng.range(-1800, 1800);
      if (Math.abs(x) < 260 && z > -200 && z < 520) {
        x += rng.range(260, 520) * Math.sign(x || 1);
        z += rng.range(120, 260);
      }

      const y = this.yavinTerrainHeight(x, z);
      const trunkY = y + 7;
      const canopyY = y + 20;
      const s = rng.range(0.85, 1.35);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));

      this.tmpMat.compose(new THREE.Vector3(x, trunkY, z), rot, new THREE.Vector3(s, s * rng.range(0.9, 1.25), s));
      this.treeTrunks.setMatrixAt(i, this.tmpMat);
      this.tmpMat.compose(new THREE.Vector3(x, canopyY, z), rot, new THREE.Vector3(s, s, s));
      this.treeCanopies.setMatrixAt(i, this.tmpMat);
    }
    this.treeTrunks.instanceMatrix.needsUpdate = true;
    this.treeCanopies.instanceMatrix.needsUpdate = true;
    ctx.scene.add(this.treeTrunks);
    ctx.scene.add(this.treeCanopies);

    // Great Temple
    this.baseMesh = this.buildGreatTemple();
    this.baseMesh.position.y = this.yavinTerrainHeight(0, 0);
    this.baseMesh.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    ctx.scene.add(this.baseMesh);
  }

  private buildGreatTemple(): THREE.Group {
    const group = new THREE.Group();

    const stone = new THREE.MeshStandardMaterial({ color: 0x5f646e, metalness: 0.0, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0f1015, roughness: 1.0 });

    const step1 = new THREE.Mesh(new THREE.BoxGeometry(320, 34, 260), stone);
    step1.position.y = 17;
    const step2 = new THREE.Mesh(new THREE.BoxGeometry(260, 30, 210), stone);
    step2.position.y = 34 + 15;
    const step3 = new THREE.Mesh(new THREE.BoxGeometry(200, 28, 160), stone);
    step3.position.y = 34 + 30 + 14;
    const top = new THREE.Mesh(new THREE.BoxGeometry(150, 24, 110), stone);
    top.position.y = 34 + 30 + 28 + 12;

    const hangar = new THREE.Mesh(new THREE.BoxGeometry(140, 50, 26), dark);
    hangar.position.set(0, 22, 130);

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(160, 3, 220),
      new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.8 })
    );
    pad.position.set(0, 1.5, 250);

    group.add(step1, step2, step3, top, hangar, pad);
    return group;
  }

  private clearPlanetaryScene(ctx: ModeContext): void {
    if (this.groundMesh) {
      ctx.scene.remove(this.groundMesh);
      disposeObject(this.groundMesh);
      this.groundMesh = null;
    }
    if (this.treeTrunks) {
      ctx.scene.remove(this.treeTrunks);
      disposeObject(this.treeTrunks);
      this.treeTrunks = null;
    }
    if (this.treeCanopies) {
      ctx.scene.remove(this.treeCanopies);
      disposeObject(this.treeCanopies);
      this.treeCanopies = null;
    }
    if (this.baseMesh) {
      ctx.scene.remove(this.baseMesh);
      disposeObject(this.baseMesh);
      this.baseMesh = null;
    }
    if (this.baseEid !== null) {
      removeEntity(ctx.world, this.baseEid);
      this.baseEid = null;
    }
    this.terrainParams = null;
    ctx.scene.fog = null;
  }

  private yavinTerrainHeight(x: number, z: number): number {
    const p = this.terrainParams;
    if (!p) return 0;
    const h1 = Math.sin(x * p.f1 + p.p1) * Math.cos(z * p.f1 + p.p1) * p.a1;
    const h2 = Math.sin(x * p.f2 + p.p2) * Math.sin(z * p.f2 + p.p2) * p.a2;
    return h1 + h2 + p.yOffset;
  }

  private clampEntityAboveYavinTerrain(ctx: ModeContext, eid: number, clearance: number): void {
    if (!this.terrainParams) return;
    if (!hasComponent(ctx.world, Transform, eid)) return;

    const x = Transform.x[eid] ?? 0;
    const z = Transform.z[eid] ?? 0;
    const minY = this.yavinTerrainHeight(x, z) + clearance;
    const y0 = Transform.y[eid] ?? 0;
    if (y0 >= minY) return;

    Transform.y[eid] = minY;
    if (hasComponent(ctx.world, Velocity, eid) && (Velocity.vy[eid] ?? 0) < 0) {
      Velocity.vy[eid] = 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ship/Entity Building (using centralized ShipModels)
  // ───────────────────────────────────────────────────────────────────────────

  private buildEnemyMesh(id: string): THREE.Object3D {
    // Map archetype IDs to ShipType
    const shipTypeMap: Record<string, ShipType> = {
      "tie_ln": "tie_ln",
      "tie_fighter": "tie_fighter",
      "tie_interceptor": "tie_interceptor",
      "xwing": "xwing",
      "ywing": "ywing",
      "awing": "awing",
    };

    const shipType = shipTypeMap[id] ?? "tie_ln";
    return createProceduralShip({ type: shipType, enableShadows: true });
  }

  private buildAllyMesh(slot = 0): THREE.Group {
    const tint = slot % 3 === 0 ? 0x9bb7ff : slot % 3 === 1 ? 0xbfffd0 : 0xffd29b;
    return createProceduralShip({ type: "xwing", tint, enableShadows: true });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Capital Ship Meshes (Star Destroyer uses centralized ShipModels)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Build a turret mesh for capital ships.
   * Uses loaded GLB models when available, falls back to procedural geometry.
   */
  private buildTurretMesh(turretType: number): THREE.Group {
    // Scale based on turret type
    const scale = turretType === TurretType.Heavy ? 1.5 :
                  turretType === TurretType.Medium ? 1.0 : 0.6;

    // Use double turret for Medium/Heavy, single for PointDefense/Light
    const useDoubleTurret = turretType === TurretType.Medium || turretType === TurretType.Heavy;
    const assetKey = useDoubleTurret ? KENNEY_ASSETS.TURRET_DOUBLE : KENNEY_ASSETS.TURRET_SINGLE;

    // Try to use loaded GLB model
    if (this.assetsReady && this.assetLoader.isCached(assetKey)) {
      const model = this.assetLoader.clone(assetKey);
      // Scale to match game units (Kenney models are small, need scaling)
      model.scale.setScalar(scale * 2.5);
      // Rotate to face forward (adjust as needed for model orientation)
      model.rotation.x = -Math.PI / 2;
      return model;
    }

    // Fallback to procedural geometry
    return this.buildProceduralTurretMesh(turretType, scale);
  }

  /**
   * Procedural turret mesh (fallback when GLB not loaded).
   */
  private buildProceduralTurretMesh(turretType: number, scale: number): THREE.Group {
    const group = new THREE.Group();

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4a4f5c,
      metalness: 0.4,
      roughness: 0.6
    });
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x2a2d36,
      metalness: 0.5,
      roughness: 0.5
    });

    // Turret base
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5 * scale, 2 * scale, 1 * scale, 8),
      baseMat
    );
    base.castShadow = true;
    group.add(base);

    // Barrel(s)
    const barrelGeo = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 4 * scale, 6);
    const barrelCount = turretType === TurretType.PointDefense ? 2 :
                        turretType === TurretType.Medium ? 2 : 1;

    for (let i = 0; i < barrelCount; i++) {
      const barrel = new THREE.Mesh(barrelGeo, barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set((i - (barrelCount - 1) / 2) * 0.8 * scale, 0.5 * scale, -2 * scale);
      barrel.castShadow = true;
      group.add(barrel);
    }

    return group;
  }

  /**
   * Build subsystem indicator mesh (glowing target point).
   */
  private buildSubsystemMesh(type: number): THREE.Group {
    const group = new THREE.Group();

    const colors: Record<number, number> = {
      [SubsystemType.Bridge]: 0xff3344,
      [SubsystemType.ShieldGen]: 0x44aaff,
      [SubsystemType.Engines]: 0xff8833,
      [SubsystemType.Targeting]: 0xffff44,
      [SubsystemType.Power]: 0x44ff44,
      [SubsystemType.Hangar]: 0xaa44ff
    };

    const color = colors[type] ?? 0xffffff;

    // Glowing indicator sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.7
      })
    );
    group.add(sphere);

    // Rotating ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.5, 0.15, 8, 16),
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8
      })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    return group;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Player Spawning
  // ───────────────────────────────────────────────────────────────────────────

  private respawnPlayer(ctx: ModeContext): void {
    if (this.shipEid !== null) {
      removeEntity(ctx.world, this.shipEid);
    }
    if (this.shipMesh) {
      ctx.scene.remove(this.shipMesh);
      disposeObject(this.shipMesh);
      this.shipMesh = null;
    }

    this.shipEid = spawnPlayerShip(ctx.world);
    this.applyUpgradesToPlayer(ctx, true);
    // Use the centralized ship model system
    this.shipMesh = createProceduralShip({ type: "xwing_player", enableShadows: true });
    ctx.scene.add(this.shipMesh);
    this.camInit = false;
    this.lockValue = 0;
    this.lockTargetEid = -1;
  }

  private applyUpgradesToPlayer(ctx: ModeContext, refill = false): void {
    if (this.shipEid === null) return;
    const stats = computePlayerStats(ctx.profile.upgrades);

    Ship.maxSpeed[this.shipEid] = stats.maxSpeed;
    Ship.accel[this.shipEid] = stats.accel;
    Ship.turnRate[this.shipEid] = stats.turnRate;

    LaserWeapon.damage[this.shipEid] = stats.damage;
    LaserWeapon.cooldown[this.shipEid] = stats.weaponCooldown;
    LaserWeapon.projectileSpeed[this.shipEid] = stats.projectileSpeed;
    LaserWeapon.cooldownRemaining[this.shipEid] = Math.min(
      LaserWeapon.cooldownRemaining[this.shipEid] ?? 0,
      stats.weaponCooldown
    );

    Shield.maxSp[this.shipEid] = stats.maxSp;
    Shield.regenRate[this.shipEid] = stats.regen;
    if (refill) Shield.sp[this.shipEid] = stats.maxSp;

    Health.maxHp[this.shipEid] = stats.maxHp;
    if (refill) Health.hp[this.shipEid] = stats.maxHp;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public getters for E2E testing
  // ───────────────────────────────────────────────────────────────────────────

  get targetCount(): number {
    return this.targetEids.length;
  }

  get allyCount(): number {
    return this.allyEids.length;
  }

  get projectileCount(): number {
    return this.projectileMeshes.size;
  }

  get currentScenario(): FlightScenario {
    return this.scenario;
  }

  get yavinPhase(): string | null {
    return this.yavin?.phase ?? null;
  }

  get starDestroyerPhase(): string | null {
    return this.starDestroyerMission?.phase ?? null;
  }

  get capitalShipCount(): number {
    return this.capitalShipEids.length;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // E2E Test Helpers (only for automated testing)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Kill all enemy targets - for e2e testing only
   * Removes entities to trigger death detection in syncTargets
   */
  killAllEnemiesForTest(world: import("bitecs").IWorld): void {
    for (const eid of this.targetEids) {
      removeEntity(world, eid);
    }
    // Clear the targetEids array to trigger phase transitions
    this.targetEids = [];
    // Update yavin kill count if in yavin mission
    if (this.yavin && this.yavin.phase === "combat") {
      this.yavin.enemiesKilled = this.yavin.enemiesTotal;
    }
    // Update SD mission kill count
    if (this.starDestroyerMission) {
      this.starDestroyerMission.tieFightersKilled = this.starDestroyerMission.tieFighterCount;
    }
  }

  /**
   * Destroy the base - for e2e testing only
   */
  failBaseForTest(world: import("bitecs").IWorld): void {
    if (this.baseEid !== null && hasComponent(world, Health, this.baseEid)) {
      Health.hp[this.baseEid] = 0;
    }
  }

  /**
   * Destroy the Star Destroyer - for e2e testing only
   */
  destroyStarDestroyerForTest(world: import("bitecs").IWorld): void {
    if (this.starDestroyerMission && this.capitalShipEids.length > 0) {
      const sdEid = this.starDestroyerMission.starDestroyerEid;
      if (hasComponent(world, CapitalShipV2, sdEid)) {
        // Set all hull sections to 0 to trigger destruction
        CapitalShipV2.hullFore[sdEid] = 0;
        CapitalShipV2.hullMid[sdEid] = 0;
        CapitalShipV2.hullAft[sdEid] = 0;
        // Remove the entity to trigger cleanup
        removeCapitalShipV2(world, sdEid);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Enemy/Ally Spawning
  // ───────────────────────────────────────────────────────────────────────────

  private spawnEnemyFighters(ctx: ModeContext, system: SystemDef, encounterKey = "v0"): void {
    // Clear existing
    for (const eid of this.targetEids) {
      removeEntity(ctx.world, eid);
    }
    for (const mesh of this.targetMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.targetEids = [];
    this.targetMeshes.clear();

    const encounter = getEncounter(system, encounterKey);
    const rng = createRng(encounter.seed);

    for (let i = 0; i < encounter.count; i++) {
      const archetypeId = encounter.archetypes[i] ?? "z95";
      const archetype = getFighterArchetype(archetypeId);

      const angle = rng.range(0, Math.PI * 2);
      const r = rng.range(encounter.spawnRing.min, encounter.spawnRing.max);
      const y = rng.range(-140, 140);
      const pos = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r - rng.range(300, 800));

      const eid = addEntity(ctx.world);
      addComponent(ctx.world, Transform, eid);
      addComponent(ctx.world, Velocity, eid);
      addComponent(ctx.world, AngularVelocity, eid);
      addComponent(ctx.world, Team, eid);
      addComponent(ctx.world, Ship, eid);
      addComponent(ctx.world, LaserWeapon, eid);
      addComponent(ctx.world, Targetable, eid);
      addComponent(ctx.world, Health, eid);
      addComponent(ctx.world, HitRadius, eid);
      addComponent(ctx.world, Shield, eid);
      addComponent(ctx.world, FighterBrain, eid);
      addComponent(ctx.world, AIControlled, eid);

      Transform.x[eid] = pos.x;
      Transform.y[eid] = pos.y;
      Transform.z[eid] = pos.z;
      Transform.qx[eid] = 0;
      Transform.qy[eid] = 0;
      Transform.qz[eid] = 0;
      Transform.qw[eid] = 1;

      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = 0;

      AngularVelocity.wx[eid] = 0;
      AngularVelocity.wy[eid] = 0;
      AngularVelocity.wz[eid] = 0;

      Team.id[eid] = 1;

      Ship.throttle[eid] = rng.range(0.6, 0.9);
      Ship.maxSpeed[eid] = archetype.maxSpeed;
      Ship.accel[eid] = archetype.accel;
      Ship.turnRate[eid] = archetype.turnRate;

      LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
      LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
      LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
      LaserWeapon.damage[eid] = archetype.damage;

      Health.hp[eid] = archetype.hp;
      Health.maxHp[eid] = archetype.hp;
      HitRadius.r[eid] = archetype.hitRadius;

      Shield.maxSp[eid] = archetypeId === "tie_ln" ? 10 : 25;
      Shield.sp[eid] = Shield.maxSp[eid];
      Shield.regenRate[eid] = 4;
      Shield.lastHit[eid] = 999;

      FighterBrain.state[eid] = 0;
      FighterBrain.stateTime[eid] = 0;
      FighterBrain.aggression[eid] = archetype.aggression;
      FighterBrain.evadeBias[eid] = archetype.evadeBias;
      FighterBrain.targetEid[eid] = -1;

      const mesh = this.buildEnemyMesh(archetypeId);
      mesh.position.copy(pos);
      ctx.scene.add(mesh);
      this.targetMeshes.set(eid, mesh);
      this.targetEids.push(eid);
    }
  }

  private spawnWingman(ctx: ModeContext, slot: number, x: number, z: number): void {
    if (!this.terrainParams) return;

    const archetype = getFighterArchetype("xwing_player");
    const eid = addEntity(ctx.world);
    addComponent(ctx.world, Transform, eid);
    addComponent(ctx.world, Velocity, eid);
    addComponent(ctx.world, AngularVelocity, eid);
    addComponent(ctx.world, Team, eid);
    addComponent(ctx.world, Ship, eid);
    addComponent(ctx.world, LaserWeapon, eid);
    addComponent(ctx.world, Health, eid);
    addComponent(ctx.world, HitRadius, eid);
    addComponent(ctx.world, Shield, eid);
    addComponent(ctx.world, FighterBrain, eid);
    addComponent(ctx.world, AIControlled, eid);

    const y = this.yavinTerrainHeight(x, z) + 7;
    Transform.x[eid] = x;
    Transform.y[eid] = y;
    Transform.z[eid] = z;
    Transform.qx[eid] = 0;
    Transform.qy[eid] = 1;
    Transform.qz[eid] = 0;
    Transform.qw[eid] = 0;

    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;
    Velocity.vz[eid] = 0;

    AngularVelocity.wx[eid] = 0;
    AngularVelocity.wy[eid] = 0;
    AngularVelocity.wz[eid] = 0;

    Team.id[eid] = 0;

    Ship.throttle[eid] = 0.45;
    Ship.maxSpeed[eid] = archetype.maxSpeed * 0.98;
    Ship.accel[eid] = archetype.accel * 0.95;
    Ship.turnRate[eid] = archetype.turnRate * 0.95;

    LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
    LaserWeapon.cooldownRemaining[eid] = 0;
    LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
    LaserWeapon.damage[eid] = archetype.damage;

    Health.hp[eid] = archetype.hp * 1.2;
    Health.maxHp[eid] = archetype.hp * 1.2;
    HitRadius.r[eid] = archetype.hitRadius;

    Shield.maxSp[eid] = 60;
    Shield.sp[eid] = 60;
    Shield.regenRate[eid] = 7;
    Shield.lastHit[eid] = 999;

    FighterBrain.state[eid] = 0;
    FighterBrain.stateTime[eid] = 0;
    FighterBrain.aggression[eid] = 0.85;
    FighterBrain.evadeBias[eid] = 0.4;
    FighterBrain.targetEid[eid] = -1;

    const mesh = this.buildAllyMesh(slot);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(2.45);
    ctx.scene.add(mesh);
    this.allyMeshes.set(eid, mesh);
    this.allyEids.push(eid);
  }

  private spawnYavinTieRaid(ctx: ModeContext, seed: bigint, count: number): void {
    const rng = createRng(deriveSeed(seed, "yavin_defense", "ties_v0"));
    const baseTarget = this.baseEid;

    for (let i = 0; i < count; i++) {
      const archetype = getFighterArchetype("tie_ln");
      const angle = rng.range(-0.4, 0.4);
      const x = rng.range(-600, 600);
      const z = -2400 + rng.range(-400, 300);
      const y = 220 + rng.range(0, 260);

      const eid = addEntity(ctx.world);
      addComponent(ctx.world, Transform, eid);
      addComponent(ctx.world, Velocity, eid);
      addComponent(ctx.world, AngularVelocity, eid);
      addComponent(ctx.world, Team, eid);
      addComponent(ctx.world, Ship, eid);
      addComponent(ctx.world, LaserWeapon, eid);
      addComponent(ctx.world, Targetable, eid);
      addComponent(ctx.world, Health, eid);
      addComponent(ctx.world, HitRadius, eid);
      addComponent(ctx.world, Shield, eid);
      addComponent(ctx.world, FighterBrain, eid);
      addComponent(ctx.world, AIControlled, eid);

      Transform.x[eid] = x;
      Transform.y[eid] = y;
      Transform.z[eid] = z;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + angle, 0));
      Transform.qx[eid] = q.x;
      Transform.qy[eid] = q.y;
      Transform.qz[eid] = q.z;
      Transform.qw[eid] = q.w;

      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = 0;

      AngularVelocity.wx[eid] = 0;
      AngularVelocity.wy[eid] = 0;
      AngularVelocity.wz[eid] = 0;

      Team.id[eid] = 1;

      Ship.throttle[eid] = rng.range(0.7, 0.95);
      Ship.maxSpeed[eid] = archetype.maxSpeed;
      Ship.accel[eid] = archetype.accel;
      Ship.turnRate[eid] = archetype.turnRate;

      LaserWeapon.cooldown[eid] = archetype.weaponCooldown * 1.3;
      LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
      LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
      LaserWeapon.damage[eid] = 5;

      Health.hp[eid] = 50;
      Health.maxHp[eid] = 50;
      HitRadius.r[eid] = archetype.hitRadius;

      Shield.maxSp[eid] = 8;
      Shield.sp[eid] = 8;
      Shield.regenRate[eid] = 2;
      Shield.lastHit[eid] = 999;

      FighterBrain.state[eid] = 0;
      FighterBrain.stateTime[eid] = 0;
      FighterBrain.aggression[eid] = 0.55;
      FighterBrain.evadeBias[eid] = 0.45;
      FighterBrain.targetEid[eid] = baseTarget !== null && i < Math.ceil(count * 0.25) ? baseTarget : -1;

      const mesh = this.buildEnemyMesh("tie_ln");
      mesh.position.set(x, y, z);
      ctx.scene.add(mesh);
      this.targetMeshes.set(eid, mesh);
      this.targetEids.push(eid);
    }
  }

  private clearAllies(ctx: ModeContext): void {
    for (const eid of this.allyEids) {
      if (hasComponent(ctx.world, Transform, eid)) removeEntity(ctx.world, eid);
    }
    this.allyEids = [];
    for (const mesh of this.allyMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.allyMeshes.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mission Handling
  // ───────────────────────────────────────────────────────────────────────────

  private startMission(ctx: ModeContext, system: SystemDef): void {
    this.mission = {
      def: getMission(system, ctx.profile.missionTier),
      kills: 0,
      wave: 0,
      completed: false,
      message: "",
      messageTimer: 0
    };
    this.spawnMissionWave(ctx, system);
  }

  private spawnMissionWave(ctx: ModeContext, system: SystemDef): void {
    if (!this.mission) return;
    const key = `${this.mission.def.id}:wave:${this.mission.wave}`;
    this.mission.wave += 1;
    this.spawnEnemyFighters(ctx, system, key);
  }

  private startYavinDefense(ctx: ModeContext, system: SystemDef): void {
    this.mission = null;
    this.yavin = {
      phase: "launch",
      baseHpMax: 2000,
      enemiesTotal: 6,
      enemiesKilled: 0,
      rewardCredits: 1000,
      message: "RED SQUADRON: LAUNCH! DEFEND THE GREAT TEMPLE.",
      messageTimer: 6
    };

    this.clearAllies(ctx);
    for (const eid of this.targetEids) removeEntity(ctx.world, eid);
    this.targetEids = [];
    for (const mesh of this.targetMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.targetMeshes.clear();

    // Base entity
    if (this.baseMesh) {
      const eid = addEntity(ctx.world);
      addComponent(ctx.world, Transform, eid);
      addComponent(ctx.world, Team, eid);
      addComponent(ctx.world, Health, eid);
      addComponent(ctx.world, HitRadius, eid);

      this.baseEid = eid;
      Team.id[eid] = 0;
      Health.hp[eid] = this.yavin.baseHpMax;
      Health.maxHp[eid] = this.yavin.baseHpMax;
      HitRadius.r[eid] = 140;

      Transform.x[eid] = this.baseMesh.position.x;
      Transform.y[eid] = this.baseMesh.position.y + 55;
      Transform.z[eid] = this.baseMesh.position.z + 30;
      Transform.qx[eid] = 0;
      Transform.qy[eid] = 0;
      Transform.qz[eid] = 0;
      Transform.qw[eid] = 1;
    }

    // Position player
    if (this.shipEid !== null && this.terrainParams) {
      const x = 0;
      const z = 340;
      const y = this.yavinTerrainHeight(x, z) + 7;
      Transform.x[this.shipEid] = x;
      Transform.y[this.shipEid] = y;
      Transform.z[this.shipEid] = z;
      Transform.qx[this.shipEid] = 0;
      Transform.qy[this.shipEid] = 1;
      Transform.qz[this.shipEid] = 0;
      Transform.qw[this.shipEid] = 0;
      Velocity.vx[this.shipEid] = 0;
      Velocity.vy[this.shipEid] = 0;
      Velocity.vz[this.shipEid] = 0;
      Ship.throttle[this.shipEid] = 0.35;
    }

    // Wingmen
    this.spawnWingman(ctx, 0, -22, 320);
    this.spawnWingman(ctx, 1, 22, 320);
    this.spawnWingman(ctx, 2, 0, 300);
    this.spawnWingman(ctx, 3, -40, 290);
    this.spawnWingman(ctx, 4, 40, 290);

    // TIE raid
    this.spawnYavinTieRaid(ctx, system.seed, this.yavin.enemiesTotal);

    this.yavin.phase = "combat";
    ctx.scheduleSave();
  }

  /**
   * Start the "Destroy Star Destroyer" mission.
   * Phase 1: Approach - Clear TIE fighter screen
   * Phase 2: Shields - Destroy shield generators
   * Phase 3: Subsystems - Target bridge/engines
   * Phase 4: Final - Hull damage, victory when destroyed
   */
  private startStarDestroyerMission(ctx: ModeContext, system: SystemDef): void {
    this.mission = null;
    this.yavin = null;
    this.clearCapitalShips(ctx);

    // Clear existing enemies
    for (const eid of this.targetEids) removeEntity(ctx.world, eid);
    this.targetEids = [];
    for (const mesh of this.targetMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.targetMeshes.clear();

    // Spawn the Star Destroyer at a visible distance (team 1 = enemy)
    // Positioned at -600 so it's visible (now 5x scaled = ~400 units long)
    const sdResult = this.spawnStarDestroyer(ctx, 0, 80, -600, 1);

    // Initialize mission state
    this.starDestroyerMission = {
      phase: "approach",
      starDestroyerEid: sdResult.shipEid,
      tieFighterCount: 8,
      tieFightersKilled: 0,
      subsystemsDestroyed: 0,
      totalSubsystems: sdResult.subsystemEids.length,
      shieldsDown: false,
      rewardCredits: 2500,
      message: "APPROACH THE STAR DESTROYER. CLEAR THE TIE FIGHTER SCREEN.",
      messageTimer: 6
    };

    // Spawn TIE fighter escort
    this.spawnStarDestroyerEscort(ctx, system.seed, this.starDestroyerMission.tieFighterCount);

    // Position player facing the Star Destroyer
    if (this.shipEid !== null) {
      Transform.x[this.shipEid] = 0;
      Transform.y[this.shipEid] = 80; // Same height as SD
      Transform.z[this.shipEid] = 400; // Safe distance in front
      // Rotate 180° around Y to face -Z (toward the Star Destroyer)
      Transform.qx[this.shipEid] = 0;
      Transform.qy[this.shipEid] = 1; // 180° Y rotation
      Transform.qz[this.shipEid] = 0;
      Transform.qw[this.shipEid] = 0;
      Velocity.vx[this.shipEid] = 0;
      Velocity.vy[this.shipEid] = 0;
      Velocity.vz[this.shipEid] = 0;
      Ship.throttle[this.shipEid] = 0.5;
    }

    ctx.scheduleSave();
  }

  /**
   * Spawn TIE fighter escort for the Star Destroyer mission.
   */
  private spawnStarDestroyerEscort(ctx: ModeContext, seed: bigint, count: number): void {
    const rng = createRng(deriveSeed(seed, "sd_escort", "ties_v0"));

    for (let i = 0; i < count; i++) {
      const archetype = getFighterArchetype("tie_ln");
      const angle = (i / count) * Math.PI * 2;
      const radius = 100 + rng.range(0, 80);
      const x = Math.cos(angle) * radius;
      const z = -100 + Math.sin(angle) * 50; // Between player (400) and SD (-600)
      const y = 80 + rng.range(-30, 30); // Near SD height

      const eid = addEntity(ctx.world);
      addComponent(ctx.world, Transform, eid);
      addComponent(ctx.world, Velocity, eid);
      addComponent(ctx.world, AngularVelocity, eid);
      addComponent(ctx.world, Team, eid);
      addComponent(ctx.world, Ship, eid);
      addComponent(ctx.world, LaserWeapon, eid);
      addComponent(ctx.world, Targetable, eid);
      addComponent(ctx.world, Health, eid);
      addComponent(ctx.world, HitRadius, eid);
      addComponent(ctx.world, Shield, eid);
      addComponent(ctx.world, FighterBrain, eid);
      addComponent(ctx.world, AIControlled, eid);

      Transform.x[eid] = x;
      Transform.y[eid] = y;
      Transform.z[eid] = z;
      // Face toward player
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
      Transform.qx[eid] = q.x;
      Transform.qy[eid] = q.y;
      Transform.qz[eid] = q.z;
      Transform.qw[eid] = q.w;

      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = 0;

      AngularVelocity.wx[eid] = 0;
      AngularVelocity.wy[eid] = 0;
      AngularVelocity.wz[eid] = 0;

      Team.id[eid] = 1; // Enemy team

      Ship.maxSpeed[eid] = archetype.maxSpeed;
      Ship.throttle[eid] = 0.8;
      Ship.accel[eid] = archetype.accel;
      Ship.turnRate[eid] = archetype.turnRate;

      LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
      LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
      LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
      LaserWeapon.damage[eid] = archetype.damage;

      Health.hp[eid] = archetype.hp;
      Health.maxHp[eid] = archetype.hp;
      HitRadius.r[eid] = archetype.hitRadius;

      Shield.maxSp[eid] = 0; // TIEs have no shields
      Shield.sp[eid] = 0;
      Shield.regenRate[eid] = 0;
      Shield.lastHit[eid] = 999;

      FighterBrain.state[eid] = 0;
      FighterBrain.stateTime[eid] = 0;
      FighterBrain.aggression[eid] = 0.9;
      FighterBrain.evadeBias[eid] = 0.3;
      FighterBrain.targetEid[eid] = this.shipEid ?? -1;

      this.targetEids.push(eid);

      // Create mesh
      const mesh = this.buildEnemyMesh("tie_ln");
      mesh.position.set(x, y, z);
      ctx.scene.add(mesh);
      this.targetMeshes.set(eid, mesh);
    }

    rebuildFighterSpatialHash(ctx.world);
  }

  /**
   * Update Star Destroyer mission phases during tick.
   */
  private updateStarDestroyerMission(ctx: ModeContext, dt: number): void {
    const m = this.starDestroyerMission;
    if (!m) return;

    // Update message timer
    if (m.messageTimer > 0) m.messageTimer -= dt;

    // Check if Star Destroyer is destroyed
    const sdAlive = hasComponent(ctx.world, CapitalShipV2, m.starDestroyerEid);
    if (!sdAlive && m.phase !== "success" && m.phase !== "fail") {
      m.phase = "success";
      m.message = "STAR DESTROYER DESTROYED! MISSION COMPLETE!";
      m.messageTimer = 8;
      ctx.profile.credits += m.rewardCredits;
      ctx.scheduleSave();
      return;
    }

    // Count alive TIEs
    const aliveTies = this.targetEids.filter(eid =>
      hasComponent(ctx.world, Ship, eid) &&
      hasComponent(ctx.world, Health, eid) &&
      (Health.hp[eid] ?? 0) > 0
    ).length;

    // Count destroyed subsystems
    const subsystemQuery = defineQuery([Subsystem]);
    const subsystems = subsystemQuery(ctx.world).filter((eid: number) => Subsystem.parentEid[eid] === m.starDestroyerEid);
    const destroyedSubsystems = subsystems.filter((eid: number) => Subsystem.disabled[eid] === 1).length;
    m.subsystemsDestroyed = destroyedSubsystems;

    // Check shields status
    const shieldGens = subsystems.filter((eid: number) =>
      Subsystem.subsystemType[eid] === SubsystemType.ShieldGen && Subsystem.disabled[eid] === 1
    );
    const totalShieldGens = subsystems.filter((eid: number) => Subsystem.subsystemType[eid] === SubsystemType.ShieldGen).length;
    m.shieldsDown = shieldGens.length >= 2 || (shieldGens.length >= 1 && totalShieldGens === 1);

    // Phase transitions
    switch (m.phase) {
      case "approach":
        // Transition to shields phase when TIEs cleared
        if (aliveTies === 0) {
          m.phase = "shields";
          m.message = "TIE SCREEN CLEARED! TARGET THE SHIELD GENERATORS!";
          m.messageTimer = 5;
        }
        break;

      case "shields":
        // Transition to subsystems when shields down
        if (m.shieldsDown) {
          m.phase = "subsystems";
          m.message = "SHIELDS DOWN! TARGET THE BRIDGE OR ENGINES!";
          m.messageTimer = 5;
        }
        break;

      case "subsystems":
        // Transition to final when key subsystems destroyed
        if (destroyedSubsystems >= 3) {
          m.phase = "final";
          m.message = "SUBSYSTEMS CRITICAL! ATTACK THE HULL!";
          m.messageTimer = 5;
        }
        break;

      case "final":
        // Victory handled above when SD destroyed
        break;

      case "success":
      case "fail":
        // Terminal states
        break;
    }
  }

  private hyperspaceJump(ctx: ModeContext): void {
    if (!this.currentSystem || !this.cache) return;

    const neighbors = this.cache
      .sectorsInRadius(this.currentSystem.sectorCoord, 1)
      .flatMap((sector) => sector.systems.map((_, i) => this.cache!.system(sector.coord, i)))
      .filter((s) => s.id !== this.currentSystem!.id);

    if (neighbors.length === 0) return;

    const jumpSeed = deriveSeed(this.currentSystem.seed, "jump", this.jumpIndex++);
    const rng = createRng(jumpSeed);
    const next = rng.pick(neighbors);
    this.currentSystem = next;

    this.buildLocalStarfield(ctx, next.seed);
    this.clearProjectiles(ctx);
    this.startMission(ctx, next);

    if (this.shipEid !== null) {
      Transform.x[this.shipEid] = 0;
      Transform.y[this.shipEid] = 0;
      Transform.z[this.shipEid] = 0;
      Velocity.vx[this.shipEid] = 0;
      Velocity.vy[this.shipEid] = 0;
      Velocity.vz[this.shipEid] = 0;
    }

    this.updateFlightHud(ctx);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mesh Syncing
  // ───────────────────────────────────────────────────────────────────────────

  private syncTargets(ctx: ModeContext): void {
    const aliveTargets = getTargetables(ctx.world);
    const aliveSet = new Set(aliveTargets);
    let killed = 0;

    for (const [eid, mesh] of this.targetMeshes) {
      if (aliveSet.has(eid)) continue;
      killed += 1;
      this.explosions?.spawn(this.tmpExplosionPos.copy(mesh.position));
      ctx.scene.remove(mesh);
      disposeObject(mesh);
      this.targetMeshes.delete(eid);
    }

    if (killed > 0 && !this.playerDead) {
      if (this.scenario === "sandbox" && this.mission && !this.mission.completed) {
        this.mission.kills += killed;
        ctx.profile.credits += killed * 5;

        if (this.mission.kills >= this.mission.def.goalKills) {
          this.mission.kills = this.mission.def.goalKills;
          this.mission.completed = true;
          ctx.profile.credits += this.mission.def.rewardCredits;
          ctx.profile.missionTier += 1;
          this.mission.message = `MISSION COMPLETE  +${this.mission.def.rewardCredits} CR`;
          this.mission.messageTimer = 4;
        }
        ctx.scheduleSave();
      }

      if (this.scenario === "yavin_defense" && this.yavin && this.yavin.phase === "combat") {
        this.yavin.enemiesKilled += killed;
        ctx.profile.credits += killed * 10;
        if (this.yavin.enemiesKilled >= this.yavin.enemiesTotal && aliveTargets.length === 0) {
          this.yavin.phase = "success";
          ctx.profile.credits += this.yavin.rewardCredits;
          this.yavin.message = `VICTORY  +${this.yavin.rewardCredits} CR`;
          this.yavin.messageTimer = 6;
          ctx.profile.missionTier += 1;
        }
        ctx.scheduleSave();
      }
    }

    this.targetEids = aliveTargets;
    for (const eid of aliveTargets) {
      const mesh = this.targetMeshes.get(eid);
      if (!mesh) continue;
      mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
      mesh.quaternion.set(
        Transform.qx[eid] ?? 0,
        Transform.qy[eid] ?? 0,
        Transform.qz[eid] ?? 0,
        Transform.qw[eid] ?? 1
      );
    }
  }

  private syncAllies(ctx: ModeContext): void {
    for (let i = this.allyEids.length - 1; i >= 0; i--) {
      const eid = this.allyEids[i]!;
      if (
        !hasComponent(ctx.world, Transform, eid) ||
        !hasComponent(ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        const mesh = this.allyMeshes.get(eid);
        if (mesh) {
          this.explosions?.spawn(this.tmpExplosionPos.copy(mesh.position), 0x66aaff);
          ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.allyMeshes.delete(eid);
        }
        this.allyEids.splice(i, 1);
        continue;
      }

      const mesh = this.allyMeshes.get(eid);
      if (!mesh) continue;
      mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
      mesh.quaternion.set(Transform.qx[eid] ?? 0, Transform.qy[eid] ?? 0, Transform.qz[eid] ?? 0, Transform.qw[eid] ?? 1);
    }
  }

  private syncProjectiles(ctx: ModeContext): void {
    const ps = getProjectiles(ctx.world);
    const alive = new Set(ps);
    const boltGeo = getBoltGeometry();

    for (const eid of ps) {
      let mesh = this.projectileMeshes.get(eid);
      if (!mesh) {
        const owner = Projectile.owner[eid] ?? -1;
        const ownerTeam = owner >= 0 && hasComponent(ctx.world, Team, owner) ? (Team.id[owner] ?? -1) : -1;
        const friendly = ownerTeam === 0;
        mesh = new THREE.Mesh(boltGeo, getBoltMaterial(friendly));
        mesh.rotation.x = Math.PI / 2;
        mesh.renderOrder = 8;
        mesh.add(makeBoltGlow(friendly ? 0xff6666 : 0x77ff88));
        ctx.scene.add(mesh);
        this.projectileMeshes.set(eid, mesh);

        if (owner === this.shipEid) {
          this.explosions?.spawn(
            this.tmpExplosionPos.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0),
            0xff6666,
            0.12,
            2.2
          );
        }
      }
      mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);

      this.tmpProjVel.set(Velocity.vx[eid] ?? 0, Velocity.vy[eid] ?? 0, Velocity.vz[eid] ?? 0);
      if (this.tmpProjVel.lengthSq() > 1e-4) {
        this.tmpProjVel.normalize();
        mesh.quaternion.setFromUnitVectors(this.boltForward, this.tmpProjVel);
      }
    }

    for (const [eid, mesh] of this.projectileMeshes) {
      if (alive.has(eid)) continue;
      ctx.scene.remove(mesh);
      disposeObject(mesh);
      this.projectileMeshes.delete(eid);
    }
  }

  private clearProjectiles(ctx: ModeContext): void {
    const ps = getProjectiles(ctx.world);
    for (const eid of ps) removeEntity(ctx.world, eid);
    for (const mesh of this.projectileMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.projectileMeshes.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Capital Ship Spawning & Sync
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Spawn an enemy Star Destroyer at the given position.
   * Turrets and subsystems are auto-generated based on ShipClass.Destroyer.
   */
  spawnStarDestroyer(
    ctx: ModeContext,
    x: number,
    y: number,
    z: number,
    team: number
  ): { shipEid: number; turretEids: number[]; subsystemEids: number[] } {
    const result = spawnCapitalShipV2(ctx.world, {
      shipClass: 3, // ShipClass.Destroyer
      team,
      x,
      y,
      z
    });

    // Create mesh using centralized ship model system
    const mesh = createProceduralShip({ type: "star_destroyer", scale: 5.0, enableShadows: true });
    mesh.position.set(x, y, z);
    ctx.scene.add(mesh);
    this.capitalShipMeshes.set(result.shipEid, mesh);
    this.capitalShipEids.push(result.shipEid);

    // Create turret meshes
    for (const tid of result.turretEids) {
      const turretType = Turret.turretType[tid] ?? 0;
      const turretMesh = this.buildTurretMesh(turretType);
      turretMesh.position.set(
        Transform.x[tid] ?? 0,
        Transform.y[tid] ?? 0,
        Transform.z[tid] ?? 0
      );
      ctx.scene.add(turretMesh);
      this.turretMeshes.set(tid, turretMesh);
    }

    // Create subsystem indicator meshes
    for (const sid of result.subsystemEids) {
      const type = Subsystem.subsystemType[sid] ?? 0;
      const subMesh = this.buildSubsystemMesh(type);
      subMesh.position.set(
        Transform.x[sid] ?? 0,
        Transform.y[sid] ?? 0,
        Transform.z[sid] ?? 0
      );
      ctx.scene.add(subMesh);
      this.subsystemMeshes.set(sid, subMesh);
    }

    return result;
  }

  /**
   * Sync capital ship, turret, and subsystem mesh positions.
   */
  private syncCapitalShips(ctx: ModeContext): void {
    // Sync capital ship hulls
    for (let i = this.capitalShipEids.length - 1; i >= 0; i--) {
      const eid = this.capitalShipEids[i]!;

      // Check if destroyed
      if (!hasComponent(ctx.world, CapitalShipV2, eid)) {
        const mesh = this.capitalShipMeshes.get(eid);
        if (mesh) {
          // Big explosion for capital ship destruction
          this.explosions?.spawn(
            this.tmpExplosionPos.copy(mesh.position),
            0xff8844,
            2.0,
            30
          );
          ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.capitalShipMeshes.delete(eid);
        }
        this.capitalShipEids.splice(i, 1);
        continue;
      }

      const mesh = this.capitalShipMeshes.get(eid);
      if (mesh) {
        mesh.position.set(
          Transform.x[eid] ?? 0,
          Transform.y[eid] ?? 0,
          Transform.z[eid] ?? 0
        );
        mesh.quaternion.set(
          Transform.qx[eid] ?? 0,
          Transform.qy[eid] ?? 0,
          Transform.qz[eid] ?? 0,
          Transform.qw[eid] ?? 1
        );
      }
    }

    // Sync turrets
    for (const [tid, mesh] of this.turretMeshes) {
      if (!hasComponent(ctx.world, Turret, tid)) {
        ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.turretMeshes.delete(tid);
        continue;
      }

      mesh.position.set(
        Transform.x[tid] ?? 0,
        Transform.y[tid] ?? 0,
        Transform.z[tid] ?? 0
      );
      // Turret rotation (combine parent rotation with local yaw/pitch)
      const yaw = Turret.yaw[tid] ?? 0;
      const pitch = Turret.pitch[tid] ?? 0;
      mesh.rotation.set(pitch, yaw, 0, "YXZ");
    }

    // Sync subsystems
    for (const [sid, mesh] of this.subsystemMeshes) {
      if (!hasComponent(ctx.world, Subsystem, sid)) {
        ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.subsystemMeshes.delete(sid);
        continue;
      }

      mesh.position.set(
        Transform.x[sid] ?? 0,
        Transform.y[sid] ?? 0,
        Transform.z[sid] ?? 0
      );

      // Rotate the indicator ring
      const ring = mesh.children[1];
      if (ring) {
        ring.rotation.z += 0.02;
      }

      // Hide disabled subsystems
      const disabled = Subsystem.disabled[sid] === 1;
      mesh.visible = !disabled;
    }
  }

  /**
   * Sync turret projectile meshes.
   */
  private syncTurretProjectiles(_ctx: ModeContext): void {
    // Consume fire events and spawn projectile meshes
    const fireEvents = consumeTurretFireEvents();
    for (const evt of fireEvents) {
      // Muzzle flash effect
      this.explosions?.spawn(
        this.tmpExplosionPos.set(evt.x, evt.y, evt.z),
        evt.team === 0 ? 0xff6666 : 0x44ff44,
        0.08,
        1.5
      );
    }

    // Consume subsystem destroyed events
    const destroyedEvents = consumeSubsystemDestroyedEvents();
    for (const evt of destroyedEvents) {
      this.explosions?.spawn(
        this.tmpExplosionPos.set(evt.x, evt.y, evt.z),
        0xff8844,
        0.6,
        8
      );
    }

    // Sync turret projectile meshes from TurretProjectile query
    // (Similar to syncProjectiles but for capital ship weapons)
    // For now, we rely on the turretProjectileSystem to handle collision
    // and the fire events for visual feedback
  }

  /**
   * Clear all capital ship meshes.
   */
  clearCapitalShips(ctx: ModeContext): void {
    for (const eid of this.capitalShipEids) {
      removeCapitalShipV2(ctx.world, eid);
    }
    this.capitalShipEids = [];

    for (const mesh of this.capitalShipMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.capitalShipMeshes.clear();

    for (const mesh of this.turretMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretMeshes.clear();

    for (const mesh of this.subsystemMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.subsystemMeshes.clear();

    for (const mesh of this.turretProjectileMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretProjectileMeshes.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HUD
  // ───────────────────────────────────────────────────────────────────────────

  private setupFlightHud(ctx: ModeContext): void {
    ctx.hud.className = "hud-xwing";
    ctx.hud.innerHTML = `
      <div class="hud-reticle">
        <div class="reticle-circle"></div>
        <div class="reticle-cross"></div>
      </div>
      <div class="hud-top">
        <div id="hud-target" class="hud-target">NO TARGET</div>
        <div id="hud-lock" class="hud-lock">LOCK 0%</div>
        <div id="hud-mission" class="hud-mission"></div>
      </div>
      <div id="hud-bracket" class="hud-bracket hidden"></div>
      <div id="hud-lead" class="hud-lead hidden"></div>
      <div id="hud-land-prompt" class="hud-land-prompt hidden">PRESS L TO LAND</div>
      <div class="hud-left">
        <div class="hud-label">SPD</div>
        <div id="hud-speed" class="hud-value">0</div>
        <div class="hud-label">THR</div>
        <div id="hud-throttle" class="hud-value">0%</div>
        <div class="hud-label">SHD</div>
        <div id="hud-shield" class="hud-value">0</div>
        <div class="hud-label">HP</div>
        <div id="hud-hp" class="hud-value">0</div>
        <div class="hud-label">TORP</div>
        <div id="hud-torpedo" class="hud-value">0/0</div>
      </div>
      <div class="hud-right">
        <div class="hud-label">SYS</div>
        <div id="hud-system" class="hud-value"></div>
        <div class="hud-label">FAC</div>
        <div id="hud-faction" class="hud-value"></div>
        <div class="hud-label">CR</div>
        <div id="hud-credits" class="hud-value">0</div>
      </div>
      <div class="hud-bottom">
        <div class="hud-label">HYPERSPACE: H</div>
        <div class="hud-label">TARGET: T</div>
        <div class="hud-label">MAP: M</div>
        <div class="hud-label">BOOST: SHIFT</div>
        <div class="hud-label">BRAKE: X</div>
        <div class="hud-label">TORP: C</div>
        <div class="hud-label">SWITCH: V</div>
        <div class="hud-label">UPGRADES: U</div>
      </div>
      <div id="hud-capital" class="hud-capital-panel hidden">
        <div class="hud-capital-title">IMPERIAL STAR DESTROYER</div>
        <div class="hud-shield-arc">
          <div class="hud-shield-section">
            <div class="hud-shield-label">FRONT SHIELD</div>
            <div class="hud-shield-bar"><div id="hud-cap-shield-front" class="hud-shield-fill" style="width:100%"></div></div>
          </div>
          <div class="hud-shield-section">
            <div class="hud-shield-label">REAR SHIELD</div>
            <div class="hud-shield-bar"><div id="hud-cap-shield-rear" class="hud-shield-fill" style="width:100%"></div></div>
          </div>
        </div>
        <div class="hud-capital-hull">
          <div class="hud-hull-section">
            <div class="hud-hull-label">FORE</div>
            <div class="hud-hull-bar"><div id="hud-cap-hull-fore" class="hud-hull-fill" style="width:100%"></div></div>
          </div>
          <div class="hud-hull-section">
            <div class="hud-hull-label">MID</div>
            <div class="hud-hull-bar"><div id="hud-cap-hull-mid" class="hud-hull-fill" style="width:100%"></div></div>
          </div>
          <div class="hud-hull-section">
            <div class="hud-hull-label">AFT</div>
            <div class="hud-hull-bar"><div id="hud-cap-hull-aft" class="hud-hull-fill" style="width:100%"></div></div>
          </div>
        </div>
        <div id="hud-cap-subsystems" class="hud-subsystem-list"></div>
      </div>
    `;

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = ctx.hud.querySelector<T>(sel);
      if (!el) throw new Error(`HUD element not found: ${sel}`);
      return el;
    };

    this.flightHud = {
      speed: q<HTMLDivElement>("#hud-speed"),
      throttle: q<HTMLDivElement>("#hud-throttle"),
      shield: q<HTMLDivElement>("#hud-shield"),
      hp: q<HTMLDivElement>("#hud-hp"),
      torpedo: q<HTMLDivElement>("#hud-torpedo"),
      system: q<HTMLDivElement>("#hud-system"),
      faction: q<HTMLDivElement>("#hud-faction"),
      credits: q<HTMLDivElement>("#hud-credits"),
      target: q<HTMLDivElement>("#hud-target"),
      lock: q<HTMLDivElement>("#hud-lock"),
      mission: q<HTMLDivElement>("#hud-mission"),
      bracket: q<HTMLDivElement>("#hud-bracket"),
      lead: q<HTMLDivElement>("#hud-lead"),
      landPrompt: q<HTMLDivElement>("#hud-land-prompt"),
      // Capital ship HUD
      capitalPanel: q<HTMLDivElement>("#hud-capital"),
      capShieldFront: q<HTMLDivElement>("#hud-cap-shield-front"),
      capShieldRear: q<HTMLDivElement>("#hud-cap-shield-rear"),
      capHullFore: q<HTMLDivElement>("#hud-cap-hull-fore"),
      capHullMid: q<HTMLDivElement>("#hud-cap-hull-mid"),
      capHullAft: q<HTMLDivElement>("#hud-cap-hull-aft"),
      capSubsystems: q<HTMLDivElement>("#hud-cap-subsystems")
    };
  }

  private updateFlightHud(ctx: ModeContext, dtSeconds = 1 / 60): void {
    const els = this.flightHud;
    if (!els) return;

    const yavinState = this.scenario === "yavin_defense" ? this.yavin : null;
    const baseHp =
      yavinState && this.baseEid !== null && hasComponent(ctx.world, Health, this.baseEid)
        ? Health.hp[this.baseEid] ?? 0
        : 0;

    if (this.shipEid === null) {
      els.speed.textContent = "0";
      els.throttle.textContent = "0%";
      els.shield.textContent = "0/0";
      els.hp.textContent = "0/0";
      els.torpedo.textContent = "0/0";
      if (this.currentSystem) {
        els.system.textContent = this.currentSystem.id;
        els.faction.textContent = this.currentSystem.controllingFaction;
      }
      els.credits.textContent = ctx.profile.credits.toString();
      if (yavinState) {
        if (yavinState.messageTimer > 0) {
          els.mission.textContent = yavinState.message;
        } else if (yavinState.phase === "success") {
          els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
        } else if (yavinState.phase === "fail") {
          els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
        } else {
          els.mission.textContent = `DEFEND GREAT TEMPLE: ${yavinState.enemiesKilled}/${yavinState.enemiesTotal}  BASE ${Math.max(0, baseHp).toFixed(0)}/${yavinState.baseHpMax}`;
        }
      } else if (this.starDestroyerMission) {
        const sdm = this.starDestroyerMission;
        if (sdm.messageTimer > 0) {
          els.mission.textContent = sdm.message;
        } else if (sdm.phase === "success") {
          els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
        } else if (sdm.phase === "fail") {
          els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
        } else {
          els.mission.textContent = `DESTROY STAR DESTROYER: PHASE ${sdm.phase.toUpperCase()}`;
        }
      } else {
        els.mission.textContent = this.mission ? this.mission.def.title : "";
      }
      els.target.textContent = this.playerDead ? "SHIP DESTROYED" : "NO TARGET";
      els.lock.textContent =
        this.playerDead && (yavinState || this.starDestroyerMission)
          ? "PRESS H TO RESTART"
          : this.playerDead
            ? "RESPAWNING..."
            : "LOCK 0%";
      els.bracket.classList.add("hidden");
      els.lead.classList.add("hidden");
      return;
    }

    const v = Math.hypot(
      Velocity.vx[this.shipEid],
      Velocity.vy[this.shipEid],
      Velocity.vz[this.shipEid]
    ) || 0;
    const t = Ship.throttle[this.shipEid] || 0;
    const sp = Shield.sp[this.shipEid] ?? 0;
    const maxSp = Shield.maxSp[this.shipEid] ?? 0;
    const hpSelf = Health.hp[this.shipEid] ?? 0;
    const maxHpSelf = Health.maxHp[this.shipEid] ?? 0;

    els.speed.textContent = v.toFixed(0);
    els.throttle.textContent = `${Math.round(t * 100)}%`;
    els.shield.textContent = `${sp.toFixed(0)}/${maxSp.toFixed(0)}`;
    els.hp.textContent = `${hpSelf.toFixed(0)}/${maxHpSelf.toFixed(0)}`;

    // Torpedo status
    const torpState = getTorpedoState(ctx.world);
    if (torpState) {
      const lockStr =
        torpState.lockProgress >= 1
          ? "LOCKED"
          : torpState.lockProgress > 0
            ? `${Math.round(torpState.lockProgress * 100)}%`
            : "";
      els.torpedo.textContent = `${torpState.ammo}/${torpState.maxAmmo}${lockStr ? " " + lockStr : ""}`;
      els.torpedo.style.color = torpState.lockProgress >= 1 ? "#ff4444" : "#88ff88";
    } else {
      els.torpedo.textContent = "0/0";
      els.torpedo.style.color = "#88ff88";
    }

    if (this.currentSystem) {
      els.system.textContent = this.currentSystem.id;
      els.faction.textContent = this.currentSystem.controllingFaction;
    }
    els.credits.textContent = ctx.profile.credits.toString();

    if (yavinState) {
      if (yavinState.messageTimer > 0) {
        els.mission.textContent = yavinState.message;
      } else if (yavinState.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (yavinState.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        els.mission.textContent = `DEFEND GREAT TEMPLE: ${yavinState.enemiesKilled}/${yavinState.enemiesTotal}  BASE ${Math.max(0, baseHp).toFixed(0)}/${yavinState.baseHpMax}`;
      }
    } else if (this.starDestroyerMission) {
      const sdm = this.starDestroyerMission;
      if (sdm.messageTimer > 0) {
        els.mission.textContent = sdm.message;
      } else if (sdm.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (sdm.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        const phaseText = sdm.phase === "approach" ? "CLEAR TIES" :
                         sdm.phase === "shields" ? "DESTROY SHIELDS" :
                         sdm.phase === "subsystems" ? "TARGET SUBSYSTEMS" : "ATTACK HULL";
        els.mission.textContent = `DESTROY STAR DESTROYER: ${phaseText}  ${sdm.subsystemsDestroyed}/${sdm.totalSubsystems} SYSTEMS`;
      }
    } else if (this.mission) {
      if (this.mission.messageTimer > 0) {
        els.mission.textContent = this.mission.message;
      } else if (this.mission.completed) {
        els.mission.textContent = "MISSION COMPLETE — PRESS H TO JUMP";
      } else {
        els.mission.textContent =
          `${this.mission.def.title}: ${this.mission.kills}/${this.mission.def.goalKills}  ` +
          `REWARD ${this.mission.def.rewardCredits} CR`;
      }
    } else {
      els.mission.textContent = "";
    }

    const teid = Targeting.targetEid[this.shipEid] ?? -1;
    if (teid !== this.lockTargetEid) {
      this.lockTargetEid = teid;
      this.lockValue = 0;
    }

    if (teid >= 0 && Transform.x[teid] !== undefined) {
      this.updateTargetBracket(ctx, teid, dtSeconds);
    } else {
      els.target.textContent = "NO TARGET";
      els.bracket.classList.add("hidden");
      els.lead.classList.add("hidden");
      this.lockValue = 0;
      this.lockTargetEid = -1;
      els.lock.textContent = "LOCK 0%";
    }

    // Landing prompt visibility
    els.landPrompt.classList.toggle("hidden", !this.canLand);

    // Capital ship HUD update
    this.updateCapitalShipHud(ctx);
  }

  private updateCapitalShipHud(ctx: ModeContext): void {
    const els = this.flightHud;
    if (!els) return;

    // Hide if no capital ships
    if (this.capitalShipEids.length === 0) {
      els.capitalPanel.classList.add("hidden");
      return;
    }

    // Get the first capital ship (could enhance to target-specific later)
    const shipEid = this.capitalShipEids[0]!;
    if (!hasComponent(ctx.world, CapitalShipV2, shipEid)) {
      els.capitalPanel.classList.add("hidden");
      return;
    }

    els.capitalPanel.classList.remove("hidden");

    // Shield bars
    const shieldFront = CapitalShipV2.shieldFront[shipEid] ?? 0;
    const shieldRear = CapitalShipV2.shieldRear[shipEid] ?? 0;
    const shieldMax = CapitalShipV2.shieldMax[shipEid] ?? 1;
    els.capShieldFront.style.width = `${(shieldFront / shieldMax) * 100}%`;
    els.capShieldRear.style.width = `${(shieldRear / shieldMax) * 100}%`;

    // Hull section bars
    const hullFore = CapitalShipV2.hullFore[shipEid] ?? 0;
    const hullMid = CapitalShipV2.hullMid[shipEid] ?? 0;
    const hullAft = CapitalShipV2.hullAft[shipEid] ?? 0;
    const hullForeMax = CapitalShipV2.hullForeMax[shipEid] ?? 1;
    const hullMidMax = CapitalShipV2.hullMidMax[shipEid] ?? 1;
    const hullAftMax = CapitalShipV2.hullAftMax[shipEid] ?? 1;

    const setHullBarClass = (el: HTMLDivElement, current: number, max: number) => {
      const pct = current / max;
      el.style.width = `${pct * 100}%`;
      el.className = "hud-hull-fill" + (pct < 0.25 ? " critical" : pct < 0.5 ? " damaged" : "");
    };

    setHullBarClass(els.capHullFore, hullFore, hullForeMax);
    setHullBarClass(els.capHullMid, hullMid, hullMidMax);
    setHullBarClass(els.capHullAft, hullAft, hullAftMax);

    // Update subsystems list
    const subsystemNames: Record<number, string> = {
      0: "BRIDGE",
      1: "SHIELD GEN",
      2: "ENGINES",
      3: "TARGETING",
      4: "POWER",
      5: "HANGAR"
    };
    const subsystemIcons: Record<number, string> = {
      0: "bridge",
      1: "shield",
      2: "engine",
      3: "targeting",
      4: "power",
      5: "hangar"
    };

    // Build subsystem list HTML
    let subsystemHtml = "";
    for (const [sid] of this.subsystemMeshes) {
      if (!hasComponent(ctx.world, Subsystem, sid)) continue;
      if ((Subsystem.parentEid[sid] ?? -1) !== shipEid) continue;

      const type = Subsystem.subsystemType[sid] ?? 0;
      const hp = Subsystem.hp[sid] ?? 0;
      const maxHp = Subsystem.maxHp[sid] ?? 1;
      const disabled = Subsystem.disabled[sid] === 1;
      const name = subsystemNames[type] ?? "UNKNOWN";
      const iconClass = subsystemIcons[type] ?? "power";
      const pct = Math.max(0, Math.round((hp / maxHp) * 100));

      subsystemHtml += `
        <div class="hud-subsystem${disabled ? " destroyed" : ""}">
          <div class="hud-subsystem-icon ${iconClass}"></div>
          <span>${name}</span>
          <span class="hud-subsystem-hp">${disabled ? "DISABLED" : pct + "%"}</span>
        </div>
      `;
    }
    els.capSubsystems.innerHTML = subsystemHtml;
  }

  private updateTargetBracket(ctx: ModeContext, teid: number, dtSeconds: number): void {
    const els = this.flightHud;
    if (!els || this.shipEid === null) return;

    const sx = Transform.x[this.shipEid] ?? 0;
    const sy = Transform.y[this.shipEid] ?? 0;
    const sz = Transform.z[this.shipEid] ?? 0;

    const tx = Transform.x[teid] ?? 0;
    const ty = Transform.y[teid] ?? 0;
    const tz = Transform.z[teid] ?? 0;

    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const hp = Health.hp[teid] ?? 0;
    els.target.textContent = `TGT ${teid}  ${dist.toFixed(0)}m  HP ${hp.toFixed(0)}`;

    // Bracket on target
    const screen = this.projectToScreen(ctx, this.tmpHudTargetPos.set(tx, ty, tz), this.tmpTargetScreen);
    els.bracket.classList.remove("hidden");
    els.bracket.classList.toggle("offscreen", !screen.onScreen);
    els.bracket.classList.toggle("behind", screen.behind);
    els.bracket.style.left = `${screen.x}px`;
    els.bracket.style.top = `${screen.y}px`;

    // Lead pip
    const projSpeed = LaserWeapon.projectileSpeed[this.shipEid] ?? 900;
    const tvx = Velocity.vx[teid] ?? 0;
    const tvy = Velocity.vy[teid] ?? 0;
    const tvz = Velocity.vz[teid] ?? 0;
    const svx = Velocity.vx[this.shipEid] ?? 0;
    const svy = Velocity.vy[this.shipEid] ?? 0;
    const svz = Velocity.vz[this.shipEid] ?? 0;
    const rvx = tvx - svx;
    const rvy = tvy - svy;
    const rvz = tvz - svz;
    const leadTime = computeInterceptTime(dx, dy, dz, rvx, rvy, rvz, projSpeed) ?? dist / projSpeed;
    const leadPos = this.tmpHudLeadPos.set(tx + tvx * leadTime, ty + tvy * leadTime, tz + tvz * leadTime);
    const leadScreen = this.projectToScreen(ctx, leadPos, this.tmpLeadScreen);
    els.lead.classList.toggle("hidden", !leadScreen.onScreen);
    if (leadScreen.onScreen) {
      els.lead.style.left = `${leadScreen.x}px`;
      els.lead.style.top = `${leadScreen.y}px`;
    }

    // Lock meter
    const q = this.tmpHudQ.set(
      Transform.qx[this.shipEid] ?? 0,
      Transform.qy[this.shipEid] ?? 0,
      Transform.qz[this.shipEid] ?? 0,
      Transform.qw[this.shipEid] ?? 1
    );
    const forward = this.tmpHudForward.set(0, 0, -1).applyQuaternion(q).normalize();
    const dir = this.tmpHudDir.set(dx, dy, dz).normalize();
    const dot = forward.dot(dir);
    const radius = HitRadius.r[teid] ?? 8;
    const sizeAngle = Math.atan2(radius, dist);
    const baseCone = 0.07;
    const cone = baseCone + sizeAngle;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const inCone = screen.onScreen && angle < cone && dist < 900;

    const lockGain = 1.8;
    const lockDecay = 0.6;
    this.lockValue += (inCone ? lockGain : -lockDecay) * dtSeconds;
    this.lockValue = Math.min(1, Math.max(0, this.lockValue));

    const pct = Math.round(this.lockValue * 100);
    els.lock.textContent = this.lockValue >= 1 ? "LOCK" : `LOCK ${pct}%`;
  }

  private projectToScreen(ctx: ModeContext, pos: THREE.Vector3, out: ScreenPoint): ScreenPoint {
    const v = this.tmpNdc.copy(pos).project(ctx.camera);
    const w = ctx.renderer.domElement.clientWidth || window.innerWidth;
    const h = ctx.renderer.domElement.clientHeight || window.innerHeight;

    let nx = v.x;
    let ny = v.y;
    const behind = v.z > 1;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }

    const onScreen = !behind && v.z > -1 && v.z < 1 && nx > -1 && nx < 1 && ny > -1 && ny < 1;

    const margin = 0.92;
    const cx = clamp(nx, -margin, margin);
    const cy = clamp(ny, -margin, margin);
    out.x = (cx * 0.5 + 0.5) * w;
    out.y = (-cy * 0.5 + 0.5) * h;
    out.onScreen = onScreen;
    out.behind = behind;
    return out;
  }
}
