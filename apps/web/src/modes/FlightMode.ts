/**
 * FlightMode - Space combat orchestrator
 *
 * Delegates scenario-specific logic to specialized handlers:
 * - SandboxScenario: Standard missions with hyperspace jumping
 * - YavinDefenseScenario: Defend the Great Temple on Yavin 4
 * - StarDestroyerScenario: Destroy the Imperial Star Destroyer
 */

import * as THREE from "three";
import { removeEntity, hasComponent } from "bitecs";
import { AssetLoader, KENNEY_ASSETS } from "@xwingz/render";
import { createLogger } from "@xwingz/core";
import type { SystemDef } from "@xwingz/procgen";

const log = createLogger("FlightMode");
import {
  createSpaceInput,
  type SpaceInputState,
  dogfightAISystem,
  getPlayerShip,
  aiWeaponSystem,
  spaceflightSystem,
  targetingSystem,
  weaponSystem,
  projectileSystem,
  rebuildSpaceCombatIndex,
  shieldRegenSystem,
  consumeImpactEvents,
  Health,
  Shield,
  Ship,
  Transform,
  torpedoLockSystem,
  torpedoFireSystem,
  torpedoProjectileSystem,
  weaponSwitchSystem,
  // Capital ship systems
  capitalShipMovementSystem,
  capitalShipShieldSystem,
  turretTargetingSystem,
  turretRotationSystem,
  turretFireSystem,
  turretProjectileSystem,
  subsystemEffectsSystem,
  parentChildTransformSystem
} from "@xwingz/gameplay";
import type { ModeHandler, ModeContext, ModeTransitionData, FlightScenario } from "./types";
import { isFlightTransition } from "./types";
import { disposeObject } from "../rendering/MeshManager";
import { ExplosionManager } from "../rendering/effects";
import {
  type FlightHudElements,
  clamp
} from "./flight/FlightScenarioTypes";
import {
  spawnPlayer,
  applyUpgradesToPlayer,
  syncProjectiles,
  clearProjectiles
} from "./flight/FlightShared";
import { SandboxScenario, type SandboxContext } from "./flight/SandboxScenario";
import { YavinDefenseScenario, type YavinContext } from "./flight/YavinDefenseScenario";
import { StarDestroyerScenario, type StarDestroyerContext } from "./flight/StarDestroyerScenario";

// ─────────────────────────────────────────────────────────────────────────────
// FlightMode Handler
// ─────────────────────────────────────────────────────────────────────────────

export class FlightMode implements ModeHandler {
  // Scenario state
  private scenario: FlightScenario = "sandbox";
  private currentSystem: SystemDef | null = null;

  // Scenario handlers
  private sandboxHandler = new SandboxScenario();
  private yavinHandler = new YavinDefenseScenario();
  private starDestroyerHandler = new StarDestroyerScenario();

  // Player state
  private shipEid: number | null = null;
  private shipMesh: THREE.Object3D | null = null;
  private playerDead = false;
  private respawnTimer = 0;
  private readonly RESPAWN_DELAY = 2.0;

  // Targets (enemies)
  private targetEids: number[] = [];
  private targetMeshes = new Map<number, THREE.Object3D>();

  // Projectiles
  private projectileMeshes = new Map<number, THREE.Mesh>();

  // Asset loading
  private assetLoader = new AssetLoader({ basePath: "/assets/models/" });
  private assetsReady = false;

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

  // Input smoothing
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
  private tmpCamOffset = new THREE.Vector3();
  private tmpLookOffset = new THREE.Vector3();
  private tmpDesiredPos = new THREE.Vector3();
  private tmpDesiredLook = new THREE.Vector3();
  private tmpExplosionPos = new THREE.Vector3();

  // ───────────────────────────────────────────────────────────────────────────
  // ModeHandler Interface
  // ───────────────────────────────────────────────────────────────────────────

