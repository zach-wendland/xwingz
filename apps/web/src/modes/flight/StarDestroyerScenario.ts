/**
 * StarDestroyerScenario - Destroy the Imperial Star Destroyer mission
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent, defineQuery } from "bitecs";
import { createRng, deriveSeed, getFighterArchetype, type SystemDef } from "@xwingz/procgen";
import { createProceduralShip, AssetLoader, KENNEY_ASSETS } from "@xwingz/render";
import {
  AIControlled,
  AngularVelocity,
  FighterBrain,
  Health,
  HitRadius,
  LaserWeapon,
  Shield,
  Ship,
  Targetable,
  Team,
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
  // Objective system
  ObjectiveTracker,
  KillTracker,
  type ObjectiveDefinition,
  type ObjectiveContext,
  type ObjectiveEvent,
  ObjectiveStatus,
  ObjectiveEventType,
  TriggerType,
  ProgressIndicatorType,
  ObjectivePriority,
  createDefaultObjectiveContext
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
  buildEnemyMesh,
  buildAllyMesh,
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
// Star Destroyer Objective Definitions
// ─────────────────────────────────────────────────────────────────────────────

const STAR_DESTROYER_OBJECTIVES: ObjectiveDefinition[] = [
  {
    id: "sd_obj_1",
    name: "Clear Fighter Screen",
    description: "Destroy the TIE Fighter intercept force protecting the Star Destroyer",
    hudText: "CLEAR TIE SCREEN: 0/12",
    hudTextActive: "ENGAGING TIE FIGHTERS",
    hudTextComplete: "FIGHTER SCREEN ELIMINATED",
    phase: "approach",
    sequence: 1,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "tie_fighter", count: 12 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 12,
    rewardCredits: 200,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.approach,
    radioOnComplete: ["Fighter screen destroyed! Move in on the shields!"],
    radioMilestones: {
      "25": "Good shooting!",
      "50": "Halfway there!",
      "75": "Almost clear!"
    }
  },
  {
    id: "sd_obj_2",
    name: "Disable Shield Generators",
    description: "Destroy the dorsal shield generators to expose the Star Destroyer's hull",
    hudText: "DESTROY SHIELD GENERATORS: 0/2",
    hudTextActive: "TARGETING SHIELD GENERATORS",
    hudTextComplete: "SHIELDS DOWN",
    phase: "shields",
    sequence: 2,
    priority: ObjectivePriority.HIGH,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "sd_obj_1" },
    triggerComplete: { type: TriggerType.SUBSYSTEMS_DESTROYED, subsystemTypes: ["shield_gen"], count: 2 },
    progressType: ProgressIndicatorType.CIRCULAR_PROGRESS,
    progressMax: 2,
    rewardCredits: 400,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.shields,
    radioOnComplete: ["Shields are down! Target their critical systems!"]
  },
  {
    id: "sd_obj_3",
    name: "Destroy Critical Subsystems",
    description: "Target the bridge, engines, or power core to cripple the Star Destroyer",
    hudText: "SUBSYSTEMS: 0/3 CRITICAL",
    hudTextActive: "ATTACKING SUBSYSTEMS",
    hudTextComplete: "SUBSYSTEMS CRIPPLED",
    phase: "subsystems",
    sequence: 3,
    priority: ObjectivePriority.HIGH,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "sd_obj_2" },
    triggerComplete: { type: TriggerType.SUBSYSTEMS_DESTROYED, count: 3, anyCombination: true },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 3,
    rewardCredits: 500,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.subsystems,
    radioOnComplete: ["She's crippled! Finish her off!"]
  },
  {
    id: "sd_obj_4",
    name: "Destroy the Star Destroyer",
    description: "Finish off the crippled Star Destroyer before reinforcements arrive",
    hudText: "DESTROY STAR DESTROYER",
    hudTextActive: "ATTACKING HULL",
    hudTextComplete: "STAR DESTROYER DESTROYED",
    phase: "final",
    sequence: 4,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "sd_obj_3" },
    triggerComplete: { type: TriggerType.ENTITY_DESTROYED, entity: "star_destroyer" },
    progressType: ProgressIndicatorType.PROGRESS_BAR,
    progressMax: 100,
    rewardCredits: 1000,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.final,
    radioOnComplete: ["That's a kill! Star Destroyer destroyed!"]
  },
  {
    id: "sd_bonus_1",
    name: "No Casualties",
    description: "Complete the mission without losing any wingmen",
    hudText: "BONUS: PROTECT SQUADRON",
    hudTextActive: "WINGMEN ALIVE: 5/5",
    hudTextComplete: "SQUADRON INTACT!",
    phase: "combat",
    sequence: 99,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: { type: TriggerType.ALLIES_ALIVE, count: 5 },
    triggerFail: { type: TriggerType.ALLY_DEATH },
    progressType: ProgressIndicatorType.NONE,
    progressMax: 1,
    rewardCredits: 750,
    isOptional: true,
    radioOnComplete: ["All wings accounted for! Outstanding leadership!"]
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// Star Destroyer Scenario Handler
// ─────────────────────────────────────────────────────────────────────────────

export class StarDestroyerScenario {
  // Starfield
  private starfield: THREE.Points | null = null;

  // Debris field (asteroids/wreckage)
  private debrisField: THREE.Object3D[] = [];

  // Capital ships
  private capitalShipEids: number[] = [];
  private capitalShipMeshes = new Map<number, THREE.Object3D>();
  private turretMeshes = new Map<number, THREE.Object3D>();
  private subsystemMeshes = new Map<number, THREE.Object3D>();
  private turretProjectileMeshes = new Map<number, THREE.Mesh>();

  // Allies (wingmen)
  private allyEids: number[] = [];
  private allyMeshes = new Map<number, THREE.Object3D>();

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

    // Add debris field (asteroids/wreckage)
    this.spawnDebrisField(sdctx);

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
      for (const _killedEid of syncResult.killedEids) {
        this.killTracker?.recordKill("tie_fighter", 1);
      }
    }

    // Update array in place to preserve FlightMode's reference
    sdctx.targetEids.length = 0;
    sdctx.targetEids.push(...syncResult.targetEids);

    // Sync allies (wingmen) - track deaths
    const prevAllyCount = this.allyEids.length;
    this.syncAllies(sdctx);
    if (this.allyEids.length < prevAllyCount) {
      this.wingmenLost += prevAllyCount - this.allyEids.length;
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
    this.updateStarDestroyerMission(sdctx, dt);

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
    ctx.allies.alive = this.allyEids.length;
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

    // Capital ship (Star Destroyer) status - use entities tracking
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
      return true; // Let FlightMode handle restart
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
        // Show active objective
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
    return false; // No landing in this scenario
  }

  exit(sdctx: StarDestroyerContext): void {
    disposeStarfield(sdctx.ctx.scene, this.starfield);
    this.starfield = null;
    this.clearDebrisField(sdctx);
    this.clearCapitalShips(sdctx);
    this.clearAllies(sdctx);
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
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Debris Field (Asteroids & Wreckage)
  // ─────────────────────────────────────────────────────────────────────────────

  private async spawnDebrisField(sdctx: StarDestroyerContext): Promise<void> {
    const rng = createRng(deriveSeed(sdctx.currentSystem.seed, "sd_debris"));

    // Preload Kenney debris assets
    const debrisAssets = [
      KENNEY_ASSETS.METEOR_DETAILED,
      KENNEY_ASSETS.METEOR,
      KENNEY_ASSETS.METEOR_HALF,
      KENNEY_ASSETS.ROCK_LARGE_A,
      KENNEY_ASSETS.ROCK_LARGE_B,
      KENNEY_ASSETS.ROCK
    ];

    try {
      await sdctx.assetLoader.preload(debrisAssets);
    } catch {
      // Assets not available, use procedural fallbacks
      this.spawnProceduralDebris(sdctx, rng);
      return;
    }

    // DISTANT BACKDROP (z = -2000 to -4000, behind the Star Destroyer)
    // Silhouettes the destroyer, establishes scale
    const backdropDebris = [
      { asset: KENNEY_ASSETS.METEOR_DETAILED, x: -1800, y: 400, z: -2800, scale: 12 },
      { asset: KENNEY_ASSETS.METEOR_DETAILED, x: 2200, y: -300, z: -3200, scale: 10 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 800, y: 600, z: -2500, scale: 14 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -1200, y: -500, z: -3500, scale: 11 },
      { asset: KENNEY_ASSETS.METEOR_DETAILED, x: 0, y: 800, z: -4000, scale: 15 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: -2500, y: 200, z: -3000, scale: 13 },
      { asset: KENNEY_ASSETS.METEOR_DETAILED, x: 1500, y: -600, z: -2600, scale: 9 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -800, y: 700, z: -3800, scale: 12 }
    ];

    // FLANKING DEBRIS (combat periphery on either side)
    // Defines combat arena boundaries
    const leftFlankDebris = [
      { asset: KENNEY_ASSETS.METEOR, x: -2000, y: 100, z: 1500, scale: 5 },
      { asset: KENNEY_ASSETS.METEOR_HALF, x: -1800, y: -200, z: 800, scale: 4 },
      { asset: KENNEY_ASSETS.ROCK, x: -2200, y: 300, z: 2200, scale: 3.5 },
      { asset: KENNEY_ASSETS.METEOR, x: -1600, y: -100, z: -500, scale: 4.5 },
      { asset: KENNEY_ASSETS.ROCK, x: -2400, y: 200, z: 500, scale: 3 }
    ];

    const rightFlankDebris = [
      { asset: KENNEY_ASSETS.METEOR, x: 1900, y: -150, z: 1200, scale: 5 },
      { asset: KENNEY_ASSETS.METEOR_HALF, x: 2100, y: 250, z: 2500, scale: 4 },
      { asset: KENNEY_ASSETS.ROCK, x: 1700, y: 0, z: 600, scale: 3.5 },
      { asset: KENNEY_ASSETS.METEOR, x: 2300, y: -50, z: -200, scale: 4 },
      { asset: KENNEY_ASSETS.ROCK, x: 1500, y: 350, z: 3000, scale: 3 }
    ];

    // CLOSE DEBRIS (near Star Destroyer - recent battle damage)
    const closeDebris = [
      { asset: KENNEY_ASSETS.METEOR_HALF, x: 300, y: 80, z: -400, scale: 2 },
      { asset: KENNEY_ASSETS.METEOR_HALF, x: -250, y: -60, z: -200, scale: 1.5 },
      { asset: KENNEY_ASSETS.ROCK, x: 150, y: 120, z: -600, scale: 1.8 },
      { asset: KENNEY_ASSETS.METEOR_HALF, x: -400, y: 40, z: -100, scale: 1.2 }
    ];

    const allDebris = [...backdropDebris, ...leftFlankDebris, ...rightFlankDebris, ...closeDebris];

    // Spawn all debris
    for (const debris of allDebris) {
      try {
        const mesh = sdctx.assetLoader.clone(debris.asset);
        mesh.position.set(debris.x, debris.y, debris.z);
        mesh.scale.setScalar(debris.scale);
        // Random rotation for variety
        mesh.rotation.set(
          rng.range(0, Math.PI * 2),
          rng.range(0, Math.PI * 2),
          rng.range(0, Math.PI * 2)
        );
        // Darken to match cold space aesthetic
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.color) mat.color.setHex(0x3a3a3a);
            mat.roughness = 0.95;
          }
        });
        sdctx.ctx.scene.add(mesh);
        this.debrisField.push(mesh);
      } catch {
        // Individual asset failed, continue
      }
    }
  }

  /**
   * Fallback procedural debris when Kenney assets aren't available
   */
  private spawnProceduralDebris(sdctx: StarDestroyerContext, rng: ReturnType<typeof createRng>): void {
    const asteroidGeo = new THREE.DodecahedronGeometry(1, 1);
    const asteroidMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 });

    const debrisPositions = [
      // Backdrop
      { x: -1800, y: 400, z: -2800, scale: 80 },
      { x: 2200, y: -300, z: -3200, scale: 70 },
      { x: 800, y: 600, z: -2500, scale: 90 },
      { x: 0, y: 800, z: -4000, scale: 100 },
      // Flanks
      { x: -2000, y: 100, z: 1500, scale: 35 },
      { x: 1900, y: -150, z: 1200, scale: 35 },
      { x: -1800, y: -200, z: 800, scale: 28 },
      { x: 2100, y: 250, z: 2500, scale: 28 }
    ];

    for (const pos of debrisPositions) {
      const asteroid = new THREE.Mesh(asteroidGeo, asteroidMat);
      asteroid.position.set(pos.x, pos.y, pos.z);
      asteroid.scale.set(
        pos.scale * rng.range(0.7, 1.3),
        pos.scale * rng.range(0.5, 1.0),
        pos.scale * rng.range(0.7, 1.3)
      );
      asteroid.rotation.set(
        rng.range(0, Math.PI * 2),
        rng.range(0, Math.PI * 2),
        rng.range(0, Math.PI * 2)
      );
      sdctx.ctx.scene.add(asteroid);
      this.debrisField.push(asteroid);
    }
  }

  private clearDebrisField(sdctx: StarDestroyerContext): void {
    for (const debris of this.debrisField) {
      sdctx.ctx.scene.remove(debris);
      disposeObject(debris);
    }
    this.debrisField = [];
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
    return this.allyEids.length;
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
    this.clearAllies(sdctx);

    // Clear existing enemies (mutate arrays in place to preserve FlightMode's reference)
    for (const eid of sdctx.targetEids) removeEntity(sdctx.ctx.world, eid);
    sdctx.targetEids.length = 0;
    for (const mesh of sdctx.targetMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    sdctx.targetMeshes.clear();

    // Star Destroyer at origin, facing -Z (forward)
    const sdResult = this.spawnStarDestroyer(sdctx, 0, 0, 0, 1);

    // Player approaches from top rear (~30 seconds out at cruise speed)
    // X-Wing cruise speed ~170 units/sec at 0.5 throttle, 30 sec = ~5000 units
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

    // Position player at top rear, facing the destroyer
    if (sdctx.shipEid !== null) {
      Transform.x[sdctx.shipEid] = 0;
      Transform.y[sdctx.shipEid] = playerStartY;
      Transform.z[sdctx.shipEid] = playerStartZ;
      // Face toward the destroyer (facing -Z direction)
      Transform.qx[sdctx.shipEid] = 0;
      Transform.qy[sdctx.shipEid] = 0;
      Transform.qz[sdctx.shipEid] = 0;
      Transform.qw[sdctx.shipEid] = 1;
      Velocity.vx[sdctx.shipEid] = 0;
      Velocity.vy[sdctx.shipEid] = 0;
      Velocity.vz[sdctx.shipEid] = 0;
      Ship.throttle[sdctx.shipEid] = 0.6;
    }

    // Spawn 5 wingmen in attack formation with the player
    this.spawnWingmenFormation(sdctx, playerStartY, playerStartZ);

    // Spawn 12 TIE fighters as intercept force (between player and destroyer)
    this.spawnTieInterceptForce(sdctx, sdctx.currentSystem.seed, this.mission.tieFighterCount);

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
      shipClass: 3, // ShipClass.Destroyer
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

  /**
   * Spawn TIE fighters as an intercept force between the player and Star Destroyer.
   * They start halfway between player spawn and the destroyer, heading toward the player.
   */
  private spawnTieInterceptForce(sdctx: StarDestroyerContext, seed: bigint, count: number): void {
    const rng = createRng(deriveSeed(seed, "sd_intercept", "ties_v1"));

    // Intercept position: halfway between player (z=4800) and destroyer (z=0)
    const interceptZ = 2400;
    const interceptY = 200;

    for (let i = 0; i < count; i++) {
      const archetype = getFighterArchetype("tie_ln");

      // Spread TIEs in a wide attack formation
      const row = Math.floor(i / 4);
      const col = i % 4;
      const x = (col - 1.5) * 80 + rng.range(-20, 20);
      const y = interceptY + row * 40 + rng.range(-15, 15);
      const z = interceptZ + row * 60 + rng.range(-30, 30);

      const eid = addEntity(sdctx.ctx.world);
      addComponent(sdctx.ctx.world, Transform, eid);
      addComponent(sdctx.ctx.world, Velocity, eid);
      addComponent(sdctx.ctx.world, AngularVelocity, eid);
      addComponent(sdctx.ctx.world, Team, eid);
      addComponent(sdctx.ctx.world, Ship, eid);
      addComponent(sdctx.ctx.world, LaserWeapon, eid);
      addComponent(sdctx.ctx.world, Targetable, eid);
      addComponent(sdctx.ctx.world, Health, eid);
      addComponent(sdctx.ctx.world, HitRadius, eid);
      addComponent(sdctx.ctx.world, Shield, eid);
      addComponent(sdctx.ctx.world, FighterBrain, eid);
      addComponent(sdctx.ctx.world, AIControlled, eid);

      Transform.x[eid] = x;
      Transform.y[eid] = y;
      Transform.z[eid] = z;
      // Face toward player (facing +Z direction)
      Transform.qx[eid] = 0;
      Transform.qy[eid] = 1;
      Transform.qz[eid] = 0;
      Transform.qw[eid] = 0;

      // Give them initial velocity toward the player
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = archetype.maxSpeed * 0.6;

      AngularVelocity.wx[eid] = 0;
      AngularVelocity.wy[eid] = 0;
      AngularVelocity.wz[eid] = 0;

      Team.id[eid] = 1;

      Ship.maxSpeed[eid] = archetype.maxSpeed;
      Ship.throttle[eid] = 0.85;
      Ship.accel[eid] = archetype.accel;
      Ship.turnRate[eid] = archetype.turnRate;

      LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
      LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
      LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
      LaserWeapon.damage[eid] = archetype.damage;

      Health.hp[eid] = archetype.hp;
      Health.maxHp[eid] = archetype.hp;
      HitRadius.r[eid] = archetype.hitRadius;

      Shield.maxSp[eid] = 0;
      Shield.sp[eid] = 0;
      Shield.regenRate[eid] = 0;
      Shield.lastHit[eid] = 999;

      FighterBrain.state[eid] = 0;
      FighterBrain.stateTime[eid] = 0;
      FighterBrain.aggression[eid] = 0.95;
      FighterBrain.evadeBias[eid] = 0.25;
      FighterBrain.targetEid[eid] = sdctx.shipEid ?? -1;

      sdctx.targetEids.push(eid);

      const mesh = buildEnemyMesh("tie_ln");
      mesh.position.set(x, y, z);
      sdctx.ctx.scene.add(mesh);
      sdctx.targetMeshes.set(eid, mesh);
    }

    rebuildSpaceCombatIndex(sdctx.ctx.world);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Wingmen Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Spawn 5 wingmen in attack V-formation with the player
   */
  private spawnWingmenFormation(sdctx: StarDestroyerContext, playerY: number, playerZ: number): void {
    // V-formation offsets (x, z relative to player)
    const formationOffsets = [
      { x: -35, z: 25 },   // Left wing 1
      { x: 35, z: 25 },    // Right wing 1
      { x: -70, z: 50 },   // Left wing 2
      { x: 70, z: 50 },    // Right wing 2
      { x: 0, z: 60 }      // Tail
    ];

    for (let i = 0; i < formationOffsets.length; i++) {
      const offset = formationOffsets[i]!;
      this.spawnWingman(sdctx, i, offset.x, playerY - 10 + (i % 2) * 8, playerZ + offset.z);
    }
  }

  /**
   * Spawn a single wingman X-Wing
   */
  private spawnWingman(sdctx: StarDestroyerContext, slot: number, x: number, y: number, z: number): void {
    const archetype = getFighterArchetype("xwing_player");
    const eid = addEntity(sdctx.ctx.world);

    addComponent(sdctx.ctx.world, Transform, eid);
    addComponent(sdctx.ctx.world, Velocity, eid);
    addComponent(sdctx.ctx.world, AngularVelocity, eid);
    addComponent(sdctx.ctx.world, Team, eid);
    addComponent(sdctx.ctx.world, Ship, eid);
    addComponent(sdctx.ctx.world, LaserWeapon, eid);
    addComponent(sdctx.ctx.world, Health, eid);
    addComponent(sdctx.ctx.world, HitRadius, eid);
    addComponent(sdctx.ctx.world, Shield, eid);
    addComponent(sdctx.ctx.world, FighterBrain, eid);
    addComponent(sdctx.ctx.world, AIControlled, eid);

    Transform.x[eid] = x;
    Transform.y[eid] = y;
    Transform.z[eid] = z;
    // Face toward the destroyer (facing -Z)
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

    Team.id[eid] = 0; // Rebel team

    Ship.throttle[eid] = 0.55;
    Ship.maxSpeed[eid] = archetype.maxSpeed * 0.98;
    Ship.accel[eid] = archetype.accel * 0.95;
    Ship.turnRate[eid] = archetype.turnRate * 0.95;

    LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
    LaserWeapon.cooldownRemaining[eid] = 0;
    LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
    LaserWeapon.damage[eid] = archetype.damage;

    Health.hp[eid] = archetype.hp * 1.3;
    Health.maxHp[eid] = archetype.hp * 1.3;
    HitRadius.r[eid] = archetype.hitRadius;

    Shield.maxSp[eid] = 80;
    Shield.sp[eid] = 80;
    Shield.regenRate[eid] = 8;
    Shield.lastHit[eid] = 999;

    FighterBrain.state[eid] = 0;
    FighterBrain.stateTime[eid] = 0;
    FighterBrain.aggression[eid] = 0.85;
    FighterBrain.evadeBias[eid] = 0.35;
    FighterBrain.targetEid[eid] = -1;

    const mesh = buildAllyMesh(slot);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(2.45);
    sdctx.ctx.scene.add(mesh);
    this.allyMeshes.set(eid, mesh);
    this.allyEids.push(eid);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Ally Sync
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Sync ally (wingmen) positions and handle deaths
   */
  private syncAllies(sdctx: StarDestroyerContext): void {
    for (let i = this.allyEids.length - 1; i >= 0; i--) {
      const eid = this.allyEids[i]!;

      // Check if ally is dead or removed
      if (
        !hasComponent(sdctx.ctx.world, Transform, eid) ||
        !hasComponent(sdctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        const mesh = this.allyMeshes.get(eid);
        if (mesh) {
          sdctx.explosions?.spawn(this.tmpExplosionPos.copy(mesh.position), 0x66aaff);
          sdctx.ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.allyMeshes.delete(eid);
        }
        this.allyEids.splice(i, 1);
        continue;
      }

      // Update mesh position
      const mesh = this.allyMeshes.get(eid);
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

  /**
   * Clear all wingmen
   */
  private clearAllies(sdctx: StarDestroyerContext): void {
    for (const eid of this.allyEids) {
      if (hasComponent(sdctx.ctx.world, Transform, eid)) {
        removeEntity(sdctx.ctx.world, eid);
      }
    }
    this.allyEids = [];

    for (const mesh of this.allyMeshes.values()) {
      sdctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.allyMeshes.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mission Update
  // ─────────────────────────────────────────────────────────────────────────────

  private updateStarDestroyerMission(sdctx: StarDestroyerContext, _dt: number): void {
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
