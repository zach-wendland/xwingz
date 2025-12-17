/**
 * YavinDefenseScenario - Defend the Great Temple on Yavin 4
 * Enhanced with 4 required objectives + 1 optional bonus objective
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";
import { createRng, deriveSeed, getFighterArchetype, type SystemDef } from "@xwingz/procgen";
import { AssetLoader, KENNEY_ASSETS } from "@xwingz/render";
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
  type YavinDefenseState,
  type TerrainParams,
  type TargetBracketState
} from "./FlightScenarioTypes";
import {
  buildEnemyMesh,
  buildAllyMesh,
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

// ─────────────────────────────────────────────────────────────────────────────
// Yavin Objective Definitions
// ─────────────────────────────────────────────────────────────────────────────

const YAVIN_OBJECTIVES: ObjectiveDefinition[] = [
  {
    id: "yd_obj_1",
    name: "Scramble Alert",
    description: "Launch from the Great Temple and form up with Red Squadron",
    hudText: "SCRAMBLE - FORM UP WITH RED SQUADRON",
    hudTextActive: "FORMING UP...",
    hudTextComplete: "RED SQUADRON READY",
    phase: "launch",
    sequence: 1,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: {
      type: TriggerType.COMPOUND,
      conditions: [
        { type: TriggerType.ALTITUDE_ABOVE, value: 80 },
        { type: TriggerType.NEAR_ALLIES, count: 3, radius: 150 },
        { type: TriggerType.DURATION, seconds: 2 }
      ]
    },
    progressType: ProgressIndicatorType.NONE,
    progressMax: 1,
    rewardCredits: 0,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.scramble,
    radioOnComplete: ["All wings report in - Red Squadron formed up"]
  },
  {
    id: "yd_obj_2",
    name: "Intercept First Wave",
    description: "Engage the incoming TIE Fighter wave before they reach the temple",
    hudText: "INTERCEPT WAVE 1: 0/6 TIEs",
    hudTextActive: "ENGAGING TIE FIGHTERS",
    hudTextComplete: "WAVE 1 ELIMINATED",
    phase: "combat_wave_1",
    sequence: 2,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_1" },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "tie_fighter", count: 6, waveId: 1 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 6,
    rewardCredits: 150,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.wave1,
    radioOnComplete: ["Wave cleared! But more incoming!"],
    radioMilestones: {
      "50": "Halfway there!",
      "75": "Almost got 'em!"
    }
  },
  {
    id: "yd_obj_3",
    name: "Bomber Defense",
    description: "TIE Bombers are making attack runs on the temple - destroy them!",
    hudText: "BOMBERS INBOUND - PROTECT THE TEMPLE",
    hudTextActive: "INTERCEPTING BOMBERS: 0/3",
    hudTextComplete: "BOMBERS ELIMINATED",
    phase: "combat_wave_2",
    sequence: 3,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_2" },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "tie_bomber", count: 3, waveId: 2 },
    triggerFail: { type: TriggerType.ENTITY_HEALTH_BELOW, entity: "great_temple", thresholdPercent: 30 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 3,
    rewardCredits: 300,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.wave2,
    radioOnComplete: ["Bombers neutralized!"]
  },
  {
    id: "yd_obj_4",
    name: "Final Assault",
    description: "The remaining Imperial forces are making a desperate all-out attack",
    hudText: "FINAL WAVE: 0/6 REMAINING",
    hudTextActive: "ELIMINATE REMAINING FORCES",
    hudTextComplete: "IMPERIAL ASSAULT REPELLED",
    phase: "combat_wave_3",
    sequence: 4,
    priority: ObjectivePriority.HIGH,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_3" },
    triggerComplete: { type: TriggerType.KILL_COUNT, count: 6, waveId: 3 },
    triggerFail: { type: TriggerType.ENTITY_HEALTH_BELOW, entity: "great_temple", thresholdPercent: 0 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 6,
    rewardCredits: 250,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.wave3,
    radioOnComplete: ["That's the last of them! Victory!"]
  },
  {
    id: "yd_bonus_1",
    name: "Ace Pilot",
    description: "Destroy 5 enemies consecutively without taking significant damage",
    hudText: "BONUS: ACE STREAK 0/5",
    hudTextActive: "ACE STREAK: 0/5",
    hudTextComplete: "ACE PILOT ACHIEVED!",
    phase: "combat",
    sequence: 99,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_1" },
    triggerComplete: { type: TriggerType.KILL_STREAK, count: 5 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 5,
    rewardCredits: 500,
    isOptional: true,
    radioOnComplete: ["Great shot! That was one in a million!"]
  }
];

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
  // Terrain
  private terrainParams: TerrainParams | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private treeTrunks: THREE.InstancedMesh | null = null;
  private treeCanopies: THREE.InstancedMesh | null = null;

  // Environmental props (rocks, turrets, generators)
  private environmentalProps: THREE.Object3D[] = [];

  // Base
  private baseEid: number | null = null;
  private baseMesh: THREE.Object3D | null = null;

  // Allies (wingmen)
  private allyEids: number[] = [];
  private allyMeshes = new Map<number, THREE.Object3D>();

  // Mission state
  private yavin: YavinDefenseState | null = null;

  // Wave tracking for objectives
  private currentWave = 0;
  private waveEnemyTypes = new Map<number, string>(); // eid -> enemy type
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

  // Temp matrix
  private tmpMat = new THREE.Matrix4();
  private tmpExplosionPos = new THREE.Vector3();

  enter(yctx: YavinContext): void {
    this.lockState = { lockValue: 0, lockTargetEid: -1 };
    this.missionTime = 0;
    this.currentWave = 0;
    this.waveEnemyTypes.clear();

    // Initialize objective system
    this.objectiveTracker = new ObjectiveTracker(YAVIN_OBJECTIVES);
    this.killTracker = new KillTracker(80); // Reset streak if shield < 80%
    this.objectiveTracker.initialize();

    // Initialize HUD systems
    const hudContainer = yctx.ctx.hud;
    this.objectiveHud = new ObjectiveHud(hudContainer);
    this.announcements = new AnnouncementSystem(hudContainer);
    this.radioChatter = new RadioChatterSystem(hudContainer);

    // Build terrain
    this.buildYavinPlanet(yctx);

    // Add environmental props (rocks, turrets, generators)
    this.spawnEnvironmentalProps(yctx);

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
    const syncResult = syncTargets(
      yctx.ctx,
      yctx.ctx.scene,
      yctx.targetMeshes,
      yctx.explosions
    );

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

    // Sync allies
    this.syncAllies(yctx);

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
    for (const eid of this.allyEids) {
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
      const altitude = (Transform.y[yctx.shipEid] ?? 0) - this.terrainHeight(
        Transform.x[yctx.shipEid] ?? 0,
        Transform.z[yctx.shipEid] ?? 0
      );
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
    ctx.allies.alive = this.allyEids.length;
    ctx.allies.started = 5;

    // Count allies near player
    if (yctx.shipEid !== null) {
      const px = Transform.x[yctx.shipEid] ?? 0;
      const py = Transform.y[yctx.shipEid] ?? 0;
      const pz = Transform.z[yctx.shipEid] ?? 0;

      let nearbyCount = 0;
      for (const allyEid of this.allyEids) {
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
        ctx.playerShieldPercent = ((Shield.sp[yctx.shipEid] ?? 0) / (Shield.maxSp[yctx.shipEid] ?? 1)) * 100;
      }
    }

    // Base health
    if (this.baseEid !== null && hasComponent(yctx.ctx.world, Health, this.baseEid)) {
      ctx.entities.baseHealth = Health.hp[this.baseEid] ?? 0;
      ctx.entities.baseHealthPercent = ((Health.hp[this.baseEid] ?? 0) / (this.yavin?.baseHpMax ?? 2000)) * 100;
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
      this.spawnWave2Bombers(yctx);
    }

    // Wave 2 -> Wave 3 transition (spawn final wave)
    if (active.definition.id === "yd_obj_4" && this.currentWave < 3) {
      this.currentWave = 3;
      this.spawnWave3FinalAssault(yctx);
    }
  }

  /**
   * Spawn Wave 2 - TIE Bombers
   */
  private spawnWave2Bombers(yctx: YavinContext): void {
    const rng = createRng(deriveSeed(yctx.currentSystem.seed, "yavin_wave2"));

    for (let i = 0; i < 3; i++) {
      const archetype = getFighterArchetype("tie_ln"); // Use TIE stats as base
      const angle = rng.range(-0.3, 0.3);
      const x = rng.range(-400, 400);
      const z = -2200 + rng.range(-200, 200);
      const y = 140 + rng.range(0, 60); // Lower altitude for bombers

      const eid = addEntity(yctx.ctx.world);
      addComponent(yctx.ctx.world, Transform, eid);
      addComponent(yctx.ctx.world, Velocity, eid);
      addComponent(yctx.ctx.world, AngularVelocity, eid);
      addComponent(yctx.ctx.world, Team, eid);
      addComponent(yctx.ctx.world, Ship, eid);
      addComponent(yctx.ctx.world, LaserWeapon, eid);
      addComponent(yctx.ctx.world, Targetable, eid);
      addComponent(yctx.ctx.world, Health, eid);
      addComponent(yctx.ctx.world, HitRadius, eid);
      addComponent(yctx.ctx.world, Shield, eid);
      addComponent(yctx.ctx.world, FighterBrain, eid);
      addComponent(yctx.ctx.world, AIControlled, eid);

      Transform.x[eid] = x;
      Transform.y[eid] = y;
      Transform.z[eid] = z;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + angle, 0));
      Transform.qx[eid] = q.x;
      Transform.qy[eid] = q.y;
      Transform.qz[eid] = q.z;
      Transform.qw[eid] = q.w;

      Team.id[eid] = 1;

      // Bombers are slower but tougher
      Ship.throttle[eid] = 0.5;
      Ship.maxSpeed[eid] = archetype.maxSpeed * 0.6;
      Ship.accel[eid] = archetype.accel * 0.7;
      Ship.turnRate[eid] = archetype.turnRate * 0.7;

      LaserWeapon.cooldown[eid] = archetype.weaponCooldown * 2;
      LaserWeapon.cooldownRemaining[eid] = 0;
      LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
      LaserWeapon.damage[eid] = 15; // Higher damage

      Health.hp[eid] = 80; // Tougher
      Health.maxHp[eid] = 80;
      HitRadius.r[eid] = archetype.hitRadius * 1.3; // Bigger target

      Shield.maxSp[eid] = 15;
      Shield.sp[eid] = 15;
      Shield.regenRate[eid] = 3;
      Shield.lastHit[eid] = 999;

      // Target the base
      FighterBrain.state[eid] = 0;
      FighterBrain.stateTime[eid] = 0;
      FighterBrain.aggression[eid] = 0.9;
      FighterBrain.evadeBias[eid] = 0.2;
      FighterBrain.targetEid[eid] = this.baseEid ?? -1;

      // Track enemy type for kill tracking
      this.waveEnemyTypes.set(eid, "tie_bomber");

      // Build bomber mesh (visually distinct)
      const mesh = buildEnemyMesh("tie_ln");
      mesh.scale.setScalar(2.8); // Slightly larger
      mesh.position.set(x, y, z);
      yctx.ctx.scene.add(mesh);
      yctx.targetMeshes.set(eid, mesh);
      yctx.targetEids.push(eid);
    }
  }

  /**
   * Spawn Wave 3 - Final mixed assault
   */
  private spawnWave3FinalAssault(yctx: YavinContext): void {
    const rng = createRng(deriveSeed(yctx.currentSystem.seed, "yavin_wave3"));

    // 4 TIE Fighters + 2 TIE Interceptors (represented as faster TIEs)
    for (let i = 0; i < 6; i++) {
      const isInterceptor = i >= 4;
      const archetype = getFighterArchetype("tie_ln");
      const angle = rng.range(-0.5, 0.5);
      const x = rng.range(-800, 800);
      const z = -2400 + rng.range(-300, 300);
      const y = 180 + rng.range(0, 200);

      const eid = addEntity(yctx.ctx.world);
      addComponent(yctx.ctx.world, Transform, eid);
      addComponent(yctx.ctx.world, Velocity, eid);
      addComponent(yctx.ctx.world, AngularVelocity, eid);
      addComponent(yctx.ctx.world, Team, eid);
      addComponent(yctx.ctx.world, Ship, eid);
      addComponent(yctx.ctx.world, LaserWeapon, eid);
      addComponent(yctx.ctx.world, Targetable, eid);
      addComponent(yctx.ctx.world, Health, eid);
      addComponent(yctx.ctx.world, HitRadius, eid);
      addComponent(yctx.ctx.world, Shield, eid);
      addComponent(yctx.ctx.world, FighterBrain, eid);
      addComponent(yctx.ctx.world, AIControlled, eid);

      Transform.x[eid] = x;
      Transform.y[eid] = y;
      Transform.z[eid] = z;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + angle, 0));
      Transform.qx[eid] = q.x;
      Transform.qy[eid] = q.y;
      Transform.qz[eid] = q.z;
      Transform.qw[eid] = q.w;

      Team.id[eid] = 1;

      // Interceptors are faster and more agile
      const speedMult = isInterceptor ? 1.15 : 1.0;
      const turnMult = isInterceptor ? 1.2 : 1.0;

      Ship.throttle[eid] = rng.range(0.8, 1.0);
      Ship.maxSpeed[eid] = archetype.maxSpeed * speedMult;
      Ship.accel[eid] = archetype.accel * speedMult;
      Ship.turnRate[eid] = archetype.turnRate * turnMult;

      LaserWeapon.cooldown[eid] = archetype.weaponCooldown * (isInterceptor ? 0.9 : 1.1);
      LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
      LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
      LaserWeapon.damage[eid] = 6;

      Health.hp[eid] = isInterceptor ? 40 : 50;
      Health.maxHp[eid] = isInterceptor ? 40 : 50;
      HitRadius.r[eid] = archetype.hitRadius;

      Shield.maxSp[eid] = 8;
      Shield.sp[eid] = 8;
      Shield.regenRate[eid] = 2;
      Shield.lastHit[eid] = 999;

      // More aggressive in final wave
      FighterBrain.state[eid] = 0;
      FighterBrain.stateTime[eid] = 0;
      FighterBrain.aggression[eid] = 0.75;
      FighterBrain.evadeBias[eid] = 0.35;
      FighterBrain.targetEid[eid] = -1;

      // Track enemy type
      this.waveEnemyTypes.set(eid, isInterceptor ? "tie_interceptor" : "tie_fighter");

      const mesh = buildEnemyMesh("tie_ln");
      if (isInterceptor) {
        mesh.scale.setScalar(2.3); // Slightly smaller for interceptor
      }
      mesh.position.set(x, y, z);
      yctx.ctx.scene.add(mesh);
      yctx.targetMeshes.set(eid, mesh);
      yctx.targetEids.push(eid);
    }
  }

  handleHyperspace(_yctx: YavinContext): boolean {
    if (!this.yavin) return true; // Allow default handling

    // Allow restart on success/fail
    if (this.yavin.phase === "success" || this.yavin.phase === "fail") {
      return true; // Let FlightMode handle restart
    }

    // Block during combat
    if (this.yavin.phase === "combat") {
      this.yavin.message = "HYPERSPACE DISABLED - COMPLETE OBJECTIVE";
      this.yavin.messageTimer = 2;
    }

    return false; // Block hyperspace
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

    // Mission message - now shows phase info
    if (this.yavin) {
      if (this.yavin.messageTimer > 0) {
        els.mission.textContent = this.yavin.message;
      } else if (this.yavin.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (this.yavin.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        // Show active objective and base health
        const active = this.objectiveTracker?.getActiveObjective();
        const objText = active ? active.definition.hudTextActive : "DEFEND GREAT TEMPLE";
        const hpColor = baseHpPercent > 60 ? "" : baseHpPercent > 30 ? "[WARNING] " : "[CRITICAL] ";
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
    this.clearAllies(yctx);
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
    return this.allyEids.length;
  }

  getBaseEid(): number | null {
    return this.baseEid;
  }

  getTerrainHeight(x: number, z: number): number {
    return this.terrainHeight(x, z);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildYavinPlanet(yctx: YavinContext): void {
    const seed = yctx.currentSystem.seed;
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

    // Daytime jungle atmosphere - hazy green-blue sky
    yctx.ctx.scene.fog = new THREE.Fog(0x8aac9e, 400, 6000);
    yctx.ctx.scene.background = new THREE.Color(0xa8c4b8);

    // Ground mesh
    const size = 9000;
    const seg = 140;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      pos.setZ(i, this.terrainHeight(x, z) - (this.terrainParams?.yOffset ?? 0));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 1.0 });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = this.terrainParams.yOffset;
    this.groundMesh.receiveShadow = true;
    yctx.ctx.scene.add(this.groundMesh);

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

      const y = this.terrainHeight(x, z);
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
    yctx.ctx.scene.add(this.treeTrunks);
    yctx.ctx.scene.add(this.treeCanopies);

    // Great Temple
    this.baseMesh = this.buildGreatTemple();
    this.baseMesh.position.y = this.terrainHeight(0, 0);
    this.baseMesh.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    yctx.ctx.scene.add(this.baseMesh);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Environmental Props (Rocks, Turrets, Generators)
  // ─────────────────────────────────────────────────────────────────────────────

  private async spawnEnvironmentalProps(yctx: YavinContext): Promise<void> {
    const rng = createRng(deriveSeed(yctx.currentSystem.seed, "yavin_props"));

    // Preload Kenney assets for environmental props
    const propsToLoad = [
      KENNEY_ASSETS.ROCK_LARGE_A,
      KENNEY_ASSETS.ROCK_LARGE_B,
      KENNEY_ASSETS.ROCK,
      KENNEY_ASSETS.ROCK_CRYSTALS,
      KENNEY_ASSETS.METEOR,
      KENNEY_ASSETS.TURRET_DOUBLE,
      KENNEY_ASSETS.TURRET_SINGLE,
      KENNEY_ASSETS.MACHINE_GENERATOR,
      KENNEY_ASSETS.SATELLITE_DISH_LARGE,
      KENNEY_ASSETS.BARRELS
    ];

    try {
      await yctx.assetLoader.preload(propsToLoad);
    } catch {
      // Assets not available, use procedural fallbacks
      this.spawnProceduralRocks(yctx, rng);
      return;
    }

    // OUTER RING - Obstacle field (z = -1200 to -1600)
    // Forces TIEs to break formation
    const outerRocks = [
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: -600, z: -1400, scale: 3.2, rotY: 0.4 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -350, z: -1550, scale: 2.8, rotY: 1.2 },
      { asset: KENNEY_ASSETS.METEOR, x: -700, z: -1200, scale: 2.5, rotY: 2.1 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 550, z: -1350, scale: 3.5, rotY: 4.8 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: 400, z: -1500, scale: 2.6, rotY: 3.3 },
      { asset: KENNEY_ASSETS.METEOR, x: 700, z: -1250, scale: 2.8, rotY: 0.9 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 0, z: -1600, scale: 3.0, rotY: 1.5 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -200, z: -1350, scale: 2.4, rotY: 5.5 }
    ];

    // MID RING - Engagement zone (z = -400 to -800)
    // Provides cover for dogfighting
    const midRocks = [
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: -500, z: -600, scale: 2.2, rotY: 1.8 },
      { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 520, z: -550, scale: 2.4, rotY: 5.2 },
      { asset: KENNEY_ASSETS.ROCK_CRYSTALS, x: -380, z: -700, scale: 1.8, rotY: 0.7 },
      { asset: KENNEY_ASSETS.ROCK, x: 450, z: -750, scale: 2.0, rotY: 2.3 },
      { asset: KENNEY_ASSETS.ROCK_CRYSTALS, x: 380, z: -680, scale: 1.6, rotY: 4.1 }
    ];

    // INNER RING - Temple flanks (z = 100 to 300)
    // Frames the temple
    const innerRocks = [
      { asset: KENNEY_ASSETS.ROCK, x: -200, z: 120, scale: 1.5, rotY: 2.9 },
      { asset: KENNEY_ASSETS.ROCK, x: 190, z: 100, scale: 1.4, rotY: 4.1 },
      { asset: KENNEY_ASSETS.ROCK, x: -240, z: -80, scale: 1.2, rotY: 1.1 },
      { asset: KENNEY_ASSETS.ROCK, x: 230, z: -60, scale: 1.3, rotY: 3.7 }
    ];

    // Spawn all rocks
    for (const rock of [...outerRocks, ...midRocks, ...innerRocks]) {
      try {
        const mesh = yctx.assetLoader.clone(rock.asset);
        const y = this.terrainHeight(rock.x, rock.z) + (rock.scale * 4);
        mesh.position.set(rock.x, y, rock.z);
        mesh.rotation.y = rock.rotY;
        mesh.scale.setScalar(rock.scale);
        // Darken to match jungle stone aesthetic
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.color) mat.color.multiplyScalar(0.75);
          }
        });
        yctx.ctx.scene.add(mesh);
        this.environmentalProps.push(mesh);
      } catch {
        // Individual asset failed, continue
      }
    }

    // DEFENSIVE TURRETS - On temple steps
    const turretPositions = [
      { asset: KENNEY_ASSETS.TURRET_DOUBLE, x: -110, y: 49 + 15, z: 105, scale: 1.3 },
      { asset: KENNEY_ASSETS.TURRET_DOUBLE, x: 110, y: 49 + 15, z: 105, scale: 1.3 },
      { asset: KENNEY_ASSETS.TURRET_SINGLE, x: -70, y: 1.5, z: 340, scale: 1.0 },
      { asset: KENNEY_ASSETS.TURRET_SINGLE, x: 70, y: 1.5, z: 340, scale: 1.0 }
    ];

    for (const turret of turretPositions) {
      try {
        const mesh = yctx.assetLoader.clone(turret.asset);
        const baseY = this.terrainHeight(turret.x, turret.z);
        mesh.position.set(turret.x, baseY + turret.y, turret.z);
        mesh.scale.setScalar(turret.scale);
        mesh.rotation.y = Math.PI; // Face outward
        yctx.ctx.scene.add(mesh);
        this.environmentalProps.push(mesh);
      } catch {
        // Continue if asset fails
      }
    }

    // GENERATOR PROPS - Power infrastructure
    const generatorPositions = [
      { asset: KENNEY_ASSETS.MACHINE_GENERATOR, x: -50, z: 200, scale: 0.8 },
      { asset: KENNEY_ASSETS.MACHINE_GENERATOR, x: 50, z: 200, scale: 0.8 },
      { asset: KENNEY_ASSETS.BARRELS, x: -30, z: 180, scale: 0.6 },
      { asset: KENNEY_ASSETS.BARRELS, x: 35, z: 185, scale: 0.6 }
    ];

    for (const gen of generatorPositions) {
      try {
        const mesh = yctx.assetLoader.clone(gen.asset);
        const y = this.terrainHeight(gen.x, gen.z) + 1.5;
        mesh.position.set(gen.x, y, gen.z);
        mesh.scale.setScalar(gen.scale);
        yctx.ctx.scene.add(mesh);
        this.environmentalProps.push(mesh);
      } catch {
        // Continue if asset fails
      }
    }

    // COMM DISH - On temple roof
    try {
      const dish = yctx.assetLoader.clone(KENNEY_ASSETS.SATELLITE_DISH_LARGE);
      const templeTopY = this.terrainHeight(0, 0) + 34 + 30 + 28 + 12;
      dish.position.set(40, templeTopY + 15, -30);
      dish.scale.setScalar(0.8);
      dish.rotation.x = -0.26; // Tilt toward sky
      yctx.ctx.scene.add(dish);
      this.environmentalProps.push(dish);
    } catch {
      // Continue if asset fails
    }
  }

  /**
   * Fallback procedural rocks when Kenney assets aren't available
   */
  private spawnProceduralRocks(yctx: YavinContext, rng: ReturnType<typeof createRng>): void {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5a4a, roughness: 0.95 });

    const rockPositions = [
      { x: -600, z: -1400, scale: 25 },
      { x: 550, z: -1350, scale: 28 },
      { x: -500, z: -600, scale: 18 },
      { x: 520, z: -550, scale: 20 },
      { x: -200, z: 120, scale: 12 },
      { x: 190, z: 100, scale: 11 }
    ];

    for (const pos of rockPositions) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const y = this.terrainHeight(pos.x, pos.z) + pos.scale * 0.5;
      rock.position.set(pos.x, y, pos.z);
      rock.scale.set(
        pos.scale * rng.range(0.8, 1.2),
        pos.scale * rng.range(0.6, 1.0),
        pos.scale * rng.range(0.8, 1.2)
      );
      rock.rotation.set(rng.range(0, 0.3), rng.range(0, Math.PI * 2), rng.range(0, 0.3));
      rock.castShadow = true;
      rock.receiveShadow = true;
      yctx.ctx.scene.add(rock);
      this.environmentalProps.push(rock);
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
    if (this.groundMesh) {
      yctx.ctx.scene.remove(this.groundMesh);
      disposeObject(this.groundMesh);
      this.groundMesh = null;
    }
    if (this.treeTrunks) {
      yctx.ctx.scene.remove(this.treeTrunks);
      disposeObject(this.treeTrunks);
      this.treeTrunks = null;
    }
    if (this.treeCanopies) {
      yctx.ctx.scene.remove(this.treeCanopies);
      disposeObject(this.treeCanopies);
      this.treeCanopies = null;
    }
    if (this.baseMesh) {
      yctx.ctx.scene.remove(this.baseMesh);
      disposeObject(this.baseMesh);
      this.baseMesh = null;
    }
    if (this.baseEid !== null) {
      removeEntity(yctx.ctx.world, this.baseEid);
      this.baseEid = null;
    }
    this.terrainParams = null;
    yctx.ctx.scene.fog = null;
    yctx.ctx.scene.background = null;
  }

  private terrainHeight(x: number, z: number): number {
    const p = this.terrainParams;
    if (!p) return 0;
    const h1 = Math.sin(x * p.f1 + p.p1) * Math.cos(z * p.f1 + p.p1) * p.a1;
    const h2 = Math.sin(x * p.f2 + p.p2) * Math.sin(z * p.f2 + p.p2) * p.a2;
    return h1 + h2 + p.yOffset;
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Mission Setup
  // ─────────────────────────────────────────────────────────────────────────────

  private startYavinDefense(yctx: YavinContext): void {
    this.yavin = {
      phase: "launch",
      baseHpMax: 2000,
      enemiesTotal: 6,
      enemiesKilled: 0,
      rewardCredits: 1000,
      message: "RED SQUADRON: LAUNCH! DEFEND THE GREAT TEMPLE.",
      messageTimer: 6
    };

    this.clearAllies(yctx);

    // Clear existing targets
    for (const eid of yctx.targetEids) removeEntity(yctx.ctx.world, eid);
    yctx.targetEids = [];
    for (const mesh of yctx.targetMeshes.values()) {
      yctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    yctx.targetMeshes.clear();

    // Base entity
    if (this.baseMesh) {
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

      Transform.x[eid] = this.baseMesh.position.x;
      Transform.y[eid] = this.baseMesh.position.y + 55;
      Transform.z[eid] = this.baseMesh.position.z + 30;
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

    // Wingmen
    this.spawnWingman(yctx, 0, -22, 320);
    this.spawnWingman(yctx, 1, 22, 320);
    this.spawnWingman(yctx, 2, 0, 300);
    this.spawnWingman(yctx, 3, -40, 290);
    this.spawnWingman(yctx, 4, 40, 290);

    // TIE raid - Wave 1
    this.currentWave = 1;
    this.spawnYavinTieRaid(yctx, yctx.currentSystem.seed, this.yavin.enemiesTotal);

    this.yavin.phase = "combat";
    yctx.ctx.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Ally Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnWingman(yctx: YavinContext, slot: number, x: number, z: number): void {
    if (!this.terrainParams) return;

    const archetype = getFighterArchetype("xwing_player");
    const eid = addEntity(yctx.ctx.world);
    addComponent(yctx.ctx.world, Transform, eid);
    addComponent(yctx.ctx.world, Velocity, eid);
    addComponent(yctx.ctx.world, AngularVelocity, eid);
    addComponent(yctx.ctx.world, Team, eid);
    addComponent(yctx.ctx.world, Ship, eid);
    addComponent(yctx.ctx.world, LaserWeapon, eid);
    addComponent(yctx.ctx.world, Health, eid);
    addComponent(yctx.ctx.world, HitRadius, eid);
    addComponent(yctx.ctx.world, Shield, eid);
    addComponent(yctx.ctx.world, FighterBrain, eid);
    addComponent(yctx.ctx.world, AIControlled, eid);

    const y = this.terrainHeight(x, z) + 7;
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

    const mesh = buildAllyMesh(slot);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(2.45);
    yctx.ctx.scene.add(mesh);
    this.allyMeshes.set(eid, mesh);
    this.allyEids.push(eid);
  }

  private spawnYavinTieRaid(yctx: YavinContext, seed: bigint, count: number): void {
    const rng = createRng(deriveSeed(seed, "yavin_defense", "ties_v0"));
    const baseTarget = this.baseEid;

    for (let i = 0; i < count; i++) {
      const archetype = getFighterArchetype("tie_ln");
      const angle = rng.range(-0.4, 0.4);
      const x = rng.range(-600, 600);
      const z = -2400 + rng.range(-400, 300);
      const y = 220 + rng.range(0, 260);

      const eid = addEntity(yctx.ctx.world);
      addComponent(yctx.ctx.world, Transform, eid);
      addComponent(yctx.ctx.world, Velocity, eid);
      addComponent(yctx.ctx.world, AngularVelocity, eid);
      addComponent(yctx.ctx.world, Team, eid);
      addComponent(yctx.ctx.world, Ship, eid);
      addComponent(yctx.ctx.world, LaserWeapon, eid);
      addComponent(yctx.ctx.world, Targetable, eid);
      addComponent(yctx.ctx.world, Health, eid);
      addComponent(yctx.ctx.world, HitRadius, eid);
      addComponent(yctx.ctx.world, Shield, eid);
      addComponent(yctx.ctx.world, FighterBrain, eid);
      addComponent(yctx.ctx.world, AIControlled, eid);

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

      // Track enemy type for wave 1 kill tracking
      this.waveEnemyTypes.set(eid, "tie_fighter");

      const mesh = buildEnemyMesh("tie_ln");
      mesh.position.set(x, y, z);
      yctx.ctx.scene.add(mesh);
      yctx.targetMeshes.set(eid, mesh);
      yctx.targetEids.push(eid);
    }
  }

  private syncAllies(yctx: YavinContext): void {
    for (let i = this.allyEids.length - 1; i >= 0; i--) {
      const eid = this.allyEids[i]!;
      if (
        !hasComponent(yctx.ctx.world, Transform, eid) ||
        !hasComponent(yctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        const mesh = this.allyMeshes.get(eid);
        if (mesh) {
          yctx.explosions?.spawn(this.tmpExplosionPos.copy(mesh.position), 0x66aaff);
          yctx.ctx.scene.remove(mesh);
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

  private clearAllies(yctx: YavinContext): void {
    for (const eid of this.allyEids) {
      if (hasComponent(yctx.ctx.world, Transform, eid)) removeEntity(yctx.ctx.world, eid);
    }
    this.allyEids = [];
    for (const mesh of this.allyMeshes.values()) {
      yctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.allyMeshes.clear();
  }
}
