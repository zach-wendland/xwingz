/**
 * HothDefenseScenario - The Complete Battle of Hoth (Mission 5)
 *
 * "The single worst battlefield defeat suffered by the Rebel Alliance
 * during the Galactic Civil War" - yet their courage bought time for
 * the evacuation that would lead to ultimate victory at Endor.
 *
 * MEGA MISSION with 4 required objectives + 1 optional bonus:
 *
 * Phase 1 - OUTDOOR DEFENSE:
 *   Objective 1: "Hold the Line" - Kill 10 Snowtroopers in trench defense
 *   Objective 2: "Protect Shield Generator" - Keep it alive until AT-ATs breach
 *
 * Phase 2 - INTERIOR EVACUATION:
 *   Objective 3: "Find Princess Leia" - Enter Echo Base, reach command center
 *   Objective 4: "Escort to the Falcon" - Get Leia safely to Millennium Falcon
 *
 * BONUS: "Guardian" - Complete escort without Leia taking any damage
 */

import * as THREE from "three";
import { addEntity, removeEntity, hasComponent, addComponent } from "bitecs";
import { SeededRNG } from "@xwingz/core";
import {
  spawnSoldier,
  Transform,
  Health,
  Team
} from "@xwingz/gameplay";
import {
  ATATWalker,
  ATAT_STATE,
  ShieldGenerator,
  TURRET_TYPE
} from "@xwingz/gameplay";
import {
  spawnATATWalker,
  atatWalkerSystem,
  atatTargetingSystem,
  atatWeaponSystem,
  atatTripSystem,
  consumeATATFireEvents
} from "@xwingz/gameplay";
import {
  spawnTurret,
  turretEmplacementSystem,
  turretAISystem,
  consumeGroundTurretFireEvents
} from "@xwingz/gameplay";
import {
  type ObjectiveDefinition,
  type ObjectiveContext,
  type ObjectiveEvent,
  ObjectivePriority,
  ObjectiveStatus,
  TriggerType,
  ProgressIndicatorType,
  createDefaultObjectiveContext,
  ObjectiveEventType
} from "@xwingz/gameplay";
import { ObjectiveTracker } from "@xwingz/gameplay";
import { KillTracker } from "@xwingz/gameplay";
import { RadioSpeaker } from "../flight/RadioChatterSystem";
import {
  newObjectiveAnnouncement,
  objectiveCompleteAnnouncement,
  objectiveFailedAnnouncement
} from "../flight/AnnouncementSystem";
import { createGroundPlane } from "@xwingz/physics";
import type {
  GroundContext,
  GroundHudElements,
  GroundScenarioHandler
} from "./GroundScenarioTypes";
import { disposeObject } from "../../rendering/MeshManager";
import { ObjectiveHud } from "../flight/ObjectiveHud";
import { AnnouncementSystem } from "../flight/AnnouncementSystem";
import { RadioChatterSystem } from "../flight/RadioChatterSystem";

// ─────────────────────────────────────────────────────────────────────────────
// Mission Phases
// ─────────────────────────────────────────────────────────────────────────────

type HothMegaPhase =
  | "outdoor_defense"    // Trenches + AT-AT assault
  | "interior_evacuation" // Inside Echo Base escorting Leia
  | "success"
  | "fail";

// ─────────────────────────────────────────────────────────────────────────────
// Objective Definitions
// ─────────────────────────────────────────────────────────────────────────────

const HOTH_MEGA_OBJECTIVES: ObjectiveDefinition[] = [
  // ─── OBJECTIVE 1: Hold the Line ───
  {
    id: "hoth_obj_1",
    name: "Hold the Line",
    description: "Defend the trenches against the initial Snowtrooper assault",
    hudText: "Defend trenches",
    hudTextActive: "HOLD THE LINE - Kill Snowtroopers",
    hudTextComplete: "First wave repelled!",
    phase: "outdoor",
    sequence: 1,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "snowtrooper", count: 10 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 10,
    rewardCredits: 200,
    isOptional: false,
    radioOnStart: ["All units, Imperial forces approaching from the north!"],
    radioOnComplete: ["First wave down! But there's more coming!"]
  },

  // ─── OBJECTIVE 2: Protect Shield Generator ───
  {
    id: "hoth_obj_2",
    name: "Protect Shield Generator",
    description: "The shield generator is critical for transport evacuation. Keep it operational.",
    hudText: "Protect shield generator",
    hudTextActive: "PROTECT SHIELD GENERATOR",
    hudTextComplete: "Shield generator destroyed - evacuate!",
    phase: "outdoor",
    sequence: 2,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "hoth_obj_1" },
    triggerComplete: { type: TriggerType.ENTITY_HEALTH_BELOW, entity: "shield_generator", thresholdPercent: 1 },
    triggerFail: null, // This objective completes when shield falls (triggers evacuation)
    progressType: ProgressIndicatorType.PROGRESS_BAR,
    progressMax: 100,
    rewardCredits: 300,
    isOptional: false,
    radioOnStart: ["AT-ATs detected! Protect the shield generator at all costs!"],
    radioOnComplete: ["The shield generator is down! All personnel evacuate immediately!"]
  },

  // ─── OBJECTIVE 3: Find Princess Leia ───
  {
    id: "hoth_obj_3",
    name: "Find Princess Leia",
    description: "Enter Echo Base and locate Princess Leia in the command center",
    hudText: "Enter Echo Base",
    hudTextActive: "FIND PRINCESS LEIA - Command Center",
    hudTextComplete: "Leia located!",
    phase: "interior",
    sequence: 3,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "hoth_obj_2" },
    triggerComplete: { type: TriggerType.REACH_LOCATION, location: "command_center" },
    triggerFail: null,
    progressType: ProgressIndicatorType.NONE,
    progressMax: 1,
    rewardCredits: 200,
    isOptional: false,
    radioOnStart: ["Solo! Get to the command center and find Princess Leia!"],
    radioOnComplete: ["Han! You came for me!"]
  },

  // ─── OBJECTIVE 4: Escort to the Falcon ───
  {
    id: "hoth_obj_4",
    name: "Escort to the Falcon",
    description: "Escort Princess Leia safely through the collapsing base to the Millennium Falcon",
    hudText: "Escort to Falcon",
    hudTextActive: "ESCORT LEIA TO MILLENNIUM FALCON",
    hudTextComplete: "Mission Complete - Falcon reached!",
    phase: "interior",
    sequence: 4,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "hoth_obj_3" },
    triggerComplete: { type: TriggerType.REACH_LOCATION, location: "falcon_ramp" },
    triggerFail: { type: TriggerType.NPC_HEALTH_ZERO, npc: "leia" },
    progressType: ProgressIndicatorType.CHECKPOINT_MARKERS,
    progressMax: 3, // 3 checkpoints: corridor, hangar, ramp
    rewardCredits: 500,
    isOptional: false,
    radioOnStart: ["Let's go, Your Worship. The Falcon's in the main hangar."],
    radioOnComplete: ["Punch it, Chewie!"]
  },

  // ─── BONUS: Guardian ───
  {
    id: "hoth_bonus_1",
    name: "Guardian",
    description: "Complete the escort without Leia taking any damage",
    hudText: "Protect Leia from all harm",
    hudTextActive: "BONUS: Keep Leia unharmed",
    hudTextComplete: "Guardian complete - Leia untouched!",
    phase: "interior",
    sequence: 5,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "hoth_obj_3" },
    triggerComplete: { type: TriggerType.ESCORT_ALIVE, npc: "leia" },
    triggerFail: { type: TriggerType.NPC_DAMAGE_TAKEN, npc: "leia", thresholdPercent: 1 },
    progressType: ProgressIndicatorType.NONE,
    progressMax: 1,
    rewardCredits: 300,
    isOptional: true,
    radioOnStart: ["Keep her safe, Solo!"],
    radioOnComplete: ["Not a scratch. I'm impressed, flyboy."]
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// Named Locations (for REACH_LOCATION triggers)
// ─────────────────────────────────────────────────────────────────────────────