  enter(ctx: ModeContext, data?: ModeTransitionData): void {
    ctx.controls.enabled = false;
    this.camInit = false;
    this.playerDead = false;
    this.respawnTimer = 0;

    // Extract flight parameters from transition data
    if (isFlightTransition(data)) {
      this.scenario = data.scenario;
      this.currentSystem = data.system;
    } else {
      this.scenario = "sandbox";
      this.currentSystem = null;
    }

    // Initialize explosion manager
    this.explosions = new ExplosionManager(ctx.scene);

    // Initialize input
    this.input = createSpaceInput(window);

    // Clear scene
    ctx.scene.clear();

    // Preload 3D assets
    this.assetsReady = false;
    this.assetLoader
      .preload([KENNEY_ASSETS.TURRET_SINGLE, KENNEY_ASSETS.TURRET_DOUBLE])
      .then(() => {
        this.assetsReady = true;
      })
      .catch((err) => {
        log.warn("Failed to load turret assets:", err);
      });

    // Setup lighting
    this.setupLighting(ctx);

    // Spawn player
    this.respawnPlayer(ctx);

    // Initialize scenario handler
    if (this.currentSystem) {
      if (this.scenario === "yavin_defense") {
        this.yavinHandler.enter(this.createYavinContext(ctx));
      } else if (this.scenario === "destroy_star_destroyer") {
        this.starDestroyerHandler.enter(this.createStarDestroyerContext(ctx));
      } else {
        this.sandboxHandler.enter(this.createSandboxContext(ctx));
      }
    }

    // Camera
    ctx.camera.position.set(0, 6, 20);
    ctx.camera.lookAt(0, 0, -50);

    // Setup HUD
    this.setupFlightHud(ctx);
  }

