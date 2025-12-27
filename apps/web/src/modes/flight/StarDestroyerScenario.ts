/**
 * StarDestroyerScenario - Destroy the Imperial Star Destroyer mission
 *
 * Extracted submodules:
 * - StarDestroyerObjectives: Objective definitions
 * - DebrisFieldSpawner: Debris field spawning
 * - StarDestroyerAllyManager: Wingman management
 * - TIEInterceptorSpawner: TIE spawning
 */

import * as THREE from "three";
import { removeEntity, hasComponent, defineQuery } from "bitecs";
import { type SystemDef } from "@xwingz/procgen";
import { createProceduralShip, AssetLoader } from "@xwingz/render";
import {
  Health,
  Ship,
  Transform,
  Velocity,
  Targeting,
  CapitalShipV2,
  Turret,
  Subsystem,
  spawnCapitalShipV2,
  removeCapitalShipV2,
  consumeTurretFireEvents,
  consumeSubsystemDestroyedEvents,
  rebuildSpaceCombatIndex,
  ObjectiveTracker,
  KillTracker,
  type ObjectiveContext,
  type ObjectiveEvent,
  ObjectiveStatus,
  ObjectiveEventType,
  createDefaultObjectiveContext,
  Shield
} from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import { disposeObject } from "../../rendering/MeshManager";
import type { ExplosionManager } from "../../rendering/effects";
import {
  type FlightHudElements,
  type StarDestroyerMissionState,
  type TargetBracketState
} from "./FlightScenarioTypes";
import {
  buildTurretMesh,
  buildSubsystemMesh,
  createStarfield,
  disposeStarfield,
  syncTargets,
  updatePlayerHudValues,
  updateSystemInfo,
  updateTargetBracket,
  clearTargetBracket,
  SubsystemType
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
import { RadioChatterSystem, RadioSpeaker, STAR_DESTROYER_RADIO } from "./RadioChatterSystem";

// Extracted submodules
import {
  STAR_DESTROYER_OBJECTIVES,
  spawnDebrisField,
  clearDebrisField,
  createSDAllyManagerState,
  spawnWingmenFormation,
  syncSDAllies,
  clearSDAllies,
  getSDAllyCount,
  spawnTIEFighterScreen,
  type SDAllyManagerState
} from "./stardestroyer";

// ─────────────────────────────────────────────────────────────────────────────
// Star Destroyer Context
// ─────────────────────────────────────────────────────────────────────────────

export interface StarDestroyerContext {
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
// Star Destroyer Scenario Handler
// ─────────────────────────────────────────────────────────────────────────────

export class StarDestroyerScenario {
  // Starfield
  private starfield: THREE.Points | null = null;

  // Debris field (asteroids/wreckage) - using extracted module
  private debrisField: THREE.Object3D[] = [];

  // Capital ships
  private capitalShipEids: number[] = [];
  private capitalShipMeshes = new Map<number, THREE.Object3D>();
  private turretMeshes = new Map<number, THREE.Object3D>();
  private subsystemMeshes = new Map<number, THREE.Object3D>();
  private turretProjectileMeshes = new Map<number, THREE.Mesh>();

  // Allies (wingmen) - using extracted module
  private allyState: SDAllyManagerState = createSDAllyManagerState();

  // Enemy type tracking
  private enemyTypes = new Map<number, string>();

  // Mission state
  private mission: StarDestroyerMissionState | null = null;
  private missionTime = 0;
  private initialWingmenCount = 5;
  private wingmenLost = 0;

  // Objective system
  private objectiveTracker: ObjectiveTracker | null = null;
  private killTracker: KillTracker | null = null;
  private objectiveHud: ObjectiveHud | null = null;
  private announcements: AnnouncementSystem | null = null;
  private radioChatter: RadioChatterSystem | null = null;

  // Targeting state
  private lockState: TargetBracketState = { lockValue: 0, lockTargetEid: -1 };

  // Temp vectors
  private tmpExplosionPos = new THREE.Vector3();

  enter(sdctx: StarDestroyerContext): void {
    this.lockState = { lockValue: 0, lockTargetEid: -1 };
    this.missionTime = 0;
    this.wingmenLost = 0;
    this.enemyTypes.clear();

    // Initialize objective system
    this.objectiveTracker = new ObjectiveTracker(STAR_DESTROYER_OBJECTIVES);
    this.killTracker = new KillTracker(80);
    this.objectiveTracker.initialize();

    // Initialize HUD systems
    const hudContainer = sdctx.ctx.hud;
    this.objectiveHud = new ObjectiveHud(hudContainer);
    this.announcements = new AnnouncementSystem(hudContainer);
    this.radioChatter = new RadioChatterSystem(hudContainer);

    // Build starfield
    this.starfield = createStarfield(sdctx.currentSystem.seed);
    sdctx.ctx.scene.add(this.starfield);

    // Add debris field using extracted module
    spawnDebrisField(sdctx.ctx.scene, sdctx.assetLoader, sdctx.currentSystem.seed)
      .then((debris) => {
        this.debrisField = debris;
      });

    // Start mission
    this.startStarDestroyerMission(sdctx);

    // Queue initial radio chatter
    if (this.radioChatter) {
      this.radioChatter.queueMessages(STAR_DESTROYER_RADIO.approach, RadioSpeaker.WINGMAN, 5);
    }
  }

  tick(sdctx: StarDestroyerContext, dt: number): boolean {
    if (!this.mission) return false;

    this.missionTime += dt;

    // Sync targets (TIE fighters)
    const syncResult = syncTargets(
      sdctx.ctx,
      sdctx.ctx.scene,
      sdctx.targetMeshes,
      sdctx.explosions
    );

    // Track kills for objectives
    if (syncResult.killedCount > 0 && sdctx.shipEid !== null) {
      for (const killedEid of syncResult.killedEids) {
        const enemyType = this.enemyTypes.get(killedEid) ?? "tie_fighter";
        this.killTracker?.recordKill(enemyType, 1);
        this.enemyTypes.delete(killedEid);
      }
    }

    // Update array in place to preserve FlightMode's reference
    sdctx.targetEids.length = 0;
    sdctx.targetEids.push(...syncResult.targetEids);

    // Sync allies (wingmen) using extracted module - track deaths
    const prevAllyCount = getSDAllyCount(this.allyState);
    syncSDAllies(sdctx.ctx.world, sdctx.ctx.scene, this.allyState, sdctx.explosions);
    const newAllyCount = getSDAllyCount(this.allyState);
    if (newAllyCount < prevAllyCount) {
      this.wingmenLost += prevAllyCount - newAllyCount;
    }

    // Sync capital ships
    this.syncCapitalShips(sdctx);
    this.syncTurretProjectiles(sdctx);

    // Build objective context and update tracker
    if (this.objectiveTracker && this.killTracker) {
      const objContext = this.buildObjectiveContext(sdctx);
      const events = this.objectiveTracker.tick(dt, objContext);
      this.processObjectiveEvents(sdctx, events);
    }

    // Update mission phases (legacy - keep for compatibility)
    this.updateStarDestroyerMission(sdctx);

    // Update message timer
    if (this.mission.messageTimer > 0) {
      this.mission.messageTimer = Math.max(0, this.mission.messageTimer - dt);
    }

    // Update HUD systems
    this.announcements?.tick(dt);
    this.radioChatter?.tick(dt);

    return false;
  }

  /**
   * Build ObjectiveContext from current game state
   */
  private buildObjectiveContext(sdctx: StarDestroyerContext): ObjectiveContext {
    const ctx = createDefaultObjectiveContext();
    ctx.missionTime = this.missionTime;

    // Kill tracking
    if (this.killTracker) {
      ctx.kills = this.killTracker.getTrackingData();
    }

    // Ally tracking
    ctx.allies.alive = getSDAllyCount(this.allyState);
    ctx.allies.started = this.initialWingmenCount;

    // Player location
    if (sdctx.shipEid !== null) {
      ctx.location.playerPosition = {
        x: Transform.x[sdctx.shipEid] ?? 0,
        y: Transform.y[sdctx.shipEid] ?? 0,
        z: Transform.z[sdctx.shipEid] ?? 0
      };

      // Player shield
      if (hasComponent(sdctx.ctx.world, Shield, sdctx.shipEid)) {
        ctx.playerShieldPercent = ((Shield.sp[sdctx.shipEid] ?? 0) / (Shield.maxSp[sdctx.shipEid] ?? 1)) * 100;
      }
    }

    // Capital ship (Star Destroyer) status
    if (this.mission && hasComponent(sdctx.ctx.world, CapitalShipV2, this.mission.starDestroyerEid)) {
      ctx.entities.capitalShipDestroyed = false;
      ctx.entities.subsystemsDestroyed = this.mission.subsystemsDestroyed;
      ctx.entities.shieldGensDestroyed = this.mission.shieldsDown ? 2 : 0;
    } else {
      ctx.entities.capitalShipDestroyed = true;
      ctx.entities.subsystemsDestroyed = this.mission?.totalSubsystems ?? 0;
      ctx.entities.shieldGensDestroyed = 2;
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
  private processObjectiveEvents(sdctx: StarDestroyerContext, events: ObjectiveEvent[]): void {
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
            sdctx.ctx.profile.credits += event.objective.definition.rewardCredits;
            sdctx.ctx.scheduleSave();
          }
          break;

        case ObjectiveEventType.OBJECTIVE_MILESTONE:
          this.announcements?.announce(milestoneAnnouncement(event.message ?? ""));
          break;

        case ObjectiveEventType.OBJECTIVE_FAILED:
          if (!event.objective?.definition.isOptional) {
            this.mission!.phase = "fail";
            this.mission!.message = "MISSION FAILED";
            this.mission!.messageTimer = 8;
            this.announcements?.announce(missionFailedAnnouncement(event.message));
          }
          break;

        case ObjectiveEventType.MISSION_COMPLETE:
          this.mission!.phase = "success";
          this.mission!.message = `VICTORY  +${this.objectiveTracker?.getTotalCreditsEarned() ?? 0} CR`;
          this.mission!.messageTimer = 6;
          sdctx.ctx.profile.credits += this.mission!.rewardCredits;
          sdctx.ctx.scheduleSave();
          this.announcements?.announce(missionCompleteAnnouncement());
          break;

        case ObjectiveEventType.MISSION_FAILED:
          this.mission!.phase = "fail";
          this.mission!.message = "MISSION FAILED";
          this.mission!.messageTimer = 8;
          this.announcements?.announce(missionFailedAnnouncement(event.message));
          sdctx.ctx.scheduleSave();
          break;
      }
    }
  }

  handleHyperspace(_sdctx: StarDestroyerContext): boolean {
    if (!this.mission) return true;

    // Allow restart on success/fail
    if (this.mission.phase === "success" || this.mission.phase === "fail") {
      return true;
    }

    // Block during combat
    this.mission.message = "HYPERSPACE DISABLED - DESTROY THE STAR DESTROYER";
    this.mission.messageTimer = 2;
    return false;
  }

  updateHud(sdctx: StarDestroyerContext, els: FlightHudElements, dt: number): void {
    updatePlayerHudValues(els, sdctx.shipEid, sdctx.ctx);
    updateSystemInfo(els, sdctx.currentSystem, sdctx.ctx.profile.credits);

    // Update objective HUD
    if (this.objectiveTracker && this.objectiveHud) {
      this.objectiveHud.update(this.objectiveTracker, dt);
    }

    // Mission message
    if (this.mission) {
      if (this.mission.messageTimer > 0) {
        els.mission.textContent = this.mission.message;
      } else if (this.mission.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (this.mission.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        const active = this.objectiveTracker?.getActiveObjective();
        const objText = active ? active.definition.hudTextActive : "DESTROY STAR DESTROYER";
        els.mission.textContent = `${objText}  ${this.mission.subsystemsDestroyed}/${this.mission.totalSubsystems} SYSTEMS`;
      }
    }

    // Capital ship HUD
    this.updateCapitalShipHud(sdctx, els);

    // Target bracket
    if (sdctx.shipEid !== null) {
      const teid = Targeting.targetEid[sdctx.shipEid] ?? -1;
      if (teid >= 0 && Transform.x[teid] !== undefined) {
        this.lockState = updateTargetBracket(sdctx.ctx, els, sdctx.shipEid, teid, this.lockState, dt);
      } else {
        clearTargetBracket(els);
        this.lockState = { lockValue: 0, lockTargetEid: -1 };
      }
    }
  }

  getMissionMessage(_sdctx: StarDestroyerContext): string {
    if (!this.mission) return "";
    if (this.mission.messageTimer > 0) return this.mission.message;
    if (this.mission.phase === "success") return "VICTORY";
    if (this.mission.phase === "fail") return "MISSION FAILED";
    return `PHASE: ${this.mission.phase.toUpperCase()}`;
  }

  canLand(_sdctx: StarDestroyerContext): boolean {
    return false;
  }

  exit(sdctx: StarDestroyerContext): void {
    disposeStarfield(sdctx.ctx.scene, this.starfield);
    this.starfield = null;
    clearDebrisField(sdctx.ctx.scene, this.debrisField);
    this.debrisField = [];
    this.clearCapitalShips(sdctx);
    clearSDAllies(sdctx.ctx.world, sdctx.ctx.scene, this.allyState);
    this.mission = null;

    // Dispose HUD systems
    this.objectiveHud?.dispose();
    this.announcements?.dispose();
    this.radioChatter?.dispose();
    this.objectiveHud = null;
    this.announcements = null;
    this.radioChatter = null;
    this.objectiveTracker = null;
    this.killTracker = null;
    this.missionTime = 0;
    this.wingmenLost = 0;
    this.enemyTypes.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Accessors
  // ─────────────────────────────────────────────────────────────────────────────

  getMissionState(): StarDestroyerMissionState | null {
    return this.mission;
  }

  getCapitalShipEids(): number[] {
    return this.capitalShipEids;
  }

  getAllyCount(): number {
    return getSDAllyCount(this.allyState);
  }

  destroyStarDestroyerForTest(world: import("bitecs").IWorld): void {
    if (this.mission && this.capitalShipEids.length > 0) {
      const sdEid = this.mission.starDestroyerEid;
      if (hasComponent(world, CapitalShipV2, sdEid)) {
        CapitalShipV2.hullFore[sdEid] = 0;
        CapitalShipV2.hullMid[sdEid] = 0;
        CapitalShipV2.hullAft[sdEid] = 0;
        removeCapitalShipV2(world, sdEid);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mission Setup
  // ─────────────────────────────────────────────────────────────────────────────

  private startStarDestroyerMission(sdctx: StarDestroyerContext): void {
    this.clearCapitalShips(sdctx);
    clearSDAllies(sdctx.ctx.world, sdctx.ctx.scene, this.allyState);

    // Clear existing enemies
    for (const eid of sdctx.targetEids) removeEntity(sdctx.ctx.world, eid);
    sdctx.targetEids.length = 0;
    for (const mesh of sdctx.targetMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    sdctx.targetMeshes.clear();

    // Star Destroyer at origin
    const sdResult = this.spawnStarDestroyer(sdctx, 0, 0, 0, 1);

    // Player approach position
    const playerStartZ = 4800;
    const playerStartY = 350;

    // Initialize mission state
    this.mission = {
      phase: "approach",
      starDestroyerEid: sdResult.shipEid,
      tieFighterCount: 12,
      tieFightersKilled: 0,
      subsystemsDestroyed: 0,
      totalSubsystems: sdResult.subsystemEids.length,
      shieldsDown: false,
      rewardCredits: 2500,
      message: "RED SQUADRON: ATTACK FORMATION. INCOMING TIE FIGHTERS!",
      messageTimer: 6
    };

    // Position player
    if (sdctx.shipEid !== null) {
      Transform.x[sdctx.shipEid] = 0;
      Transform.y[sdctx.shipEid] = playerStartY;
      Transform.z[sdctx.shipEid] = playerStartZ;
      Transform.qx[sdctx.shipEid] = 0;
      Transform.qy[sdctx.shipEid] = 0;
      Transform.qz[sdctx.shipEid] = 0;
      Transform.qw[sdctx.shipEid] = 1;
      Velocity.vx[sdctx.shipEid] = 0;
      Velocity.vy[sdctx.shipEid] = 0;
      Velocity.vz[sdctx.shipEid] = 0;
      Ship.throttle[sdctx.shipEid] = 0.6;
    }

    // Spawn wingmen using extracted module
    spawnWingmenFormation(
      sdctx.ctx.world,
      sdctx.ctx.scene,
      this.allyState,
      playerStartY,
      playerStartZ
    );

    // Spawn TIE fighters using extracted module
    const tieResult = spawnTIEFighterScreen(
      sdctx.ctx.world,
      sdctx.ctx.scene,
      sdctx.currentSystem.seed,
      0 // Star Destroyer Z
    );
    for (const [eid, mesh] of tieResult.meshes) {
      sdctx.targetMeshes.set(eid, mesh);
    }
    sdctx.targetEids.push(...tieResult.eids);
    for (const [eid, type] of tieResult.enemyTypes) {
      this.enemyTypes.set(eid, type);
    }

    rebuildSpaceCombatIndex(sdctx.ctx.world);
    sdctx.ctx.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Capital Ship Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnStarDestroyer(
    sdctx: StarDestroyerContext,
    x: number,
    y: number,
    z: number,
    team: number
  ): { shipEid: number; turretEids: number[]; subsystemEids: number[] } {
    const result = spawnCapitalShipV2(sdctx.ctx.world, {
      shipClass: 3,
      team,
      x,
      y,
      z
    });

    // Create mesh
    const mesh = createProceduralShip({ type: "star_destroyer", scale: 5.0, enableShadows: true });
    mesh.position.set(x, y, z);
    sdctx.ctx.scene.add(mesh);
    this.capitalShipMeshes.set(result.shipEid, mesh);
    this.capitalShipEids.push(result.shipEid);

    // Create turret meshes
    for (const tid of result.turretEids) {
      const turretType = Turret.turretType[tid] ?? 0;
      const turretMesh = buildTurretMesh(turretType, sdctx.assetLoader, sdctx.assetsReady);
      turretMesh.position.set(
        Transform.x[tid] ?? 0,
        Transform.y[tid] ?? 0,
        Transform.z[tid] ?? 0
      );
      sdctx.ctx.scene.add(turretMesh);
      this.turretMeshes.set(tid, turretMesh);
    }

    // Create subsystem indicator meshes
    for (const sid of result.subsystemEids) {
      const type = Subsystem.subsystemType[sid] ?? 0;
      const subMesh = buildSubsystemMesh(type);
      subMesh.position.set(
        Transform.x[sid] ?? 0,
        Transform.y[sid] ?? 0,
        Transform.z[sid] ?? 0
      );
      sdctx.ctx.scene.add(subMesh);
      this.subsystemMeshes.set(sid, subMesh);
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mission Update
  // ─────────────────────────────────────────────────────────────────────────────

  private updateStarDestroyerMission(sdctx: StarDestroyerContext): void {
    const m = this.mission;
    if (!m) return;

    // Check if Star Destroyer is destroyed
    const sdAlive = hasComponent(sdctx.ctx.world, CapitalShipV2, m.starDestroyerEid);
    if (!sdAlive && m.phase !== "success" && m.phase !== "fail") {
      m.phase = "success";
      m.message = "STAR DESTROYER DESTROYED! MISSION COMPLETE!";
      m.messageTimer = 8;
      sdctx.ctx.profile.credits += m.rewardCredits;
      sdctx.ctx.scheduleSave();
      return;
    }

    // Count alive TIEs
    const aliveTies = sdctx.targetEids.filter(eid =>
      hasComponent(sdctx.ctx.world, Ship, eid) &&
      hasComponent(sdctx.ctx.world, Health, eid) &&
      (Health.hp[eid] ?? 0) > 0
    ).length;

    // Count destroyed subsystems
    const subsystemQuery = defineQuery([Subsystem]);
    const subsystems = subsystemQuery(sdctx.ctx.world).filter((eid: number) => Subsystem.parentEid[eid] === m.starDestroyerEid);
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
        if (aliveTies === 0) {
          m.phase = "shields";
          m.message = "TIE SCREEN CLEARED! TARGET THE SHIELD GENERATORS!";
          m.messageTimer = 5;
        }
        break;

      case "shields":
        if (m.shieldsDown) {
          m.phase = "subsystems";
          m.message = "SHIELDS DOWN! TARGET THE BRIDGE OR ENGINES!";
          m.messageTimer = 5;
        }
        break;

      case "subsystems":
        if (destroyedSubsystems >= 3) {
          m.phase = "final";
          m.message = "SUBSYSTEMS CRITICAL! ATTACK THE HULL!";
          m.messageTimer = 5;
        }
        break;

      case "final":
      case "success":
      case "fail":
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Capital Ship Sync
  // ─────────────────────────────────────────────────────────────────────────────

  private syncCapitalShips(sdctx: StarDestroyerContext): void {
    // Sync capital ship hulls
    for (let i = this.capitalShipEids.length - 1; i >= 0; i--) {
      const eid = this.capitalShipEids[i]!;

      if (!hasComponent(sdctx.ctx.world, CapitalShipV2, eid)) {
        const mesh = this.capitalShipMeshes.get(eid);
        if (mesh) {
          sdctx.explosions?.spawn(
            this.tmpExplosionPos.copy(mesh.position),
            0xff8844,
            2.0,
            30
          );
          sdctx.ctx.scene.remove(mesh);
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
      if (!hasComponent(sdctx.ctx.world, Turret, tid)) {
        sdctx.ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.turretMeshes.delete(tid);
        continue;
      }

      mesh.position.set(
        Transform.x[tid] ?? 0,
        Transform.y[tid] ?? 0,
        Transform.z[tid] ?? 0
      );
      const yaw = Turret.yaw[tid] ?? 0;
      const pitch = Turret.pitch[tid] ?? 0;
      (mesh as THREE.Object3D).rotation.set(pitch, yaw, 0, "YXZ");
    }

    // Sync subsystems
    for (const [sid, mesh] of this.subsystemMeshes) {
      if (!hasComponent(sdctx.ctx.world, Subsystem, sid)) {
        sdctx.ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.subsystemMeshes.delete(sid);
        continue;
      }

      mesh.position.set(
        Transform.x[sid] ?? 0,
        Transform.y[sid] ?? 0,
        Transform.z[sid] ?? 0
      );

      const ring = mesh.children[1];
      if (ring) {
        ring.rotation.z += 0.02;
      }

      const disabled = Subsystem.disabled[sid] === 1;
      mesh.visible = !disabled;
    }
  }

  private syncTurretProjectiles(sdctx: StarDestroyerContext): void {
    const fireEvents = consumeTurretFireEvents();
    for (const evt of fireEvents) {
      sdctx.explosions?.spawn(
        this.tmpExplosionPos.set(evt.x, evt.y, evt.z),
        evt.team === 0 ? 0xff6666 : 0x44ff44,
        0.08,
        1.5
      );
    }

    const destroyedEvents = consumeSubsystemDestroyedEvents();
    for (const evt of destroyedEvents) {
      sdctx.explosions?.spawn(
        this.tmpExplosionPos.set(evt.x, evt.y, evt.z),
        0xff8844,
        0.6,
        8
      );
    }
  }

  private clearCapitalShips(sdctx: StarDestroyerContext): void {
    for (const eid of this.capitalShipEids) {
      removeCapitalShipV2(sdctx.ctx.world, eid);
    }
    this.capitalShipEids = [];

    for (const mesh of this.capitalShipMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.capitalShipMeshes.clear();

    for (const mesh of this.turretMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretMeshes.clear();

    for (const mesh of this.subsystemMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.subsystemMeshes.clear();

    for (const mesh of this.turretProjectileMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretProjectileMeshes.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Capital Ship HUD
  // ─────────────────────────────────────────────────────────────────────────────

  private updateCapitalShipHud(sdctx: StarDestroyerContext, els: FlightHudElements): void {
    if (this.capitalShipEids.length === 0) {
      els.capitalPanel.classList.add("hidden");
      return;
    }

    const shipEid = this.capitalShipEids[0]!;
    if (!hasComponent(sdctx.ctx.world, CapitalShipV2, shipEid)) {
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

    let subsystemHtml = "";
    for (const [sid] of this.subsystemMeshes) {
      if (!hasComponent(sdctx.ctx.world, Subsystem, sid)) continue;
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
}