interface NamedLocation {
  name: string;
  position: THREE.Vector3;
  radius: number;
}

const ECHO_BASE_LOCATIONS: NamedLocation[] = [
  { name: "hangar_entrance", position: new THREE.Vector3(0, 0, -65), radius: 8 },
  { name: "command_center", position: new THREE.Vector3(0, 0, -150), radius: 6 },
  { name: "corridor_checkpoint", position: new THREE.Vector3(0, 0, -200), radius: 5 },
  { name: "hangar_floor", position: new THREE.Vector3(0, 0, -280), radius: 10 },
  { name: "falcon_ramp", position: new THREE.Vector3(0, 0, -310), radius: 5 }
];

// ─────────────────────────────────────────────────────────────────────────────
// Hoth Defense Scenario Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class HothDefenseScenario implements GroundScenarioHandler {
  // Mission phase
  private phase: HothMegaPhase = "outdoor_defense";

  // Objective system
  private objectiveTracker: ObjectiveTracker | null = null;
  private killTracker: KillTracker | null = null;
  private objectiveHud: ObjectiveHud | null = null;
  private announcements: AnnouncementSystem | null = null;
  private radioChatter: RadioChatterSystem | null = null;
  private missionTime = 0;
  private objectiveEvents: ObjectiveEvent[] = [];

  // Transports
  private transportsEvacuated = 0;
  private transportsTotal = 17;

  // Outdoor terrain
  private snowTerrain: THREE.Mesh | null = null;
  private skyDome: THREE.Mesh | null = null;

  // Outdoor structures
  private echoBaseMesh: THREE.Object3D | null = null;
  private shieldGenMesh: THREE.Object3D | null = null;
  private shieldGenEid: number | null = null;
  private shieldGenHealth = 2000;
  private shieldGenMaxHealth = 2000;
  private trenchMeshes: THREE.Object3D[] = [];

  // AT-AT tracking
  private atatEids: number[] = [];
  private atatMeshes = new Map<number, THREE.Object3D>();
  private atatSpawned = false;
  private atatTripped = 0;

  // Turret tracking
  private turretEids: number[] = [];
  private turretMeshes = new Map<number, THREE.Object3D>();

  // Snowspeeder for flight transition
  private snowspeederMesh: THREE.Object3D | null = null;
  private nearSpeeder = false;

  // Wave timing
  private waveTimer = 0;
  private waveNumber = 0;
  private readonly WAVE_INTERVAL = 45;

  // Ion cannon cinematic
  private ionCannonTimer = 0;
  private ionCannonFired = false;

  // Interior structures (built when entering interior phase)
  private interiorGroup: THREE.Group | null = null;
  private falconMesh: THREE.Object3D | null = null;

  // Leia NPC
  private leiaEid: number | null = null;
  private leiaMesh: THREE.Object3D | null = null;
  private leiaHealth = 100;
  private leiaMaxHealth = 100;
  private leiaDamageTaken = 0;
  private leiaFollowing = false;

  // Interior enemy tracking
  private interiorEnemyEids: number[] = [];
  private currentCheckpoint = 0;

  // Message
  private message = "";
  private messageTimer = 0;

  // RNG
  private rng: SeededRNG;

  constructor() {
    this.rng = new SeededRNG(Date.now());
  }

  enter(gctx: GroundContext): void {
    // Initialize objective system
    this.objectiveTracker = new ObjectiveTracker(HOTH_MEGA_OBJECTIVES);
    this.killTracker = new KillTracker();
    this.objectiveHud = new ObjectiveHud(gctx.ctx.overlay);
    this.announcements = new AnnouncementSystem(gctx.ctx.overlay);
    this.radioChatter = new RadioChatterSystem(gctx.ctx.overlay);
    this.missionTime = 0;
    this.objectiveEvents = [];

    // Create physics ground plane
    createGroundPlane(gctx.physicsWorld, 0);

    // Build outdoor Hoth terrain
    this.buildHothTerrain(gctx);
    this.buildEchoBase(gctx);
    this.buildTrenches(gctx);

    // Spawn shield generator entity
    this.spawnShieldGenerator(gctx);

    // Spawn defensive turrets
    this.spawnTurrets(gctx);

    // Spawn player in trenches
    this.spawnPlayer(gctx, 0, 1, 30);

    // Spawn initial Snowtrooper wave
    this.spawnWave(gctx, 1);

    // Build snowspeeder for optional flight transition
    this.buildSpeeder(gctx);

    // Set initial message
    this.message = "DEFEND ECHO BASE";
    this.messageTimer = 5;

    // Schedule ion cannon cinematic
    this.ionCannonTimer = 20;

    // Initialize objectives and start tracking
    this.objectiveTracker.initialize();
  }

  tick(gctx: GroundContext, dt: number): boolean {
    this.missionTime += dt;
    this.messageTimer = Math.max(0, this.messageTimer - dt);

    // Build objective context
    const objCtx = this.buildObjectiveContext(gctx);

    // Update objective tracker and collect events
    if (this.objectiveTracker) {
      this.objectiveEvents = this.objectiveTracker.tick(dt, objCtx);
      this.processObjectiveEvents(gctx);
    }

    // Update HUD systems
    this.announcements?.tick(dt);
    this.radioChatter?.tick(dt);
    if (this.objectiveTracker && this.objectiveHud) {
      this.objectiveHud.update(this.objectiveTracker, dt);
    }

    // Phase-specific logic
    if (this.phase === "outdoor_defense") {
      this.tickOutdoor(gctx, dt);
    } else if (this.phase === "interior_evacuation") {
      this.tickInterior(gctx, dt);
    }

    return this.phase === "success" || this.phase === "fail";
  }

  private tickOutdoor(gctx: GroundContext, dt: number): void {
    this.waveTimer += dt;

    // Run Hoth-specific systems
    atatWalkerSystem(gctx.ctx.world, dt);
    atatTargetingSystem(gctx.ctx.world, dt);
    atatWeaponSystem(gctx.ctx.world, dt);
    atatTripSystem(gctx.ctx.world, dt);
    turretEmplacementSystem(gctx.ctx.world, dt);
    turretAISystem(gctx.ctx.world, dt);

    // Process AT-AT fire events
    const atatFires = consumeATATFireEvents();
    for (const fire of atatFires) {
      this.spawnATATLaserEffect(gctx, fire);
    }

    // Process turret fire events
    const turretFires = consumeGroundTurretFireEvents();
    for (const fire of turretFires) {
      this.spawnTurretLaserEffect(gctx, fire);
    }

    // Sync AT-AT meshes
    this.syncATATMeshes(gctx);

    // Sync enemy meshes and track kills
    this.syncEnemyMeshes(gctx);

    // Check shield generator status
    this.checkShieldGenerator(gctx);

    // Ion cannon cinematic
    this.updateIonCannon(gctx, dt);

    // Wave spawning
    if (this.waveTimer >= this.WAVE_INTERVAL) {
      this.waveNumber++;
      this.spawnWave(gctx, this.waveNumber + 1);
      this.waveTimer = 0;

      // Spawn AT-AT after wave 2
      if (this.waveNumber >= 2 && !this.atatSpawned) {
        this.spawnATAT(gctx);
        this.atatSpawned = true;
        this.message = "AT-AT WALKER DETECTED!";
        this.messageTimer = 5;
      }
    }

    // Check player proximity to snowspeeder
    this.checkSpeederProximity(gctx);

    // Check for transition to interior phase
    this.checkInteriorTransition(gctx);
  }

  private tickInterior(gctx: GroundContext, dt: number): void {
    // Update Leia following
    if (this.leiaFollowing && this.leiaEid && gctx.playerEid) {
      this.updateLeiaFollow(gctx, dt);
    }

    // Sync enemy meshes
    this.syncEnemyMeshes(gctx);

    // Check location triggers
    this.updateLocationDistances(gctx);

    // Update checkpoint progress
    this.updateCheckpoints(gctx);
  }

  updateHud(_gctx: GroundContext, els: GroundHudElements): void {
    // Mission message
    if (this.messageTimer > 0) {
      els.mission.textContent = this.message;
    } else {
      els.mission.textContent = this.getPhaseMessage();
    }

    // Objective text
    const active = this.objectiveTracker?.getActiveObjective();
    if (active) {
      els.objective.textContent = active.definition.hudTextActive;
    } else {
      els.objective.textContent = `TRANSPORTS: ${this.transportsEvacuated}/${this.transportsTotal}`;
    }

    // Shield generator health (outdoor phase)
    if (els.baseIntegrity && this.phase === "outdoor_defense") {
      const pct = Math.round((this.shieldGenHealth / this.shieldGenMaxHealth) * 100);
      els.baseIntegrity.textContent = `SHIELD GEN: ${pct}%`;
    }

    // AT-AT count
    if (els.atatCount && this.atatSpawned) {
      els.atatCount.textContent = `AT-ATs: ${this.atatEids.length} (${this.atatTripped} TRIPPED)`;
    }
  }

  getMissionMessage(): string {
    if (this.messageTimer > 0) return this.message;
    return this.getPhaseMessage();
  }

  getMissionNumber(): number {
    return 5;
  }

  canTransition(): "speeder" | "launch" | null {
    if (this.phase === "outdoor_defense" && this.nearSpeeder && this.atatSpawned) {
      return "speeder";
    }
    return null;
  }

  handleSpeederTransition(gctx: GroundContext): void {
    gctx.ctx.requestModeChange("flight", {
      type: "flight",
      system: null as any,
      scenario: "hoth_speeder"
    });
  }

  exit(gctx: GroundContext): void {
    // Clean up outdoor terrain
    if (this.snowTerrain) {
      gctx.ctx.scene.remove(this.snowTerrain);
      disposeObject(this.snowTerrain);
      this.snowTerrain = null;
    }
    if (this.skyDome) {
      gctx.ctx.scene.remove(this.skyDome);
      disposeObject(this.skyDome);
      this.skyDome = null;
    }

    // Clean up structures
    if (this.echoBaseMesh) {
      gctx.ctx.scene.remove(this.echoBaseMesh);
      disposeObject(this.echoBaseMesh);
      this.echoBaseMesh = null;
    }
    if (this.shieldGenMesh) {
      gctx.ctx.scene.remove(this.shieldGenMesh);
      disposeObject(this.shieldGenMesh);
      this.shieldGenMesh = null;
    }
    for (const mesh of this.trenchMeshes) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.trenchMeshes = [];

    // Clean up AT-ATs
    for (const eid of this.atatEids) {
      removeEntity(gctx.ctx.world, eid);
    }
    this.atatEids = [];
    for (const mesh of this.atatMeshes.values()) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.atatMeshes.clear();

    // Clean up turrets
    for (const eid of this.turretEids) {
      removeEntity(gctx.ctx.world, eid);
    }
    this.turretEids = [];
    for (const mesh of this.turretMeshes.values()) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretMeshes.clear();

    // Clean up speeder
    if (this.snowspeederMesh) {
      gctx.ctx.scene.remove(this.snowspeederMesh);
      disposeObject(this.snowspeederMesh);
      this.snowspeederMesh = null;
    }

    // Clean up interior
    if (this.interiorGroup) {
      gctx.ctx.scene.remove(this.interiorGroup);
      disposeObject(this.interiorGroup);
      this.interiorGroup = null;
    }
    if (this.falconMesh) {
      gctx.ctx.scene.remove(this.falconMesh);
      disposeObject(this.falconMesh);
      this.falconMesh = null;
    }
    if (this.leiaMesh) {
      gctx.ctx.scene.remove(this.leiaMesh);
      disposeObject(this.leiaMesh);
      this.leiaMesh = null;
    }

    // Clean up interior enemies
    for (const eid of this.interiorEnemyEids) {
      removeEntity(gctx.ctx.world, eid);
    }
    this.interiorEnemyEids = [];

    // Clean up HUD systems
    this.objectiveHud?.dispose();
    this.announcements?.dispose();
    this.radioChatter?.dispose();
    this.objectiveHud = null;
    this.announcements = null;
    this.radioChatter = null;
    this.objectiveTracker = null;
    this.killTracker = null;

    // Reset fog
    gctx.ctx.scene.fog = null;
    gctx.ctx.scene.background = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Objective System
  // ─────────────────────────────────────────────────────────────────────────────

  private buildObjectiveContext(gctx: GroundContext): ObjectiveContext {
    const ctx = createDefaultObjectiveContext();
    ctx.missionTime = this.missionTime;

    // Kill tracking
    if (this.killTracker) {
      const trackingData = this.killTracker.getTrackingData();
      ctx.kills.byType = trackingData.byType;
      ctx.kills.byWave = trackingData.byWave;
      ctx.kills.total = trackingData.total;
      ctx.kills.streak = trackingData.streak;
      ctx.kills.streakValid = trackingData.streakValid;
    }

    // Shield generator health
    ctx.entities.baseHealth = this.shieldGenHealth;
    ctx.entities.baseHealthPercent = (this.shieldGenHealth / this.shieldGenMaxHealth) * 100;
    ctx.entities.atatDown = this.atatTripped;

    // Escort tracking (Leia)
    ctx.escort.escortAlive = this.leiaHealth > 0;
    ctx.escort.escortHealth = this.leiaHealth;
    ctx.escort.escortMaxHealth = this.leiaMaxHealth;
    ctx.escort.escortDamageTaken = this.leiaDamageTaken;

    if (gctx.playerEid && this.leiaMesh) {
      const px = Transform.x[gctx.playerEid] ?? 0;
      const py = Transform.y[gctx.playerEid] ?? 0;
      const pz = Transform.z[gctx.playerEid] ?? 0;
      const lx = this.leiaMesh.position.x;
      const ly = this.leiaMesh.position.y;
      const lz = this.leiaMesh.position.z;
      ctx.escort.distanceToEscort = Math.sqrt(
        (px - lx) ** 2 + (py - ly) ** 2 + (pz - lz) ** 2
      );
    }

    // Location distances
    if (gctx.playerEid) {
      const px = Transform.x[gctx.playerEid] ?? 0;
      const py = Transform.y[gctx.playerEid] ?? 0;
      const pz = Transform.z[gctx.playerEid] ?? 0;
      ctx.location.playerPosition = { x: px, y: py, z: pz };
      ctx.location.checkpoint = this.currentCheckpoint;

      for (const loc of ECHO_BASE_LOCATIONS) {
        const dist = Math.sqrt(
          (px - loc.position.x) ** 2 +
          (py - loc.position.y) ** 2 +
          (pz - loc.position.z) ** 2
        );
        ctx.location.locationDistances.set(loc.name, dist);
      }
    }

    // Completed objectives
    if (this.objectiveTracker) {
      for (const obj of this.objectiveTracker.getObjectivesByStatus(ObjectiveStatus.COMPLETED)) {
        ctx.completedObjectives.add(obj.definition.id);
      }
      for (const obj of this.objectiveTracker.getObjectivesByStatus(ObjectiveStatus.OPTIONAL_COMPLETED)) {
        ctx.completedObjectives.add(obj.definition.id);
      }
    }

    return ctx;
  }

  private processObjectiveEvents(gctx: GroundContext): void {
    for (const event of this.objectiveEvents) {
      switch (event.type) {
        case ObjectiveEventType.OBJECTIVE_ACTIVATED:
          if (event.objective?.definition.radioOnStart) {
            for (const msg of event.objective.definition.radioOnStart) {
              this.radioChatter?.say(msg, RadioSpeaker.COMMAND);
            }
          }
          this.announcements?.announce(
            newObjectiveAnnouncement(
              event.objective?.definition.name ?? "NEW OBJECTIVE",
              event.objective?.definition.hudTextActive
            )
          );
          break;

        case ObjectiveEventType.OBJECTIVE_COMPLETED:
          if (event.objective?.definition.radioOnComplete) {
            for (const msg of event.objective.definition.radioOnComplete) {
              this.radioChatter?.say(msg, RadioSpeaker.COMMAND);
            }
          }
          this.announcements?.announce(
            objectiveCompleteAnnouncement(event.objective?.definition.name ?? "COMPLETE")
          );

          // Check for phase transitions
          if (event.objectiveId === "hoth_obj_2") {
            this.transitionToInterior(gctx);
          } else if (event.objectiveId === "hoth_obj_3") {
            this.leiaFollowing = true;
            this.spawnInteriorEnemies(gctx);
          } else if (event.objectiveId === "hoth_obj_4") {
            this.phase = "success";
            this.message = "VICTORY! THE FALCON ESCAPES!";
            this.messageTimer = 10;
          }
          break;

        case ObjectiveEventType.OBJECTIVE_FAILED:
          if (event.objective?.definition.isOptional) {
            this.announcements?.announce(objectiveFailedAnnouncement("BONUS FAILED"));
          } else {
            this.phase = "fail";
            this.message = "MISSION FAILED";
            this.messageTimer = 10;
            this.announcements?.announce(objectiveFailedAnnouncement("MISSION FAILED"));
          }
          break;

        case ObjectiveEventType.MISSION_COMPLETE:
          this.phase = "success";
          break;

        case ObjectiveEventType.MISSION_FAILED:
          this.phase = "fail";
          break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase Transitions
  // ─────────────────────────────────────────────────────────────────────────────

  private checkInteriorTransition(gctx: GroundContext): void {
    // Shield generator destroyed - player should head to hangar entrance
    if (this.shieldGenHealth <= 0 && gctx.playerEid) {
      const px = Transform.x[gctx.playerEid] ?? 0;
      const pz = Transform.z[gctx.playerEid] ?? 0;

      const entrance = ECHO_BASE_LOCATIONS.find(l => l.name === "hangar_entrance");
      if (entrance) {
        const dist = Math.sqrt(
          (px - entrance.position.x) ** 2 +
          (pz - entrance.position.z) ** 2
        );
        if (dist < entrance.radius) {
          this.transitionToInterior(gctx);
        }
      }
    }
  }

  private transitionToInterior(gctx: GroundContext): void {
    this.phase = "interior_evacuation";

    // Clear outdoor elements (keep terrain for continuity)
    for (const mesh of this.atatMeshes.values()) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.atatMeshes.clear();

    // Build interior
    this.buildInterior(gctx);

    // Spawn Leia at command center
    this.spawnLeia(gctx);

    // Move player inside
    if (gctx.playerEid) {
      Transform.x[gctx.playerEid] = 0;
      Transform.y[gctx.playerEid] = 1;
      Transform.z[gctx.playerEid] = -100;
    }

    // Change atmosphere
    gctx.ctx.scene.fog = new THREE.Fog(0x333344, 20, 200);
    gctx.ctx.scene.background = new THREE.Color(0x222233);

    this.message = "GET TO THE COMMAND CENTER!";
    this.messageTimer = 4;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildHothTerrain(gctx: GroundContext): void {
    gctx.ctx.scene.fog = new THREE.Fog(0xc8d8e8, 100, 800);
    gctx.ctx.scene.background = new THREE.Color(0xddeeff);

    const size = 2000;
    const segments = 100;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      const height = Math.sin(x * 0.01) * Math.cos(z * 0.01) * 2 +
                     Math.sin(x * 0.03 + 1.5) * 1;
      pos.setZ(i, height);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4ff,
      roughness: 0.95,
      metalness: 0
    });

    this.snowTerrain = new THREE.Mesh(geo, snowMat);
    this.snowTerrain.rotation.x = -Math.PI / 2;
    this.snowTerrain.receiveShadow = true;
    gctx.ctx.scene.add(this.snowTerrain);

    this.addIceRocks(gctx);
  }

  private addIceRocks(gctx: GroundContext): void {
    const rockGeo = new THREE.DodecahedronGeometry(4, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xaaccff,
      roughness: 0.6
    });

    const rockPositions = [
      { x: 50, z: -20, scale: 1.5 },
      { x: -60, z: -40, scale: 2.0 },
      { x: 80, z: 50, scale: 1.2 },
      { x: -70, z: 80, scale: 1.8 },
      { x: 100, z: -60, scale: 2.2 },
    ];

    for (const p of rockPositions) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(p.x, p.scale * 2, p.z);
      rock.scale.setScalar(p.scale);
      rock.rotation.set(
        this.rng.range(0, Math.PI),
        this.rng.range(0, Math.PI),
        this.rng.range(0, Math.PI)
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      gctx.ctx.scene.add(rock);
    }
  }

  private buildEchoBase(gctx: GroundContext): void {
    const group = new THREE.Group();

    const entranceGeo = new THREE.BoxGeometry(80, 40, 30);
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0x889999,
      roughness: 0.4
    });
    const entrance = new THREE.Mesh(entranceGeo, iceMat);
    entrance.position.set(0, 20, -80);
    entrance.castShadow = true;
    entrance.receiveShadow = true;
    group.add(entrance);

    const doorGeo = new THREE.BoxGeometry(60, 30, 2);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x111115,
      roughness: 0.8
    });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 15, -65);
    group.add(door);

    const mountainGeo = new THREE.ConeGeometry(150, 200, 6);
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0xddeeff,
      roughness: 0.9
    });
    const mountain = new THREE.Mesh(mountainGeo, mountainMat);
    mountain.position.set(0, 60, -150);
    mountain.receiveShadow = true;
    group.add(mountain);

    this.echoBaseMesh = group;
    gctx.ctx.scene.add(group);
  }

  private buildTrenches(gctx: GroundContext): void {
    const trenchMat = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      roughness: 0.7
    });

    const wallGeo = new THREE.BoxGeometry(2, 1.5, 30);
    const trenchPositions = [
      { x: -30, z: 20 },
      { x: -10, z: 20 },
      { x: 10, z: 20 },
      { x: 30, z: 20 },
    ];

    for (const p of trenchPositions) {
      const wall = new THREE.Mesh(wallGeo, trenchMat);
      wall.position.set(p.x, 0.75, p.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      gctx.ctx.scene.add(wall);
      this.trenchMeshes.push(wall);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Interior Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildInterior(gctx: GroundContext): void {
    this.interiorGroup = new THREE.Group();

    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xaaccff,
      roughness: 0.5
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x556677,
      roughness: 0.3,
      metalness: 0.6
    });

    // Main corridor from entrance to command center
    const corridorLength = 100;
    const corridorWidth = 8;
    const corridorHeight = 5;

    // Floor
    const floorGeo = new THREE.PlaneGeometry(corridorWidth, corridorLength);
    const floor = new THREE.Mesh(floorGeo, metalMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -115);
    this.interiorGroup.add(floor);

    // Walls
    const wallGeo = new THREE.BoxGeometry(0.5, corridorHeight, corridorLength);
    const leftWall = new THREE.Mesh(wallGeo, iceMat);
    leftWall.position.set(-corridorWidth / 2, corridorHeight / 2, -115);
    this.interiorGroup.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeo, iceMat);
    rightWall.position.set(corridorWidth / 2, corridorHeight / 2, -115);
    this.interiorGroup.add(rightWall);

    // Ceiling with gaps (damage)
    const ceilGeo = new THREE.BoxGeometry(corridorWidth, 0.3, 20);
    for (let z = -80; z > -160; z -= 25) {
      const ceil = new THREE.Mesh(ceilGeo, metalMat);
      ceil.position.set(0, corridorHeight, z);
      this.interiorGroup.add(ceil);
    }

    // Command center room
    const ccRoomGeo = new THREE.BoxGeometry(20, 6, 20);
    const ccRoom = new THREE.Mesh(
      ccRoomGeo,
      new THREE.MeshStandardMaterial({
        color: 0x445566,
        side: THREE.BackSide
      })
    );
    ccRoom.position.set(0, 3, -150);
    this.interiorGroup.add(ccRoom);

    // Console in command center
    const consoleGeo = new THREE.BoxGeometry(6, 1.5, 2);
    const consoleMesh = new THREE.Mesh(consoleGeo, metalMat);
    consoleMesh.position.set(0, 0.75, -155);
    this.interiorGroup.add(consoleMesh);

    // Second corridor to hangar
    const hangarCorridorFloor = new THREE.Mesh(floorGeo, metalMat);
    hangarCorridorFloor.rotation.x = -Math.PI / 2;
    hangarCorridorFloor.position.set(0, 0, -230);
    this.interiorGroup.add(hangarCorridorFloor);

    // Hangar room
    const hangarFloorGeo = new THREE.PlaneGeometry(50, 60);
    const hangarFloor = new THREE.Mesh(hangarFloorGeo, metalMat);
    hangarFloor.rotation.x = -Math.PI / 2;
    hangarFloor.position.set(0, 0, -300);
    this.interiorGroup.add(hangarFloor);

    gctx.ctx.scene.add(this.interiorGroup);

    // Build Millennium Falcon
    this.buildFalcon(gctx);

    // Add interior lights
    const light1 = new THREE.PointLight(0xffffff, 1, 50);
    light1.position.set(0, 4, -120);
    this.interiorGroup.add(light1);

    const light2 = new THREE.PointLight(0xffffff, 1, 50);
    light2.position.set(0, 4, -200);
    this.interiorGroup.add(light2);

    const light3 = new THREE.PointLight(0xffffff, 2, 80);
    light3.position.set(0, 8, -300);
    this.interiorGroup.add(light3);
  }

  private buildFalcon(gctx: GroundContext): void {
    const group = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      roughness: 0.4,
      metalness: 0.3
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.6
    });

    // Main saucer body
    const saucerGeo = new THREE.CylinderGeometry(15, 15, 3, 32);
    const saucer = new THREE.Mesh(saucerGeo, hullMat);
    saucer.position.y = 3;
    group.add(saucer);

    // Forward mandibles
    const mandibleGeo = new THREE.BoxGeometry(3, 2, 12);
    const leftMandible = new THREE.Mesh(mandibleGeo, hullMat);
    leftMandible.position.set(-5, 3, -18);
    group.add(leftMandible);

    const rightMandible = new THREE.Mesh(mandibleGeo, hullMat);
    rightMandible.position.set(5, 3, -18);
    group.add(rightMandible);

    // Cockpit
    const cockpitGeo = new THREE.CylinderGeometry(2, 2, 2.5, 12);
    const cockpit = new THREE.Mesh(cockpitGeo, darkMat);
    cockpit.position.set(10, 4, -10);
    group.add(cockpit);

    // Landing ramp
    const rampGeo = new THREE.BoxGeometry(4, 0.2, 8);
    const ramp = new THREE.Mesh(rampGeo, hullMat);
    ramp.position.set(0, 0.5, -8);
    ramp.rotation.x = Math.PI * 0.1;
    group.add(ramp);

    // Sensor dish
    const dishGeo = new THREE.SphereGeometry(2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const dish = new THREE.Mesh(dishGeo, hullMat);
    dish.rotation.x = Math.PI;
    dish.position.set(0, 6, 8);
    group.add(dish);

    group.position.set(0, 0, -310);
    group.traverse(c => {
      c.castShadow = true;
      c.receiveShadow = true;
    });

    this.falconMesh = group;
    gctx.ctx.scene.add(group);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Entity Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnPlayer(gctx: GroundContext, x: number, y: number, z: number): void {
    gctx.playerEid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, x, y, z, 0, 0, false);
  }

  private spawnShieldGenerator(gctx: GroundContext): void {
    const eid = addEntity(gctx.ctx.world);
    addComponent(gctx.ctx.world, Transform, eid);
    addComponent(gctx.ctx.world, ShieldGenerator, eid);
    addComponent(gctx.ctx.world, Team, eid);

    Transform.x[eid] = -50;
    Transform.y[eid] = 0;
    Transform.z[eid] = -60;

    ShieldGenerator.health[eid] = this.shieldGenMaxHealth;
    ShieldGenerator.maxHealth[eid] = this.shieldGenMaxHealth;
    ShieldGenerator.shieldRadius[eid] = 500;
    ShieldGenerator.active[eid] = 1;

    Team.id[eid] = 0;

    this.shieldGenEid = eid;

    // Build mesh
    const group = new THREE.Group();

    const dishGeo = new THREE.SphereGeometry(8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0x556677,
      roughness: 0.3,
      metalness: 0.7
    });
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.rotation.x = Math.PI;
    dish.position.y = 15;
    group.add(dish);

    const towerGeo = new THREE.CylinderGeometry(2, 3, 15, 8);
    const tower = new THREE.Mesh(towerGeo, dishMat);
    tower.position.y = 7.5;
    group.add(tower);

    const baseGeo = new THREE.CylinderGeometry(6, 6, 2, 12);
    const base = new THREE.Mesh(baseGeo, dishMat);
    base.position.y = 1;
    group.add(base);

    group.position.set(-50, 0, -60);
    group.traverse(c => {
      c.castShadow = true;
      c.receiveShadow = true;
    });

    this.shieldGenMesh = group;
    gctx.ctx.scene.add(group);
  }

  private spawnTurrets(gctx: GroundContext): void {
    const turretPositions = [
      { x: -40, z: 10, type: TURRET_TYPE.DF_9 },
      { x: 40, z: 10, type: TURRET_TYPE.DF_9 },
      { x: -20, z: 25, type: TURRET_TYPE.E_WEB },
      { x: 20, z: 25, type: TURRET_TYPE.E_WEB },
    ];

    for (const pos of turretPositions) {
      const eid = spawnTurret(gctx.ctx.world, pos.x, 0, pos.z, pos.type, 0);
      this.turretEids.push(eid);

      const mesh = this.buildTurretMesh(pos.type);
      mesh.position.set(pos.x, 0, pos.z);
      gctx.ctx.scene.add(mesh);
      this.turretMeshes.set(eid, mesh);
    }
  }

  private buildTurretMesh(type: number): THREE.Object3D {
    const group = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x444455,
      roughness: 0.4,
      metalness: 0.6
    });

    if (type === TURRET_TYPE.DF_9) {
      const baseGeo = new THREE.CylinderGeometry(1.5, 2, 1, 8);
      const base = new THREE.Mesh(baseGeo, metalMat);
      base.position.y = 0.5;
      group.add(base);

      const turretGeo = new THREE.BoxGeometry(1.5, 1, 2.5);
      const turret = new THREE.Mesh(turretGeo, metalMat);
      turret.position.y = 1.5;
      group.add(turret);

      const barrelGeo = new THREE.CylinderGeometry(0.15, 0.15, 2, 8);
      const barrel = new THREE.Mesh(barrelGeo, metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 1.5, -2);
      group.add(barrel);
    } else {
      const tripodGeo = new THREE.ConeGeometry(0.8, 1, 3);
      const tripod = new THREE.Mesh(tripodGeo, metalMat);
      tripod.rotation.x = Math.PI;
      tripod.position.y = 0.5;
      group.add(tripod);

      const gunGeo = new THREE.BoxGeometry(0.4, 0.3, 1.2);
      const gun = new THREE.Mesh(gunGeo, metalMat);
      gun.position.set(0, 1, -0.3);
      group.add(gun);

      const barrelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6);
      const barrel1 = new THREE.Mesh(barrelGeo, metalMat);
      barrel1.rotation.x = Math.PI / 2;
      barrel1.position.set(-0.1, 1, -1);
      group.add(barrel1);

      const barrel2 = new THREE.Mesh(barrelGeo, metalMat);
      barrel2.rotation.x = Math.PI / 2;
      barrel2.position.set(0.1, 1, -1);
      group.add(barrel2);
    }

    group.traverse(c => { c.castShadow = true; });
    return group;
  }

  private spawnWave(gctx: GroundContext, waveNum: number): void {
    const count = 3 + waveNum * 2;
    const spawnZ = 150 + waveNum * 30;

    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-60, 60);
      const z = spawnZ + this.rng.range(-20, 20);
      const eid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, x, 1, z, 1, 0, true);
      gctx.enemyEids.push(eid);
    }

    this.message = `WAVE ${waveNum} INCOMING!`;
    this.messageTimer = 3;
  }

  private spawnATAT(gctx: GroundContext): void {
    const eid = spawnATATWalker(
      gctx.ctx.world,
      0, 300, -50, -60, Date.now()
    );
    this.atatEids.push(eid);

    const mesh = this.buildATATMesh();
    mesh.position.set(0, 22, 300);
    gctx.ctx.scene.add(mesh);
    this.atatMeshes.set(eid, mesh);
  }

  private buildATATMesh(): THREE.Object3D {
    const group = new THREE.Group();
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x888899,
      roughness: 0.4,
      metalness: 0.3
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x333344,
      roughness: 0.6
    });

    const bodyGeo = new THREE.BoxGeometry(8, 6, 15);
    const body = new THREE.Mesh(bodyGeo, armorMat);
    body.position.y = 0;
    group.add(body);

    const headGeo = new THREE.BoxGeometry(4, 3, 5);
    const head = new THREE.Mesh(headGeo, armorMat);
    head.position.set(0, 1, -10);
    group.add(head);

    const viewportGeo = new THREE.BoxGeometry(2.5, 0.5, 0.2);
    const viewport = new THREE.Mesh(viewportGeo, darkMat);
    viewport.position.set(0, 1.5, -12.6);
    group.add(viewport);

    const laserGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
    const laserL = new THREE.Mesh(laserGeo, darkMat);
    laserL.rotation.x = Math.PI / 2;
    laserL.position.set(-1, 0, -13);
    group.add(laserL);

    const laserR = new THREE.Mesh(laserGeo, darkMat);
    laserR.rotation.x = Math.PI / 2;
    laserR.position.set(1, 0, -13);
    group.add(laserR);

    const neckGeo = new THREE.CylinderGeometry(1.5, 1.5, 3, 8);
    const neck = new THREE.Mesh(neckGeo, armorMat);
    neck.position.set(0, 0, -7);
    neck.rotation.x = Math.PI / 4;
    group.add(neck);

    const legGeo = new THREE.BoxGeometry(1, 18, 1);
    const legPositions = [
      { x: -3, z: -4 },
      { x: 3, z: -4 },
      { x: -3, z: 4 },
      { x: 3, z: 4 },
    ];

    for (const p of legPositions) {
      const leg = new THREE.Mesh(legGeo, armorMat);
      leg.position.set(p.x, -12, p.z);
      group.add(leg);

      const footGeo = new THREE.BoxGeometry(2, 1, 3);
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.position.set(p.x, -21.5, p.z);
      group.add(foot);
    }

    group.traverse(c => {
      c.castShadow = true;
      c.receiveShadow = true;
    });

    return group;
  }

  private buildSpeeder(gctx: GroundContext): void {
    const group = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.3
    });
    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xff6644,
      roughness: 0.4
    });

    const hullGeo = new THREE.BoxGeometry(2, 0.8, 5);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    group.add(hull);

    const cockpitGeo = new THREE.BoxGeometry(1.2, 0.6, 2);
    const cockpit = new THREE.Mesh(cockpitGeo, orangeMat);
    cockpit.position.set(0, 0.5, -1);
    group.add(cockpit);

    const engineGeo = new THREE.CylinderGeometry(0.5, 0.4, 2, 8);
    const engineL = new THREE.Mesh(engineGeo, hullMat);
    engineL.rotation.x = Math.PI / 2;
    engineL.position.set(-1.2, 0, 2);
    group.add(engineL);

    const engineR = new THREE.Mesh(engineGeo, hullMat);
    engineR.rotation.x = Math.PI / 2;
    engineR.position.set(1.2, 0, 2);
    group.add(engineR);

    group.position.set(25, 1, 20);
    group.traverse(c => { c.castShadow = true; });

    this.snowspeederMesh = group;
    gctx.ctx.scene.add(group);
  }

  private spawnLeia(gctx: GroundContext): void {
    // Leia entity
    const eid = addEntity(gctx.ctx.world);
    addComponent(gctx.ctx.world, Transform, eid);
    addComponent(gctx.ctx.world, Health, eid);
    addComponent(gctx.ctx.world, Team, eid);

    Transform.x[eid] = 0;
    Transform.y[eid] = 1;
    Transform.z[eid] = -150;

    Health.hp[eid] = this.leiaMaxHealth;
    Health.maxHp[eid] = this.leiaMaxHealth;
    Team.id[eid] = 0;

    this.leiaEid = eid;

    // Build Leia mesh
    const group = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.4, 8);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(bodyGeo, whiteMat);
    body.position.y = 0.7;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.25, 12, 8);
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.6;
    group.add(head);

    // Hair buns
    const bunGeo = new THREE.SphereGeometry(0.15, 8, 6);
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x331100 });
    const bunL = new THREE.Mesh(bunGeo, hairMat);
    bunL.position.set(-0.25, 1.65, 0);
    group.add(bunL);

    const bunR = new THREE.Mesh(bunGeo, hairMat);
    bunR.position.set(0.25, 1.65, 0);
    group.add(bunR);

    group.position.set(0, 0, -150);
    this.leiaMesh = group;
    gctx.ctx.scene.add(group);
  }

  private spawnInteriorEnemies(gctx: GroundContext): void {
    // Snowtroopers in corridors
    const positions = [
      { x: 2, z: -180 },
      { x: -2, z: -190 },
      { x: 0, z: -220 },
      { x: 3, z: -240 },
      { x: -3, z: -250 },
      { x: 2, z: -270 },
      { x: -2, z: -285 },
      { x: 5, z: -290 },
    ];

    for (const p of positions) {
      const eid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, p.x, 1, p.z, 1, 0, true);
      this.interiorEnemyEids.push(eid);
      gctx.enemyEids.push(eid);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Update Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private syncATATMeshes(gctx: GroundContext): void {
    for (const eid of this.atatEids) {
      const mesh = this.atatMeshes.get(eid);
      if (!mesh) continue;

      if (!hasComponent(gctx.ctx.world, ATATWalker, eid)) {
        gctx.ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.atatMeshes.delete(eid);
        continue;
      }

      mesh.position.set(
        Transform.x[eid] ?? 0,
        Transform.y[eid] ?? 22,
        Transform.z[eid] ?? 0
      );

      mesh.quaternion.set(
        Transform.qx[eid] ?? 0,
        Transform.qy[eid] ?? 0,
        Transform.qz[eid] ?? 0,
        Transform.qw[eid] ?? 1
      );

      const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;
      if (state === ATAT_STATE.DOWN && this.atatTripped === 0) {
        this.atatTripped++;
        this.message = "AT-AT DOWN! FINISH IT OFF!";
        this.messageTimer = 3;
      }
    }
  }

  private syncEnemyMeshes(gctx: GroundContext): void {
    for (let i = gctx.enemyEids.length - 1; i >= 0; i--) {
      const eid = gctx.enemyEids[i]!;
      if (
        !hasComponent(gctx.ctx.world, Transform, eid) ||
        !hasComponent(gctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        const mesh = gctx.enemyMeshes.get(eid);
        if (mesh) {
          gctx.explosions?.spawn(
            new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
            0xff6666
          );
          gctx.ctx.scene.remove(mesh);
          gctx.enemyMeshes.delete(eid);
        }
        removeEntity(gctx.ctx.world, eid);
        gctx.enemyEids.splice(i, 1);

        // Track kill
        this.killTracker?.recordKill("snowtrooper");
      }
    }
  }

  private checkShieldGenerator(gctx: GroundContext): void {
    if (!this.shieldGenEid) return;
    if (!hasComponent(gctx.ctx.world, ShieldGenerator, this.shieldGenEid)) return;

    this.shieldGenHealth = ShieldGenerator.health[this.shieldGenEid] ?? 0;

    // AT-ATs damage shield generator over time
    if (this.atatSpawned && this.shieldGenHealth > 0) {
      const damageRate = 50; // per second when AT-AT is active
      for (const eid of this.atatEids) {
        if (hasComponent(gctx.ctx.world, ATATWalker, eid)) {
          const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;
          if (state === ATAT_STATE.FIRING || state === ATAT_STATE.ADVANCING) {
            this.shieldGenHealth -= damageRate * 0.016; // Assuming 60fps
            ShieldGenerator.health[this.shieldGenEid] = Math.max(0, this.shieldGenHealth);
          }
        }
      }
    }
  }

  private updateIonCannon(gctx: GroundContext, dt: number): void {
    if (this.ionCannonFired) return;

    this.ionCannonTimer -= dt;
    if (this.ionCannonTimer <= 0) {
      this.ionCannonFired = true;
      this.message = "ION CANNON FIRING! FIRST TRANSPORT IS AWAY!";
      this.messageTimer = 4;
      this.transportsEvacuated++;

      const flash = new THREE.PointLight(0x4488ff, 50, 500);
      flash.position.set(-50, 50, -60);
      gctx.ctx.scene.add(flash);

      setTimeout(() => {
        gctx.ctx.scene.remove(flash);
        flash.dispose();
      }, 500);
    }
  }

  private checkSpeederProximity(gctx: GroundContext): void {
    if (!gctx.playerEid || !this.snowspeederMesh) {
      this.nearSpeeder = false;
      return;
    }

    const px = Transform.x[gctx.playerEid] ?? 0;
    const pz = Transform.z[gctx.playerEid] ?? 0;
    const sx = this.snowspeederMesh.position.x;
    const sz = this.snowspeederMesh.position.z;

    const dist = Math.sqrt((px - sx) ** 2 + (pz - sz) ** 2);
    this.nearSpeeder = dist < 5;
  }

  private updateLeiaFollow(gctx: GroundContext, _dt: number): void {
    if (!gctx.playerEid || !this.leiaMesh || !this.leiaEid) return;

    const px = Transform.x[gctx.playerEid] ?? 0;
    const py = Transform.y[gctx.playerEid] ?? 0;
    const pz = Transform.z[gctx.playerEid] ?? 0;

    const lx = this.leiaMesh.position.x;
    const lz = this.leiaMesh.position.z;

    const dx = px - lx;
    const dz = pz - lz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Follow at distance 2-4
    if (dist > 4) {
      const speed = 4;
      const nx = dx / dist;
      const nz = dz / dist;
      this.leiaMesh.position.x += nx * speed * 0.016;
      this.leiaMesh.position.z += nz * speed * 0.016;

      // Face movement direction
      this.leiaMesh.rotation.y = Math.atan2(nx, nz);
    }

    // Sync ECS transform
    Transform.x[this.leiaEid] = this.leiaMesh.position.x;
    Transform.y[this.leiaEid] = py;
    Transform.z[this.leiaEid] = this.leiaMesh.position.z;

    // Track health
    const hp = Health.hp[this.leiaEid] ?? 0;
    if (hp < this.leiaHealth) {
      this.leiaDamageTaken += (this.leiaHealth - hp);
    }
    this.leiaHealth = hp;
  }

  private updateLocationDistances(_gctx: GroundContext): void {
    // Location distances are computed in buildObjectiveContext
  }

  private updateCheckpoints(gctx: GroundContext): void {
    if (!gctx.playerEid) return;

    const pz = Transform.z[gctx.playerEid] ?? 0;

    // Checkpoints based on Z position
    if (pz < -160 && this.currentCheckpoint < 1) {
      this.currentCheckpoint = 1; // Passed command center
    }
    if (pz < -250 && this.currentCheckpoint < 2) {
      this.currentCheckpoint = 2; // Entered hangar
    }
    if (pz < -305 && this.currentCheckpoint < 3) {
      this.currentCheckpoint = 3; // At ramp
    }
  }

  private getPhaseMessage(): string {
    const active = this.objectiveTracker?.getActiveObjective();
    if (active) {
      return active.definition.hudTextActive;
    }

    switch (this.phase) {
      case "outdoor_defense":
        return `WAVE ${this.waveNumber + 1} - HOLD THE LINE`;
      case "interior_evacuation":
        return "EVACUATE TO THE FALCON!";
      case "success":
        return "VICTORY! THE FALCON ESCAPES!";
      case "fail":
        return "MISSION FAILED";
      default:
        return "DEFEND ECHO BASE";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Effect Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnATATLaserEffect(gctx: GroundContext, fire: any): void {
    gctx.explosions?.spawn(
      new THREE.Vector3(fire.targetX, fire.targetY, fire.targetZ),
      0x44ff44,
      0.3,
      4
    );
  }

  private spawnTurretLaserEffect(gctx: GroundContext, fire: any): void {
    const dir = new THREE.Vector3(
      Math.sin(fire.yaw) * Math.cos(fire.pitch),
      Math.sin(fire.pitch),
      -Math.cos(fire.yaw) * Math.cos(fire.pitch)
    );
    const endPos = new THREE.Vector3(fire.x, fire.y, fire.z).add(dir.multiplyScalar(50));
    gctx.explosions?.spawn(endPos, 0xff4444, 0.1, 1.5);
  }
}