  tick(ctx: ModeContext, dt: number): void {
    if (!this.input) {
      ctx.renderer.render(ctx.scene, ctx.camera);
      return;
    }

    // Update input with smoothing
    this.updateInput(dt);

    // Check for mode exit
    if (this.simInput.toggleMap) {
      ctx.requestModeChange("map", { type: "map" });
      return;
    }

    // Handle landing (Yavin only)
    if (this.scenario === "yavin_defense" && this.shipEid !== null) {
      if (this.yavinHandler.canLand(this.createYavinContext(ctx)) && this.simInput.land) {
        const playerX = Transform.x[this.shipEid] ?? 0;
        const playerZ = Transform.z[this.shipEid] ?? 0;
        const groundY = this.yavinHandler.getTerrainHeight(playerX, playerZ);

        ctx.requestModeChange("ground", {
          type: "ground_from_flight",
          landingPosition: { x: playerX, y: groundY, z: playerZ },
          playerState: {
            health: Health.hp[this.shipEid] ?? 100,
            maxHealth: Health.maxHp[this.shipEid] ?? 100,
            shields: Shield.sp[this.shipEid] ?? 0,
            maxShields: Shield.maxSp[this.shipEid] ?? 0
          },
          planetIndex: 0,
          system: this.currentSystem
        });
        return;
      }
    }

    // Handle hyperspace/restart
    if (this.simInput.hyperspace) {
      if (this.handleHyperspace(ctx)) return;
    }

    // Handle player death
    if (this.playerDead) {
      this.handlePlayerDeath(ctx, dt);
      return;
    }

    // Run game systems
    this.runGameSystems(ctx, dt);

    // Handle impacts
    this.handleImpacts();

    // Check player death
    const player = getPlayerShip(ctx.world);
    if (player === null) {
      this.onPlayerKilled(ctx);
      return;
    }

    // Scenario-specific tick
    if (this.currentSystem) {
      if (this.scenario === "yavin_defense") {
        this.yavinHandler.tick(this.createYavinContext(ctx), dt);
      } else if (this.scenario === "destroy_star_destroyer") {
        this.starDestroyerHandler.tick(this.createStarDestroyerContext(ctx), dt);
      } else {
        const sctx = this.createSandboxContext(ctx);
        this.sandboxHandler.tick(sctx, dt);
        // Update system reference if changed by hyperspace
        this.currentSystem = sctx.currentSystem;
      }
    }

    // Update player mesh and camera
    this.updatePlayerMesh(ctx, player, dt);

    // Sync projectiles
    syncProjectiles(ctx, ctx.scene, this.projectileMeshes, this.explosions, this.shipEid);

    // Update HUD
    this.updateFlightHud(ctx, dt);

    // Render
    this.explosions?.update(dt);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  exit(ctx: ModeContext): void {
    // Clear projectiles
    clearProjectiles(ctx, ctx.scene, this.projectileMeshes);

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

    // Exit scenario handler
    if (this.currentSystem) {
      if (this.scenario === "yavin_defense") {
        this.yavinHandler.exit(this.createYavinContext(ctx));
      } else if (this.scenario === "destroy_star_destroyer") {
        this.starDestroyerHandler.exit(this.createStarDestroyerContext(ctx));
      } else {
        this.sandboxHandler.exit(this.createSandboxContext(ctx));
      }
    }

    // Dispose explosions
    this.explosions?.dispose();
    this.explosions = null;

    // Reset HUD
    this.flightHud = null;

    // Reset state
    this.camInit = false;
    this.input = null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public getters for E2E testing
  // ───────────────────────────────────────────────────────────────────────────

  get targetCount(): number {
    return this.targetEids.length;
  }

  get allyCount(): number {
    return this.yavinHandler.getAllyCount();
  }

  get projectileCount(): number {
    return this.projectileMeshes.size;
  }

  get currentScenario(): FlightScenario {
    return this.scenario;
  }

  get yavinPhase(): string | null {
    return this.yavinHandler.getYavinState()?.phase ?? null;
  }

  get starDestroyerPhase(): string | null {
    return this.starDestroyerHandler.getMissionState()?.phase ?? null;
  }

  get capitalShipCount(): number {
    return this.starDestroyerHandler.getCapitalShipEids().length;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // E2E Test Helpers
  // ───────────────────────────────────────────────────────────────────────────

  killAllEnemiesForTest(world: import("bitecs").IWorld): void {
    for (const eid of this.targetEids) {
      removeEntity(world, eid);
    }
    this.targetEids = [];
    const yavinState = this.yavinHandler.getYavinState();
    if (yavinState && yavinState.phase === "combat") {
      // Force mission success for E2E testing (bypasses objective system)
      this.yavinHandler.forceMissionSuccessForTest();
    }
    const sdState = this.starDestroyerHandler.getMissionState();
    if (sdState) {
      sdState.tieFightersKilled = sdState.tieFighterCount;
    }
  }

  failBaseForTest(world: import("bitecs").IWorld): void {
    const baseEid = this.yavinHandler.getBaseEid();
    if (baseEid !== null && hasComponent(world, Health, baseEid)) {
      Health.hp[baseEid] = 0;
    }
    // Force mission failure for E2E testing (bypasses objective system)
    this.yavinHandler.forceMissionFailureForTest();
  }

  destroyStarDestroyerForTest(world: import("bitecs").IWorld): void {
    this.starDestroyerHandler.destroyStarDestroyerForTest(world);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Scene Setup
  // ───────────────────────────────────────────────────────────────────────────

  private setupLighting(ctx: ModeContext): void {
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
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Player Management
  // ───────────────────────────────────────────────────────────────────────────

  private respawnPlayer(ctx: ModeContext): void {
    const result = spawnPlayer(ctx, ctx.scene, this.shipEid, this.shipMesh);
    this.shipEid = result.shipEid;
    this.shipMesh = result.shipMesh;
    applyUpgradesToPlayer(ctx.world, this.shipEid, ctx.profile.upgrades, true);
    this.camInit = false;
  }

  private updatePlayerMesh(ctx: ModeContext, player: number, dt: number): void {
    if (!this.shipMesh) return;

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
    const desiredPos = this.tmpDesiredPos.copy(pos).add(camOffset);
    const desiredLook = this.tmpDesiredLook.copy(pos).add(lookOffset);

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

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Input
  // ───────────────────────────────────────────────────────────────────────────

  private updateInput(dt: number): void {
    if (!this.input) return;

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
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Game Systems
  // ───────────────────────────────────────────────────────────────────────────

  private runGameSystems(ctx: ModeContext, dt: number): void {
    targetingSystem(ctx.world, this.simInput);
    dogfightAISystem(ctx.world, dt);
    spaceflightSystem(ctx.world, this.simInput, dt);
    weaponSystem(ctx.world, this.simInput, dt);
    aiWeaponSystem(ctx.world, dt);
    rebuildSpaceCombatIndex(ctx.world);  // Unified spatial index for all collision queries
    projectileSystem(ctx.world, dt);
    weaponSwitchSystem(ctx.world, this.simInput);
    torpedoLockSystem(ctx.world, this.simInput, dt);
    torpedoFireSystem(ctx.world, this.simInput, dt);
    torpedoProjectileSystem(ctx.world, dt);
    shieldRegenSystem(ctx.world, dt);

    // Capital ship systems (for Star Destroyer scenario)
    if (this.scenario === "destroy_star_destroyer") {
      capitalShipMovementSystem(ctx.world, dt);
      capitalShipShieldSystem(ctx.world, dt);
      parentChildTransformSystem(ctx.world);
      turretTargetingSystem(ctx.world, dt);
      turretRotationSystem(ctx.world, dt);
      turretFireSystem(ctx.world, dt);
      turretProjectileSystem(ctx.world, dt);
      subsystemEffectsSystem(ctx.world, dt);
    }
  }

  private handleImpacts(): void {
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
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Death Handling
  // ───────────────────────────────────────────────────────────────────────────

  private onPlayerKilled(ctx: ModeContext): void {
    // Notify scenario handlers
    if (this.scenario === "yavin_defense") {
      const yavinState = this.yavinHandler.getYavinState();
      if (yavinState && yavinState.phase === "combat") {
        yavinState.phase = "fail";
        yavinState.message = "MISSION FAILED - YOU WERE SHOT DOWN";
        yavinState.messageTimer = 8;
        ctx.scheduleSave();
      }
    }
    if (this.scenario === "destroy_star_destroyer") {
      const sdState = this.starDestroyerHandler.getMissionState();
      if (sdState && sdState.phase !== "success" && sdState.phase !== "fail") {
        sdState.phase = "fail";
        sdState.message = "MISSION FAILED - YOU WERE SHOT DOWN";
        sdState.messageTimer = 8;
        ctx.scheduleSave();
      }
    }

    this.playerDead = true;
    this.respawnTimer = 0;
    clearProjectiles(ctx, ctx.scene, this.projectileMeshes);

    if (this.shipMesh) {
      this.explosions?.spawn(this.tmpExplosionPos.copy(this.shipMesh.position), 0xff5555);
      ctx.scene.remove(this.shipMesh);
      disposeObject(this.shipMesh);
      this.shipMesh = null;
    }
    this.shipEid = null;

    this.updateFlightHud(ctx, 1 / 60);
    this.explosions?.update(1 / 60);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  private handlePlayerDeath(ctx: ModeContext, dt: number): void {
    this.respawnTimer += dt;

    // Only respawn in sandbox mode
    if (
      this.scenario !== "yavin_defense" &&
      this.scenario !== "destroy_star_destroyer" &&
      this.respawnTimer >= this.RESPAWN_DELAY &&
      this.currentSystem
    ) {
      clearProjectiles(ctx, ctx.scene, this.projectileMeshes);
      this.respawnPlayer(ctx);
      this.sandboxHandler.enter(this.createSandboxContext(ctx));
      this.playerDead = false;
      this.respawnTimer = 0;
    }

    this.updateFlightHud(ctx, dt);
    this.explosions?.update(dt);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Hyperspace
  // ───────────────────────────────────────────────────────────────────────────

  private handleHyperspace(ctx: ModeContext): boolean {
    // Check for restart in Yavin
    if (this.scenario === "yavin_defense" && this.currentSystem) {
      const yavinState = this.yavinHandler.getYavinState();
      if (yavinState && (yavinState.phase === "success" || yavinState.phase === "fail")) {
        ctx.requestModeChange("flight", {
          type: "flight",
          system: this.currentSystem,
          scenario: "yavin_defense"
        });
        return true;
      }
      if (!this.yavinHandler.handleHyperspace(this.createYavinContext(ctx))) {
        return false;
      }
    }

    // Check for restart in Star Destroyer
    if (this.scenario === "destroy_star_destroyer" && this.currentSystem) {
      const sdState = this.starDestroyerHandler.getMissionState();
      if (sdState && (sdState.phase === "success" || sdState.phase === "fail")) {
        ctx.requestModeChange("flight", {
          type: "flight",
          system: this.currentSystem,
          scenario: "destroy_star_destroyer"
        });
        return true;
      }
      if (!this.starDestroyerHandler.handleHyperspace(this.createStarDestroyerContext(ctx))) {
        return false;
      }
    }

    // Sandbox hyperspace jump
    if (this.scenario === "sandbox" && this.currentSystem) {
      const sctx = this.createSandboxContext(ctx);
      this.sandboxHandler.handleHyperspace(sctx);
      this.currentSystem = sctx.currentSystem;
      clearProjectiles(ctx, ctx.scene, this.projectileMeshes);
    }

    return false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Context Factories
  // ───────────────────────────────────────────────────────────────────────────

  private createSandboxContext(ctx: ModeContext): SandboxContext {
    return {
      ctx,
      currentSystem: this.currentSystem!,
      shipEid: this.shipEid,
      targetEids: this.targetEids,
      targetMeshes: this.targetMeshes,
      projectileMeshes: this.projectileMeshes,
      explosions: this.explosions
    };
  }

  private createYavinContext(ctx: ModeContext): YavinContext {
    return {
      ctx,
      currentSystem: this.currentSystem!,
      shipEid: this.shipEid,
      targetEids: this.targetEids,
      targetMeshes: this.targetMeshes,
      projectileMeshes: this.projectileMeshes,
      explosions: this.explosions,
      assetLoader: this.assetLoader,
      assetsReady: this.assetsReady
    };
  }

  private createStarDestroyerContext(ctx: ModeContext): StarDestroyerContext {
    return {
      ctx,
      currentSystem: this.currentSystem!,
      shipEid: this.shipEid,
      targetEids: this.targetEids,
      targetMeshes: this.targetMeshes,
      projectileMeshes: this.projectileMeshes,
      explosions: this.explosions,
      assetLoader: this.assetLoader,
      assetsReady: this.assetsReady
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: HUD
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
      capitalPanel: q<HTMLDivElement>("#hud-capital"),
      capShieldFront: q<HTMLDivElement>("#hud-cap-shield-front"),
      capShieldRear: q<HTMLDivElement>("#hud-cap-shield-rear"),
      capHullFore: q<HTMLDivElement>("#hud-cap-hull-fore"),
      capHullMid: q<HTMLDivElement>("#hud-cap-hull-mid"),
      capHullAft: q<HTMLDivElement>("#hud-cap-hull-aft"),
      capSubsystems: q<HTMLDivElement>("#hud-cap-subsystems")
    };
  }

  private updateFlightHud(ctx: ModeContext, dt: number): void {
    if (!this.flightHud || !this.currentSystem) return;

    // Delegate to scenario handler
    if (this.scenario === "yavin_defense") {
      this.yavinHandler.updateHud(this.createYavinContext(ctx), this.flightHud, dt);
      // Ensure capital panel is hidden in Yavin mission
      this.flightHud.capitalPanel.classList.add("hidden");
    } else if (this.scenario === "destroy_star_destroyer") {
      this.starDestroyerHandler.updateHud(this.createStarDestroyerContext(ctx), this.flightHud, dt);
    } else {
      this.sandboxHandler.updateHud(this.createSandboxContext(ctx), this.flightHud, dt);
      // Ensure capital panel is hidden in sandbox mode
      this.flightHud.capitalPanel.classList.add("hidden");
    }

    // Handle dead player HUD
    if (this.playerDead) {
      this.flightHud.target.textContent = "SHIP DESTROYED";
      const yavinState = this.yavinHandler.getYavinState();
      const sdState = this.starDestroyerHandler.getMissionState();
      if (yavinState || sdState) {
        this.flightHud.lock.textContent = "PRESS H TO RESTART";
      } else {
        this.flightHud.lock.textContent = "RESPAWNING...";
      }
    }
  }
}
