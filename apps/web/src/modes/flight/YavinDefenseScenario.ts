/**
 * YavinDefenseScenario - Defend the Great Temple on Yavin 4
 * Enhanced with 4 required objectives + 1 optional bonus objective
 *
 * Extracted submodules:
 * - YavinTerrainBuilder: Terrain and temple construction
 * - YavinEnvironmentalProps: Rock and prop spawning
 * - YavinWaveSpawner: Enemy wave spawning
 * - YavinAllyManager: Wingman management
 * - YavinObjectives: Objective definitions
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";
import { AssetLoader } from "@xwingz/render";
import {
  Health,
  HitRadius,
  Shield,
  Ship,
  Team,
  Transform,
  Velocity,
  Targeting,
  ObjectiveTracker,
  KillTracker,
  type ObjectiveContext,
  type ObjectiveEvent,
  ObjectiveStatus,
  ObjectiveEventType,
  createDefaultObjectiveContext
} from "@xwingz/gameplay";
import type { SystemDef } from "@xwingz/procgen";
import type { ModeContext } from "../types";
import { disposeObject } from "../../rendering/MeshManager";
import type { ExplosionManager } from "../../rendering/effects";
import {
  type FlightHudElements,
  type YavinDefenseState,
  type TerrainParams,
  type TargetBracketState
} from "./FlightScenarioTypes";
import {
  syncTargets,
  updatePlayerHudValues,
  updateSystemInfo,
  updateTargetBracket,
  clearTargetBracket
} from "./FlightShared";
import { ObjectiveHud } from "./ObjectiveHud";
import {
  AnnouncementSystem,
  newObjectiveAnnouncement,
  objectiveCompleteAnnouncement,
  milestoneAnnouncement,
  missionCompleteAnnouncement,
  missionFailedAnnouncement
} from "./AnnouncementSystem";
import { RadioChatterSystem, RadioSpeaker, YAVIN_RADIO } from "./RadioChatterSystem";

// Extracted submodules
import {
  buildYavinTerrain,
  getTerrainHeight,
  clearYavinAtmosphere,
  spawnEnvironmentalProps,
  spawnWave1TieRaid,
  spawnWave2Bombers,
  spawnWave3FinalAssault,
  createAllyManagerState,
  spawnWingmanSquadron,
  syncAllies,
  clearAllies,
  getAllyCount,
  YAVIN_OBJECTIVES,
  type AllyManagerState,
  type YavinTerrainResult
} from "./yavin";

// ─────────────────────────────────────────────────────────────────────────────
// Yavin Context
// ─────────────────────────────────────────────────────────────────────────────

export interface YavinContext {
  ctx: ModeContext;
  currentSystem: SystemDef;
  shipEid: number | null;
  targetEids: number[];
  targetMeshes: Map<number, THREE.Object3D>;
  projectileMeshes: Map<number, THREE.Mesh>;
  explosions: ExplosionManager | null;
  assetLoader: AssetLoader;
  assetsReady: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Yavin Defense Scenario Handler
// ─────────────────────────────────────────────────────────────────────────────

export class YavinDefenseScenario {
  // Terrain (from extracted module)
  private terrainResult: YavinTerrainResult | null = null;
  private terrainParams: TerrainParams | null = null;

  // Environmental props
  private environmentalProps: THREE.Object3D[] = [];

  // Base
  private baseEid: number | null = null;

  // Allies (from extracted module)
  private allyState: AllyManagerState = createAllyManagerState();

  // Mission state
  private yavin: YavinDefenseState | null = null;

  // Wave tracking for objectives
  private currentWave = 0;
  private waveEnemyTypes = new Map<number, string>();
  private missionTime = 0;

  // Objective system
  private objectiveTracker: ObjectiveTracker | null = null;
  private killTracker: KillTracker | null = null;
  private objectiveHud: ObjectiveHud | null = null;
  private announcements: AnnouncementSystem | null = null;
  private radioChatter: RadioChatterSystem | null = null;

  // Landing
  private canLandNow = false;
  private readonly LANDING_ALTITUDE = 150;

  // Targeting state
  private lockState: TargetBracketState = { lockValue: 0, lockTargetEid: -1 };

  enter(yctx: YavinContext): void {
    this.lockState = { lockValue: 0, lockTargetEid: -1 };
    this.missionTime = 0;
    this.currentWave = 0;
    this.waveEnemyTypes.clear();

    // Initialize objective system
    this.objectiveTracker = new ObjectiveTracker(YAVIN_OBJECTIVES);
    this.killTracker = new KillTracker(80);
    this.objectiveTracker.initialize();

    // Initialize HUD systems
    const hudContainer = yctx.ctx.hud;
    this.objectiveHud = new ObjectiveHud(hudContainer);
    this.announcements = new AnnouncementSystem(hudContainer);
    this.radioChatter = new RadioChatterSystem(hudContainer);

    // Build terrain using extracted module
    this.terrainResult = buildYavinTerrain(yctx.ctx.scene, yctx.currentSystem.seed);
    this.terrainParams = this.terrainResult.terrainParams;

    // Add environmental props using extracted module
    spawnEnvironmentalProps(
      yctx.ctx.scene,
      yctx.assetLoader,
      yctx.currentSystem.seed,
      this.terrainParams
    ).then((props) => {
      this.environmentalProps = props;
    });

    // Start defense mission
    this.startYavinDefense(yctx);

    // Queue initial radio chatter
    if (this.radioChatter) {
      this.radioChatter.queueMessages(YAVIN_RADIO.scramble, RadioSpeaker.WINGMAN, 5);
    }
  }

  tick(yctx: YavinContext, dt: number): boolean {
    if (!this.yavin) return false;

    this.missionTime += dt;

    // Sync targets
    const syncResult = syncTargets(yctx.ctx, yctx.ctx.scene, yctx.targetMeshes, yctx.explosions);

    // Handle kills - track for objectives
    if (syncResult.killedCount > 0 && yctx.shipEid !== null) {
      for (const killedEid of syncResult.killedEids) {
        const enemyType = this.waveEnemyTypes.get(killedEid) ?? "tie_fighter";
        const wave = this.currentWave;
        this.killTracker?.recordKill(enemyType, wave);
        this.waveEnemyTypes.delete(killedEid);
      }

      this.yavin.enemiesKilled += syncResult.killedCount;
      yctx.ctx.profile.credits += syncResult.killedCount * 10;
      yctx.ctx.scheduleSave();
    }

    // Check player shield for kill streak
    if (yctx.shipEid !== null && this.killTracker) {
      const shieldPercent = hasComponent(yctx.ctx.world, Shield, yctx.shipEid)
        ? ((Shield.sp[yctx.shipEid] ?? 0) / (Shield.maxSp[yctx.shipEid] ?? 1)) * 100
        : 100;
      this.killTracker.checkShieldForStreak(shieldPercent);
    }

    // Update array in place to preserve FlightMode's reference
    yctx.targetEids.length = 0;
    yctx.targetEids.push(...syncResult.targetEids);

    // Sync allies using extracted module
    syncAllies(yctx.ctx.world, yctx.ctx.scene, this.allyState, yctx.explosions);

    // Build objective context and update tracker
    if (this.objectiveTracker && this.killTracker) {
      const objContext = this.buildObjectiveContext(yctx);
      const events = this.objectiveTracker.tick(dt, objContext);
      this.processObjectiveEvents(yctx, events);
    }

    // Check for wave transitions based on objective completion
    this.checkWaveTransitions(yctx);

    // Terrain clamping
    if (yctx.shipEid !== null) {
      this.clampEntityAboveTerrain(yctx.ctx, yctx.shipEid, 6);
    }
    for (const eid of this.allyState.allyEids) {
      this.clampEntityAboveTerrain(yctx.ctx, eid, 6);
    }
    for (const eid of yctx.targetEids) {
      this.clampEntityAboveTerrain(yctx.ctx, eid, 6);
    }

    // Update message timer
    if (this.yavin.messageTimer > 0) {
      this.yavin.messageTimer = Math.max(0, this.yavin.messageTimer - dt);
    }

    // Update HUD systems
    this.announcements?.tick(dt);
    this.radioChatter?.tick(dt);

    // Landing detection
    if (yctx.shipEid !== null) {
      const altitude =
        (Transform.y[yctx.shipEid] ?? 0) -
        this.terrainHeight(Transform.x[yctx.shipEid] ?? 0, Transform.z[yctx.shipEid] ?? 0);
      this.canLandNow = altitude < this.LANDING_ALTITUDE;
    }

    return false;
  }

  /**
   * Build ObjectiveContext from current game state
   */
  private buildObjectiveContext(yctx: YavinContext): ObjectiveContext {
    const ctx = createDefaultObjectiveContext();
    ctx.missionTime = this.missionTime;

    // Kill tracking
    if (this.killTracker) {
      ctx.kills = this.killTracker.getTrackingData();
    }

    // Ally tracking
    ctx.allies.alive = getAllyCount(this.allyState);
    ctx.allies.started = 5;

    // Count allies near player
    if (yctx.shipEid !== null) {
      const px = Transform.x[yctx.shipEid] ?? 0;
      const py = Transform.y[yctx.shipEid] ?? 0;
      const pz = Transform.z[yctx.shipEid] ?? 0;

      let nearbyCount = 0;
      for (const allyEid of this.allyState.allyEids) {
        const ax = Transform.x[allyEid] ?? 0;
        const ay = Transform.y[allyEid] ?? 0;
        const az = Transform.z[allyEid] ?? 0;
        const dist = Math.sqrt((px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2);
        if (dist <= 150) nearbyCount++;
      }
      ctx.allies.nearbyCount = nearbyCount;

      // Player location
      ctx.location.playerPosition = { x: px, y: py, z: pz };
      ctx.location.playerAltitude = py - this.terrainHeight(px, pz);

      // Player shield
      if (hasComponent(yctx.ctx.world, Shield, yctx.shipEid)) {
        ctx.playerShieldPercent =
          ((Shield.sp[yctx.shipEid] ?? 0) / (Shield.maxSp[yctx.shipEid] ?? 1)) * 100;
      }
    }

    // Base health
    if (this.baseEid !== null && hasComponent(yctx.ctx.world, Health, this.baseEid)) {
      ctx.entities.baseHealth = Health.hp[this.baseEid] ?? 0;
      ctx.entities.baseHealthPercent =
        ((Health.hp[this.baseEid] ?? 0) / (this.yavin?.baseHpMax ?? 2000)) * 100;
    }

    // Track completed objectives
    if (this.objectiveTracker) {
      const completed = this.objectiveTracker.getObjectivesByStatus(ObjectiveStatus.COMPLETED);
      for (const obj of completed) {
        ctx.completedObjectives.add(obj.definition.id);
      }
    }

    return ctx;
  }

  /**
   * Process objective events (announcements, radio, phase transitions)
   */
  private processObjectiveEvents(yctx: YavinContext, events: ObjectiveEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case ObjectiveEventType.OBJECTIVE_ACTIVATED:
          if (event.objective?.definition.radioOnStart) {
            this.radioChatter?.queueMessages(
              event.objective.definition.radioOnStart,
              RadioSpeaker.WINGMAN,
              5
            );
          }
          this.announcements?.announce(
            newObjectiveAnnouncement(event.objective?.definition.name ?? "", event.message)
          );
          break;

        case ObjectiveEventType.OBJECTIVE_COMPLETED:
          if (event.objective?.definition.radioOnComplete) {
            this.radioChatter?.queueMessages(
              event.objective.definition.radioOnComplete,
              RadioSpeaker.WINGMAN,
              6
            );
          }
          this.announcements?.announce(
            objectiveCompleteAnnouncement(event.objective?.definition.hudTextComplete ?? "COMPLETE")
          );

          // Award credits
          if (event.objective) {
            yctx.ctx.profile.credits += event.objective.definition.rewardCredits;
            yctx.ctx.scheduleSave();
          }
          break;

        case ObjectiveEventType.OBJECTIVE_MILESTONE:
          this.announcements?.announce(milestoneAnnouncement(event.message ?? ""));
          break;

        case ObjectiveEventType.OBJECTIVE_FAILED:
          if (!event.objective?.definition.isOptional) {
            this.yavin!.phase = "fail";
            this.yavin!.message = "MISSION FAILED";
            this.yavin!.messageTimer = 8;
            this.announcements?.announce(missionFailedAnnouncement(event.message));
          }
          break;

        case ObjectiveEventType.MISSION_COMPLETE:
          this.yavin!.phase = "success";
          this.yavin!.message = `VICTORY  +${this.objectiveTracker?.getTotalCreditsEarned() ?? 0} CR`;
          this.yavin!.messageTimer = 6;
          yctx.ctx.profile.credits += this.yavin!.rewardCredits;
          yctx.ctx.profile.missionTier += 1;
          yctx.ctx.scheduleSave();
          this.announcements?.announce(missionCompleteAnnouncement());
          break;

        case ObjectiveEventType.MISSION_FAILED:
          this.yavin!.phase = "fail";
          this.yavin!.message = "MISSION FAILED";
          this.yavin!.messageTimer = 8;
          this.announcements?.announce(missionFailedAnnouncement(event.message));
          yctx.ctx.scheduleSave();
          break;
      }
    }
  }

  /**
   * Check for wave transitions and spawn new enemies
   */
  private checkWaveTransitions(yctx: YavinContext): void {
    if (!this.objectiveTracker || !this.yavin) return;

    const active = this.objectiveTracker.getActiveObjective();
    if (!active) return;

    // Wave 1 -> Wave 2 transition (spawn bombers)
    if (active.definition.id === "yd_obj_3" && this.currentWave < 2) {
      this.currentWave = 2;
      const result = spawnWave2Bombers(
        yctx.ctx.world,
        yctx.ctx.scene,
        yctx.currentSystem.seed,
        this.baseEid
      );
      for (const [eid, mesh] of result.meshes) {
        yctx.targetMeshes.set(eid, mesh);
        yctx.targetEids.push(eid);
      }
      for (const [eid, type] of result.enemyTypes) {
        this.waveEnemyTypes.set(eid, type);
      }
    }

    // Wave 2 -> Wave 3 transition (spawn final wave)
    if (active.definition.id === "yd_obj_4" && this.currentWave < 3) {
      this.currentWave = 3;
      const result = spawnWave3FinalAssault(yctx.ctx.world, yctx.ctx.scene, yctx.currentSystem.seed);
      for (const [eid, mesh] of result.meshes) {
        yctx.targetMeshes.set(eid, mesh);
        yctx.targetEids.push(eid);
      }
      for (const [eid, type] of result.enemyTypes) {
        this.waveEnemyTypes.set(eid, type);
      }
    }
  }

  handleHyperspace(_yctx: YavinContext): boolean {
    if (!this.yavin) return true;

    // Allow restart on success/fail
    if (this.yavin.phase === "success" || this.yavin.phase === "fail") {
      return true;
    }

    // Block during combat
    if (this.yavin.phase === "combat") {
      this.yavin.message = "HYPERSPACE DISABLED - COMPLETE OBJECTIVE";
      this.yavin.messageTimer = 2;
    }

    return false;
  }

  updateHud(yctx: YavinContext, els: FlightHudElements, dt: number): void {
    updatePlayerHudValues(els, yctx.shipEid, yctx.ctx);
    updateSystemInfo(els, yctx.currentSystem, yctx.ctx.profile.credits);

    const baseHp =
      this.baseEid !== null && hasComponent(yctx.ctx.world, Health, this.baseEid)
        ? Health.hp[this.baseEid] ?? 0
        : 0;
    const baseHpPercent = (baseHp / (this.yavin?.baseHpMax ?? 2000)) * 100;

    // Update objective HUD
    if (this.objectiveTracker && this.objectiveHud) {
      this.objectiveHud.update(this.objectiveTracker, dt);
    }

    // Mission message
    if (this.yavin) {
      if (this.yavin.messageTimer > 0) {
        els.mission.textContent = this.yavin.message;
      } else if (this.yavin.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (this.yavin.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        const active = this.objectiveTracker?.getActiveObjective();
        const objText = active ? active.definition.hudTextActive : "DEFEND GREAT TEMPLE";
        const hpColor =
          baseHpPercent > 60 ? "" : baseHpPercent > 30 ? "[WARNING] " : "[CRITICAL] ";
        els.mission.textContent = `${objText}  ${hpColor}BASE: ${Math.max(0, baseHp).toFixed(0)}/${this.yavin.baseHpMax}`;
      }
    }

    // Target bracket
    if (yctx.shipEid !== null) {
      const teid = Targeting.targetEid[yctx.shipEid] ?? -1;
      if (teid >= 0 && Transform.x[teid] !== undefined) {
        this.lockState = updateTargetBracket(yctx.ctx, els, yctx.shipEid, teid, this.lockState, dt);
      } else {
        clearTargetBracket(els);
        this.lockState = { lockValue: 0, lockTargetEid: -1 };
      }
    }

    // Landing prompt
    els.landPrompt.classList.toggle("hidden", !this.canLandNow);
  }

  getMissionMessage(_yctx: YavinContext): string {
    if (!this.yavin) return "";
    if (this.yavin.messageTimer > 0) return this.yavin.message;
    if (this.yavin.phase === "success") return "VICTORY";
    if (this.yavin.phase === "fail") return "MISSION FAILED";
    return `DEFEND: ${this.yavin.enemiesKilled}/${this.yavin.enemiesTotal}`;
  }

  canLand(_yctx: YavinContext): boolean {
    return this.canLandNow;
  }

  exit(yctx: YavinContext): void {
    this.clearPlanetaryScene(yctx);
    this.clearEnvironmentalProps(yctx);
    clearAllies(yctx.ctx.world, yctx.ctx.scene, this.allyState);
    this.yavin = null;

    // Dispose HUD systems
    this.objectiveHud?.dispose();
    this.announcements?.dispose();
    this.radioChatter?.dispose();
    this.objectiveHud = null;
    this.announcements = null;
    this.radioChatter = null;
    this.objectiveTracker = null;
    this.killTracker = null;
    this.waveEnemyTypes.clear();
    this.currentWave = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Accessors
  // ─────────────────────────────────────────────────────────────────────────────

  getYavinState(): YavinDefenseState | null {
    return this.yavin;
  }

  getAllyCount(): number {
    return getAllyCount(this.allyState);
  }

  getBaseEid(): number | null {
    return this.baseEid;
  }

  getTerrainHeight(x: number, z: number): number {
    return this.terrainHeight(x, z);
  }

  /**
   * E2E Test Helper: Force mission success immediately
   */
  forceMissionSuccessForTest(): void {
    if (!this.yavin) return;
    this.yavin.phase = "success";
    this.yavin.message = "VICTORY (E2E TEST)";
    this.yavin.messageTimer = 6;
    this.yavin.enemiesKilled = this.yavin.enemiesTotal;
    this.waveEnemyTypes.clear();
  }

  /**
   * E2E Test Helper: Force mission failure immediately
   */
  forceMissionFailureForTest(): void {
    if (!this.yavin) return;
    this.yavin.phase = "fail";
    this.yavin.message = "MISSION FAILED (E2E TEST)";
    this.yavin.messageTimer = 8;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private terrainHeight(x: number, z: number): number {
    return getTerrainHeight(x, z, this.terrainParams);
  }

  private clampEntityAboveTerrain(ctx: ModeContext, eid: number, clearance: number): void {
    if (!this.terrainParams) return;
    if (!hasComponent(ctx.world, Transform, eid)) return;

    const x = Transform.x[eid] ?? 0;
    const z = Transform.z[eid] ?? 0;
    const minY = this.terrainHeight(x, z) + clearance;
    const y0 = Transform.y[eid] ?? 0;
    if (y0 >= minY) return;

    Transform.y[eid] = minY;
    if (hasComponent(ctx.world, Velocity, eid) && (Velocity.vy[eid] ?? 0) < 0) {
      Velocity.vy[eid] = 0;
    }
  }

  private clearEnvironmentalProps(yctx: YavinContext): void {
    for (const prop of this.environmentalProps) {
      yctx.ctx.scene.remove(prop);
      disposeObject(prop);
    }
    this.environmentalProps = [];
  }

  private clearPlanetaryScene(yctx: YavinContext): void {
    if (this.terrainResult) {
      yctx.ctx.scene.remove(this.terrainResult.groundMesh);
      disposeObject(this.terrainResult.groundMesh);
      yctx.ctx.scene.remove(this.terrainResult.treeTrunks);
      disposeObject(this.terrainResult.treeTrunks);
      yctx.ctx.scene.remove(this.terrainResult.treeCanopies);
      disposeObject(this.terrainResult.treeCanopies);
      yctx.ctx.scene.remove(this.terrainResult.baseMesh);
      disposeObject(this.terrainResult.baseMesh);
      this.terrainResult = null;
    }
    if (this.baseEid !== null) {
      removeEntity(yctx.ctx.world, this.baseEid);
      this.baseEid = null;
    }
    this.terrainParams = null;
    clearYavinAtmosphere(yctx.ctx.scene);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mission Setup
  // ─────────────────────────────────────────────────────────────────────────────

  private startYavinDefense(yctx: YavinContext): void {
    this.yavin = {
      phase: "launch",
      baseHpMax: 2000,
      enemiesTotal: 12,  // FIX: Increased from 6 to 12 (more challenge, more to defend against)
      enemiesKilled: 0,
      rewardCredits: 1000,
      message: "RED SQUADRON: LAUNCH! DEFEND THE GREAT TEMPLE.",
      messageTimer: 6
    };

    clearAllies(yctx.ctx.world, yctx.ctx.scene, this.allyState);

    // Clear existing targets
    for (const eid of yctx.targetEids) removeEntity(yctx.ctx.world, eid);
    yctx.targetEids.length = 0;
    for (const mesh of yctx.targetMeshes.values()) {
      yctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    yctx.targetMeshes.clear();

    // Base entity
    if (this.terrainResult?.baseMesh) {
      const eid = addEntity(yctx.ctx.world);
      addComponent(yctx.ctx.world, Transform, eid);
      addComponent(yctx.ctx.world, Team, eid);
      addComponent(yctx.ctx.world, Health, eid);
      addComponent(yctx.ctx.world, HitRadius, eid);

      this.baseEid = eid;
      Team.id[eid] = 0;
      Health.hp[eid] = this.yavin.baseHpMax;
      Health.maxHp[eid] = this.yavin.baseHpMax;
      HitRadius.r[eid] = 140;

      Transform.x[eid] = this.terrainResult.baseMesh.position.x;
      Transform.y[eid] = this.terrainResult.baseMesh.position.y + 55;
      Transform.z[eid] = this.terrainResult.baseMesh.position.z + 30;
      Transform.qx[eid] = 0;
      Transform.qy[eid] = 0;
      Transform.qz[eid] = 0;
      Transform.qw[eid] = 1;
    }

    // Position player
    if (yctx.shipEid !== null && this.terrainParams) {
      const x = 0;
      const z = 340;
      const y = this.terrainHeight(x, z) + 7;
      Transform.x[yctx.shipEid] = x;
      Transform.y[yctx.shipEid] = y;
      Transform.z[yctx.shipEid] = z;
      Transform.qx[yctx.shipEid] = 0;
      Transform.qy[yctx.shipEid] = 1;
      Transform.qz[yctx.shipEid] = 0;
      Transform.qw[yctx.shipEid] = 0;
      Velocity.vx[yctx.shipEid] = 0;
      Velocity.vy[yctx.shipEid] = 0;
      Velocity.vz[yctx.shipEid] = 0;
      Ship.throttle[yctx.shipEid] = 0.35;
    }

    // Wingmen using extracted module
    spawnWingmanSquadron(yctx.ctx.world, yctx.ctx.scene, this.allyState, this.terrainParams);

    // TIE raid - Wave 1 using extracted module
    this.currentWave = 1;
    const waveResult = spawnWave1TieRaid(
      yctx.ctx.world,
      yctx.ctx.scene,
      yctx.currentSystem.seed,
      this.yavin.enemiesTotal,
      this.baseEid
    );
    for (const [eid, mesh] of waveResult.meshes) {
      yctx.targetMeshes.set(eid, mesh);
    }
    yctx.targetEids.push(...waveResult.eids);
    for (const [eid, type] of waveResult.enemyTypes) {
      this.waveEnemyTypes.set(eid, type);
    }

    this.yavin.phase = "combat";
    yctx.ctx.scheduleSave();
  }
}
