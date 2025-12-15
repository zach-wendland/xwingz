/**
 * FlightMode - Space combat with X-Wing vs TIE fighters
 * Handles both sandbox missions and Yavin defense scenario
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";
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
  getTorpedoState
} from "@xwingz/gameplay";
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

  // Targeting / lock
  private lockValue = 0;
  private lockTargetEid = -1;

  // Mission state
  private mission: MissionRuntime | null = null;
  private yavin: YavinDefenseState | null = null;

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
    switchWeapon: false
  };
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
    } else if (this.currentSystem) {
      this.buildLocalStarfield(ctx, this.currentSystem.seed);
    }

    // Spawn player
    this.respawnPlayer(ctx);

    // Start mission/scenario
    if (this.scenario === "yavin_defense" && this.currentSystem) {
      this.startYavinDefense(ctx, this.currentSystem);
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

    // Check for mode exit
    if (this.simInput.toggleMap) {
      ctx.requestModeChange("map", { type: "map" });
      return;
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

    // Handle player death
    if (this.playerDead) {
      this.respawnTimer += dt;
      if (this.scenario !== "yavin_defense" && this.respawnTimer >= this.RESPAWN_DELAY && this.currentSystem) {
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
    projectileSystem(ctx.world, dt);
    weaponSwitchSystem(ctx.world, this.simInput);
    torpedoLockSystem(ctx.world, this.simInput, dt);
    torpedoFireSystem(ctx.world, this.simInput, dt);
    torpedoProjectileSystem(ctx.world, dt);
    shieldRegenSystem(ctx.world, dt);

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

    // Check player death
    const player = getPlayerShip(ctx.world);
    if (player === null) {
      if (this.scenario === "yavin_defense" && this.yavin && this.yavin.phase === "combat") {
        this.yavin.phase = "fail";
        this.yavin.message = "MISSION FAILED - YOU WERE SHOT DOWN";
        this.yavin.messageTimer = 8;
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

    // Hyperspace jump (sandbox)
    if (this.scenario !== "yavin_defense" && this.simInput.hyperspace) {
      this.hyperspaceJump(ctx);
    }

    // Update timers
    if (this.mission && this.mission.messageTimer > 0) {
      this.mission.messageTimer = Math.max(0, this.mission.messageTimer - dt);
    }
    if (this.yavin && this.yavin.messageTimer > 0) {
      this.yavin.messageTimer = Math.max(0, this.yavin.messageTimer - dt);
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

    // Reset state
    this.yavin = null;
    this.mission = null;
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
  // Ship/Entity Building
  // ───────────────────────────────────────────────────────────────────────────

  private buildShipMesh(): THREE.Group {
    const group = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, metalness: 0.25, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x171a25, metalness: 0.2, roughness: 0.85 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xb02a2a, roughness: 0.7 });
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b8, metalness: 0.35, roughness: 0.5 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.45, roughness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0c0f18,
      roughness: 0.1,
      metalness: 0.0,
      transparent: true,
      opacity: 0.6
    });
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x44bbff,
      emissive: 0x44ccff,
      emissiveIntensity: 6.0,
      roughness: 0.15
    });

    // Fuselage
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10.8, 12), hullMat);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.castShadow = true;
    group.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.8, 12), hullMat);
    nose.position.z = -7.2;
    nose.rotation.x = Math.PI;
    nose.castShadow = true;
    group.add(nose);

    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.05, 2.4), darkMat);
    intake.position.set(0, -0.1, -1.0);
    intake.castShadow = true;
    group.add(intake);

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 12), glassMat);
    canopy.position.set(0, 0.55, -2.0);
    canopy.scale.set(1.1, 0.75, 1.35);
    canopy.castShadow = true;
    group.add(canopy);

    // Astromech dome
    const droid = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), hullMat);
    dome.position.y = 0.2;
    dome.castShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 10), hullMat);
    cap.castShadow = true;
    droid.add(cap, dome);
    droid.position.set(0.75, 0.45, 0.9);
    group.add(droid);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.8), redMat);
    stripe.position.set(-1.95, 0.2, -1.0);
    stripe.castShadow = true;
    group.add(stripe);

    // S-foils
    const wingAngle = 0.52;
    const wingGeo = new THREE.BoxGeometry(7.8, 0.14, 1.9);
    const engineGeo = new THREE.CylinderGeometry(0.44, 0.44, 3.4, 10);
    const nozzleGeo = new THREE.CylinderGeometry(0.26, 0.32, 0.42, 10);
    const cannonGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8);

    const makeWing = (side: -1 | 1, up: -1 | 1) => {
      const w = new THREE.Group();
      w.rotation.z = up * wingAngle;

      const wing = new THREE.Mesh(wingGeo, darkMat);
      wing.position.set(side * 4.0, 0, -1.2);
      wing.castShadow = true;
      w.add(wing);

      const engine = new THREE.Mesh(engineGeo, engineMat);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 6.55, 0, 0.2);
      engine.castShadow = true;
      w.add(engine);

      const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * 6.55, 0, 1.95);
      w.add(nozzle);

      const glow = makeBoltGlow(0x66aaff);
      glow.position.set(side * 6.55, 0, 2.25);
      glow.scale.setScalar(4.4);
      w.add(glow);

      const cannon = new THREE.Mesh(cannonGeo, gunMat);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(side * 7.15, 0, -5.25);
      cannon.castShadow = true;
      w.add(cannon);

      return w;
    };

    group.add(makeWing(1, 1), makeWing(-1, 1), makeWing(1, -1), makeWing(-1, -1));

    return group;
  }

  private buildEnemyMesh(id: string): THREE.Object3D {
    if (id === "tie_ln") {
      const group = new THREE.Group();
      const cockpit = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.25, roughness: 0.6 })
      );
      cockpit.castShadow = true;
      group.add(cockpit);
      const panelGeo = new THREE.BoxGeometry(0.6, 6.5, 6.5);
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c23, metalness: 0.2, roughness: 0.7 });
      const left = new THREE.Mesh(panelGeo, panelMat);
      left.position.x = -4.2;
      left.castShadow = true;
      const right = new THREE.Mesh(panelGeo, panelMat);
      right.position.x = 4.2;
      right.castShadow = true;

      const strutGeo = new THREE.BoxGeometry(2.8, 0.35, 0.35);
      const strutMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.25, roughness: 0.6 });
      const strut = new THREE.Mesh(strutGeo, strutMat);
      strut.castShadow = true;

      const glow = makeBoltGlow(0x66ff88);
      glow.position.z = 3.0;
      glow.scale.setScalar(5.2);

      group.add(left, right, strut, glow);
      return group;
    }

    const group = this.buildShipMesh();
    group.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.material) {
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(0x8a8f9d);
      }
    });
    group.scale.setScalar(0.8);
    return group;
  }

  private buildAllyMesh(slot = 0): THREE.Group {
    const group = this.buildShipMesh();
    const tint = slot % 3 === 0 ? 0x9bb7ff : slot % 3 === 1 ? 0xbfffd0 : 0xffd29b;
    group.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.material) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.lerp(new THREE.Color(tint), 0.12);
    });
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
    this.shipMesh = this.buildShipMesh();
    this.shipMesh.scale.setScalar(2.5);
    this.shipMesh.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = false;
    });
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
      lead: q<HTMLDivElement>("#hud-lead")
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
      } else {
        els.mission.textContent = this.mission ? this.mission.def.title : "";
      }
      els.target.textContent = this.playerDead ? "SHIP DESTROYED" : "NO TARGET";
      els.lock.textContent =
        this.playerDead && yavinState
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
