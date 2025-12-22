/**
 * Battle of Coruscant - Mission Runtime Controller
 *
 * This file provides the runtime integration between:
 * - The mission definition (packages/procgen/src/missions/coruscant_battle.ts)
 * - The ECS systems (./coruscant-systems.ts)
 * - The main game loop (apps/web/src/main.ts)
 *
 * THREE.JS / REACT THREE FIBER INTEGRATION:
 *
 * Capital Ships:
 * - Use THREE.LOD for distance-based detail levels
 * - Low detail: Simple box/cylinder geometry with emissive windows
 * - Medium detail: Basic ship silhouette with key features
 * - High detail: Full mesh with turret animations
 *
 * Buzz Droids Visual Effect:
 * ```tsx
 * // React Three Fiber component
 * function BuzzDroidEffect({ attached, attachPoint }) {
 *   const pointsRef = useRef<THREE.Points>(null);
 *   const { clock } = useThree();
 *
 *   useFrame(() => {
 *     if (pointsRef.current && attached) {
 *       // Animate sparks
 *       pointsRef.current.material.uniforms.time.value = clock.elapsedTime;
 *     }
 *   });
 *
 *   return (
 *     <points ref={pointsRef} position={attachPoint}>
 *       <bufferGeometry>
 *         <bufferAttribute attach="attributes-position" count={8} array={sparkPositions} itemSize={3} />
 *       </bufferGeometry>
 *       <shaderMaterial
 *         uniforms={{ time: { value: 0 }, color: { value: new THREE.Color(0xff6600) } }}
 *         vertexShader={sparkVertexShader}
 *         fragmentShader={sparkFragmentShader}
 *         transparent
 *         blending={THREE.AdditiveBlending}
 *       />
 *     </points>
 *   );
 * }
 * ```
 *
 * Capital Ship Turbolaser Effects:
 * - Use THREE.Line with gradient material for beam
 * - Animate opacity and position for firing effect
 * - Add impact flash with THREE.PointLight
 */

import type { IWorld } from "bitecs";
import { hasComponent, removeEntity } from "bitecs";
import { Vector3 } from "@xwingz/core";
import type {
  CoruscantMissionDef,
  CoruscantMissionPhase,
  CoruscantDialogueTrigger,
  CoruscantWaveSpawnConfig,
  CoruscantFighterArchetypeId,
  CapitalShipPlacement,
  BuzzDroidConfig,
  BUZZDROID_CONFIG
} from "@xwingz/procgen";
import {
  createCoruscantBattleMission,
  getCoruscantFighterArchetype,
  getCapitalShip,
  calculateSpawnPosition,
  calculateInitialHeading
} from "@xwingz/procgen";
import { createRng, deriveSeed, type Seed } from "@xwingz/procgen";
import { Transform, Health, Team, Ship } from "./components";
import {
  spawnSeparatistFighter,
  spawnBuzzDroidSwarm,
  spawnCapitalShip,
  spawnBoardingCraft,
  capitalShipSystem,
  weakPointSystem,
  buzzDroidSystem,
  droidAISystem,
  boardingCraftSystem,
  turbolaserSystem,
  consumeWeakPointEvents,
  consumeBuzzDroidEvents,
  consumeBoardingCraftEvents,
  type CoruscantSpawnResult,
  type WeakPointDestroyedEvent,
  type BuzzDroidDamageEvent,
  type BoardingCraftEvent
} from "./coruscant-systems";

// ============================================================================
// RUNTIME STATE
// ============================================================================

export type CoruscantRuntimeState = {
  mission: CoruscantMissionDef;
  currentPhaseIndex: number;
  phaseTimer: number;
  totalMissionTime: number;

  // Entity tracking
  capitalShipEids: Map<string, { shipEid: number; weakPointEids: number[] }>;
  enemyFighterEids: number[];
  allyFighterEids: number[];
  boardingCraftEid: number | null;

  // Wave management
  waveTimers: Map<number, number>;
  wavesTriggered: Set<number>;

  // Dialogue
  activeDialogue: CoruscantDialogueTrigger | null;
  dialogueTimer: number;
  dialogueQueue: CoruscantDialogueTrigger[];

  // Buzz droid state
  buzzDroidAttached: boolean;
  barrelRollCooldown: { value: number };

  // Stats
  enemiesDestroyed: number;
  alliesLost: number;
  playerDamageReceived: number;

  // Objectives
  objectivesCompleted: Set<string>;
  objectivesFailed: Set<string>;

  // Phase transition
  pendingPhaseTransition: boolean;
  transitionDelay: number;

  // Messages for HUD
  message: string;
  messageTimer: number;
  subtitleMessage: string;
  subtitleTimer: number;
};

// ============================================================================
// INITIALIZATION
// ============================================================================

export function createCoruscantRuntime(
  seed: Seed,
  difficulty: "easy" | "normal" | "hard" | "legendary" = "normal"
): CoruscantRuntimeState {
  const mission = createCoruscantBattleMission(seed, difficulty);

  return {
    mission,
    currentPhaseIndex: 0,
    phaseTimer: 0,
    totalMissionTime: 0,

    capitalShipEids: new Map(),
    enemyFighterEids: [],
    allyFighterEids: [],
    boardingCraftEid: null,

    waveTimers: new Map(),
    wavesTriggered: new Set(),

    activeDialogue: null,
    dialogueTimer: 0,
    dialogueQueue: [],

    buzzDroidAttached: false,
    barrelRollCooldown: { value: 0 },

    enemiesDestroyed: 0,
    alliesLost: 0,
    playerDamageReceived: 0,

    objectivesCompleted: new Set(),
    objectivesFailed: new Set(),

    pendingPhaseTransition: false,
    transitionDelay: 0,

    message: mission.title,
    messageTimer: 4,
    subtitleMessage: mission.subtitle,
    subtitleTimer: 6
  };
}

/**
 * Spawns all initial entities for the mission.
 * Call this after creating the runtime state.
 */
export function initializeCoruscantMission(
  world: IWorld,
  state: CoruscantRuntimeState,
  playerEid: number
): void {
  const mission = state.mission;
  const rng = createRng(mission.seed);

  // Spawn capital ships
  for (const placement of mission.capitalShipPositions) {
    const shipConfig = getCapitalShip(placement.shipId);

    const weakPointConfigs = shipConfig.weakPoints?.map(wp => ({
      localPos: [wp.position.x, wp.position.y, wp.position.z] as [number, number, number],
      radius: wp.radius,
      hp: 500 * wp.damageMultiplier, // Scale HP by damage multiplier
      type: "bridge" as const, // Simplified
      isCritical: placement.isObjective
    })) ?? [];

    const result = spawnCapitalShip(
      world,
      placement.shipId === "venator_star_destroyer" ? "venator" :
      placement.shipId === "providence_destroyer" ? "providence" :
      placement.shipId === "munificent_frigate" ? "munificent" : "invisible_hand",
      placement.team as 0 | 1,
      [placement.position.x, placement.position.y, placement.position.z],
      eulerToQuat(placement.rotation.x, placement.rotation.y, placement.rotation.z),
      shipConfig.hp,
      placement.isObjective,
      weakPointConfigs
    );

    state.capitalShipEids.set(
      placement.displayName ?? placement.shipId,
      result
    );
  }

  // Spawn ally wingmen
  for (let i = 0; i < mission.wingmen.length; i++) {
    const wingman = mission.wingmen[i]!;
    const archetype = getCoruscantFighterArchetype(wingman.archetypeId);

    // Position behind and beside player
    const offsetX = (i % 2 === 0 ? -1 : 1) * (40 + Math.floor(i / 2) * 30);
    const offsetZ = 50 + Math.floor(i / 2) * 40;

    const spawnPos: [number, number, number] = [
      (Transform.x[playerEid] ?? 0) + offsetX,
      Transform.y[playerEid] ?? 0,
      (Transform.z[playerEid] ?? 0) + offsetZ
    ];

    const result = spawnSeparatistFighter(
      world,
      "vulture", // Will be overridden
      spawnPos,
      [0, 0, 0, 1],
      [0, 0, -150],
      0,
      archetype.aggression
    );

    // Override to ally stats
    Team.id[result.entityId] = 0;
    Ship.maxSpeed[result.entityId] = archetype.maxSpeed;
    Ship.accel[result.entityId] = archetype.accel;
    Ship.turnRate[result.entityId] = archetype.turnRate;
    Health.hp[result.entityId] = archetype.hp;
    Health.maxHp[result.entityId] = archetype.hp;

    state.allyFighterEids.push(result.entityId);
  }

  // Initialize wave timers for first phase
  initializePhaseWaves(state, 0);
}

// ============================================================================
// MAIN UPDATE LOOP
// ============================================================================

export type CoruscantUpdateResult = {
  phaseChanged: boolean;
  newPhase?: CoruscantMissionPhase;
  dialogueEvent?: CoruscantDialogueTrigger;
  missionComplete: boolean;
  missionSuccess: boolean;
  reward: number;
};

/**
 * Main update function - call every frame.
 */
export function updateCoruscantMission(
  world: IWorld,
  state: CoruscantRuntimeState,
  dt: number,
  playerEid: number,
  barrelRollInput: boolean
): CoruscantUpdateResult {
  const result: CoruscantUpdateResult = {
    phaseChanged: false,
    missionComplete: false,
    missionSuccess: false,
    reward: 0
  };

  // Update timers
  state.phaseTimer += dt;
  state.totalMissionTime += dt;

  if (state.messageTimer > 0) {
    state.messageTimer = Math.max(0, state.messageTimer - dt);
  }
  if (state.subtitleTimer > 0) {
    state.subtitleTimer = Math.max(0, state.subtitleTimer - dt);
  }

  // Get current phase
  const phase = state.mission.phases[state.currentPhaseIndex];
  if (!phase) {
    result.missionComplete = true;
    result.missionSuccess = state.currentPhaseIndex > 0; // Made it past first phase
    result.reward = calculateReward(state);
    return result;
  }

  // Update ECS systems
  capitalShipSystem(world, dt);
  weakPointSystem(world, dt);

  // Buzz droid system
  buzzDroidSystem(world, dt, barrelRollInput, state.barrelRollCooldown);

  // Droid AI with objective positions
  const playerPos = hasComponent(world, Transform, playerEid)
    ? new Vector3(Transform.x[playerEid] ?? 0, Transform.y[playerEid] ?? 0, Transform.z[playerEid] ?? 0)
    : null;

  const capitalShipPositions: Array<{ eid: number; pos: Vector3; team: number }> = [];
  for (const [name, data] of state.capitalShipEids) {
    if (hasComponent(world, Transform, data.shipEid)) {
      capitalShipPositions.push({
        eid: data.shipEid,
        pos: new Vector3(
          Transform.x[data.shipEid] ?? 0,
          Transform.y[data.shipEid] ?? 0,
          Transform.z[data.shipEid] ?? 0
        ),
        team: hasComponent(world, Team, data.shipEid) ? (Team.id[data.shipEid] ?? 0) : 0
      });
    }
  }

  const boardingCraftPos = state.boardingCraftEid !== null && hasComponent(world, Transform, state.boardingCraftEid)
    ? new Vector3(
        Transform.x[state.boardingCraftEid] ?? 0,
        Transform.y[state.boardingCraftEid] ?? 0,
        Transform.z[state.boardingCraftEid] ?? 0
      )
    : null;

  droidAISystem(world, dt, {
    playerPos,
    capitalShips: capitalShipPositions,
    boardingCraft: boardingCraftPos
  });

  // Boarding craft system
  if (state.boardingCraftEid !== null) {
    boardingCraftSystem(world, dt);
  }

  // Turbolaser system
  turbolaserSystem(world, dt, state.enemyFighterEids);

  // Process events
  processEvents(world, state);

  // Update wave spawning
  updateWaves(world, state, playerEid);

  // Update dialogue
  updateDialogue(state, dt);
  if (state.activeDialogue) {
    result.dialogueEvent = state.activeDialogue;
  }

  // Check phase transition
  if (checkPhaseComplete(state, phase)) {
    if (state.pendingPhaseTransition) {
      state.transitionDelay -= dt;
      if (state.transitionDelay <= 0) {
        transitionToNextPhase(state);
        result.phaseChanged = true;
        result.newPhase = state.mission.phases[state.currentPhaseIndex];
      }
    } else {
      state.pendingPhaseTransition = true;
      state.transitionDelay = 2.0; // 2 second delay before phase change
    }
  }

  // Check failure conditions
  if (checkPhaseFailed(world, state, phase, playerEid)) {
    result.missionComplete = true;
    result.missionSuccess = false;
    result.reward = 0;
    return result;
  }

  // Check for victory phase
  if (phase.id === "victory") {
    result.missionComplete = true;
    result.missionSuccess = true;
    result.reward = calculateReward(state);
  }

  return result;
}

// ============================================================================
// WAVE MANAGEMENT
// ============================================================================

function initializePhaseWaves(state: CoruscantRuntimeState, phaseIndex: number): void {
  const phase = state.mission.phases[phaseIndex];
  if (!phase) return;

  state.waveTimers.clear();
  state.wavesTriggered.clear();

  for (let i = 0; i < phase.waves.length; i++) {
    state.waveTimers.set(i, phase.waves[i]!.delaySeconds);
  }
}

function updateWaves(
  world: IWorld,
  state: CoruscantRuntimeState,
  playerEid: number
): void {
  const phase = state.mission.phases[state.currentPhaseIndex];
  if (!phase) return;

  const rng = createRng(deriveSeed(state.mission.seed, "waves", state.currentPhaseIndex.toString()));

  for (let waveIndex = 0; waveIndex < phase.waves.length; waveIndex++) {
    if (state.wavesTriggered.has(waveIndex)) continue;

    const remainingTime = (state.waveTimers.get(waveIndex) ?? 0) - state.phaseTimer;
    if (remainingTime <= 0) {
      // Spawn this wave
      const wave = phase.waves[waveIndex]!;
      spawnWave(world, state, wave, playerEid, rng);
      state.wavesTriggered.add(waveIndex);
    }
  }
}

function spawnWave(
  world: IWorld,
  state: CoruscantRuntimeState,
  wave: CoruscantWaveSpawnConfig,
  playerEid: number,
  rng: ReturnType<typeof createRng>
): void {
  const archetype = getCoruscantFighterArchetype(wave.archetypeId);

  const playerPos = {
    x: hasComponent(world, Transform, playerEid) ? (Transform.x[playerEid] ?? 0) : 0,
    y: hasComponent(world, Transform, playerEid) ? (Transform.y[playerEid] ?? 0) : 0,
    z: hasComponent(world, Transform, playerEid) ? (Transform.z[playerEid] ?? 0) : 0
  };

  // Get capital ship position for targeting
  let capitalShipPos = playerPos;
  for (const [name, data] of state.capitalShipEids) {
    if (hasComponent(world, Team, data.shipEid) && (Team.id[data.shipEid] ?? 0) === 0) {
      capitalShipPos = {
        x: Transform.x[data.shipEid] ?? 0,
        y: Transform.y[data.shipEid] ?? 0,
        z: Transform.z[data.shipEid] ?? 0
      };
      break;
    }
  }

  for (let i = 0; i < wave.count; i++) {
    const spawnPos = calculateSpawnPosition(wave.spawnPosition, i, wave.count, wave.formation, rng);
    const heading = calculateInitialHeading(spawnPos, wave.targetPriority, playerPos, capitalShipPos);

    const fighterType: "vulture" | "tri_fighter" | "hyena" =
      wave.archetypeId === "vulture_droid" ? "vulture" :
      wave.archetypeId === "tri_fighter" ? "tri_fighter" :
      wave.archetypeId === "hyena_bomber" ? "hyena" : "vulture";

    const targetPriority: 0 | 1 | 2 =
      wave.targetPriority === "player" ? 0 :
      wave.targetPriority === "allies" ? 1 :
      wave.targetPriority === "capital_ship" ? 2 : 0;

    const result = spawnSeparatistFighter(
      world,
      fighterType,
      [spawnPos.x, spawnPos.y, spawnPos.z],
      [heading.qx, heading.qy, heading.qz, heading.qw],
      [0, 0, 0],
      targetPriority,
      wave.aggressionOverride ?? archetype.aggression
    );

    state.enemyFighterEids.push(result.entityId);
  }

  // Trigger wave spawn dialogue if exists
  triggerTimeDialogue(state, state.phaseTimer);
}

// ============================================================================
// DIALOGUE SYSTEM
// ============================================================================

function updateDialogue(state: CoruscantRuntimeState, dt: number): void {
  if (state.activeDialogue) {
    state.dialogueTimer -= dt;
    if (state.dialogueTimer <= 0) {
      state.activeDialogue = null;
      // Pull next from queue
      if (state.dialogueQueue.length > 0) {
        state.activeDialogue = state.dialogueQueue.shift()!;
        state.dialogueTimer = state.activeDialogue.durationSeconds;
      }
    }
  } else if (state.dialogueQueue.length > 0) {
    state.activeDialogue = state.dialogueQueue.shift()!;
    state.dialogueTimer = state.activeDialogue.durationSeconds;
  }

  // Check for time-based dialogue triggers
  triggerTimeDialogue(state, state.phaseTimer);
}

function triggerTimeDialogue(state: CoruscantRuntimeState, currentTime: number): void {
  const phase = state.mission.phases[state.currentPhaseIndex];
  if (!phase) return;

  for (const dialogue of phase.dialogue) {
    if (dialogue.trigger === "time" && dialogue.triggerValue !== undefined) {
      const triggerTime = dialogue.triggerValue;
      const tolerance = 0.5; // Half second tolerance

      if (Math.abs(currentTime - triggerTime) < tolerance) {
        // Check if already in queue
        const alreadyQueued = state.dialogueQueue.some(d => d.id === dialogue.id);
        const isActive = state.activeDialogue?.id === dialogue.id;

        if (!alreadyQueued && !isActive) {
          queueDialogue(state, dialogue);
        }
      }
    } else if (dialogue.trigger === "phase_start" && currentTime < 1) {
      const alreadyQueued = state.dialogueQueue.some(d => d.id === dialogue.id);
      const isActive = state.activeDialogue?.id === dialogue.id;

      if (!alreadyQueued && !isActive) {
        queueDialogue(state, dialogue);
      }
    }
  }
}

function queueDialogue(state: CoruscantRuntimeState, dialogue: CoruscantDialogueTrigger): void {
  const priorityOrder = { critical: 0, high: 1, normal: 2, ambient: 3 };

  if (!state.activeDialogue) {
    state.activeDialogue = dialogue;
    state.dialogueTimer = dialogue.durationSeconds;
    return;
  }

  // Insert based on priority
  const newPriority = priorityOrder[dialogue.priority];
  const currentPriority = priorityOrder[state.activeDialogue.priority];

  if (newPriority < currentPriority) {
    // Interrupt current
    state.dialogueQueue.unshift(state.activeDialogue);
    state.activeDialogue = dialogue;
    state.dialogueTimer = dialogue.durationSeconds;
  } else {
    // Add to queue in priority order
    let insertIndex = state.dialogueQueue.length;
    for (let i = 0; i < state.dialogueQueue.length; i++) {
      const queuedPriority = priorityOrder[state.dialogueQueue[i]!.priority];
      if (newPriority < queuedPriority) {
        insertIndex = i;
        break;
      }
    }
    state.dialogueQueue.splice(insertIndex, 0, dialogue);
  }
}

// ============================================================================
// EVENT PROCESSING
// ============================================================================

function processEvents(world: IWorld, state: CoruscantRuntimeState): void {
  // Weak point events
  const wpEvents = consumeWeakPointEvents();
  for (const event of wpEvents) {
    if (event.isCritical) {
      state.objectivesCompleted.add(`weak_point_${event.weakPointEid}`);
      state.message = "WEAK POINT DESTROYED!";
      state.messageTimer = 3;
    }
  }

  // Buzz droid events
  const buzzEvents = consumeBuzzDroidEvents();
  for (const event of buzzEvents) {
    if (event.shakenOff) {
      state.buzzDroidAttached = false;
      state.message = "BUZZ DROIDS CLEARED!";
      state.messageTimer = 2;
    } else if (event.damage > 0) {
      state.buzzDroidAttached = true;
    }
  }

  // Boarding craft events
  const bcEvents = consumeBoardingCraftEvents();
  for (const event of bcEvents) {
    if (event.type === "docked") {
      state.objectivesCompleted.add("boarding_craft_docked");
      state.message = "BOARDING PARTY DEPLOYED!";
      state.messageTimer = 4;
    } else if (event.type === "destroyed") {
      state.objectivesFailed.add("boarding_craft_destroyed");
      state.message = "BOARDING CRAFT LOST!";
      state.messageTimer = 4;
    }
  }

  // Update enemy count
  state.enemyFighterEids = state.enemyFighterEids.filter(eid => {
    const alive = hasComponent(world, Health, eid) && (Health.hp[eid] ?? 0) > 0;
    if (!alive) {
      state.enemiesDestroyed++;
    }
    return alive;
  });

  // Update ally count
  const allyCountBefore = state.allyFighterEids.length;
  state.allyFighterEids = state.allyFighterEids.filter(eid => {
    return hasComponent(world, Health, eid) && (Health.hp[eid] ?? 0) > 0;
  });
  state.alliesLost += allyCountBefore - state.allyFighterEids.length;
}

// ============================================================================
// PHASE MANAGEMENT
// ============================================================================

function checkPhaseComplete(
  state: CoruscantRuntimeState,
  phase: CoruscantMissionPhase
): boolean {
  switch (phase.victoryCondition.type) {
    case "all_enemies_destroyed":
      const allWavesTriggered = state.wavesTriggered.size >= phase.waves.length;
      return allWavesTriggered && state.enemyFighterEids.length === 0;

    case "survive_time":
      const requiredTime = (phase.victoryCondition.params?.seconds as number) ?? phase.durationSeconds ?? 60;
      return state.phaseTimer >= requiredTime;

    case "objective_complete":
      // Check if key objectives are done
      return state.objectivesCompleted.has("boarding_craft_docked");

    default:
      return false;
  }
}

function checkPhaseFailed(
  world: IWorld,
  state: CoruscantRuntimeState,
  phase: CoruscantMissionPhase,
  playerEid: number
): boolean {
  switch (phase.failureCondition.type) {
    case "player_destroyed":
      return !hasComponent(world, Health, playerEid) || (Health.hp[playerEid] ?? 0) <= 0;

    case "ally_destroyed":
      if (phase.failureCondition.target === "republic_cruisers") {
        const threshold = phase.failureCondition.threshold ?? 1;
        let destroyedCount = 0;

        for (const [name, data] of state.capitalShipEids) {
          if (hasComponent(world, Team, data.shipEid) && (Team.id[data.shipEid] ?? 0) === 0) {
            if (!hasComponent(world, Health, data.shipEid) || (Health.hp[data.shipEid] ?? 0) <= 0) {
              destroyedCount++;
            }
          }
        }

        return destroyedCount >= threshold;
      }
      return false;

    case "time_expired":
      const timeLimit = phase.failureCondition.threshold ?? phase.durationSeconds ?? 180;
      return state.phaseTimer >= timeLimit;

    default:
      return false;
  }
}

function transitionToNextPhase(state: CoruscantRuntimeState): void {
  state.currentPhaseIndex++;
  state.phaseTimer = 0;
  state.pendingPhaseTransition = false;
  state.transitionDelay = 0;

  const newPhase = state.mission.phases[state.currentPhaseIndex];
  if (newPhase) {
    state.message = newPhase.name.toUpperCase();
    state.messageTimer = 4;
    state.subtitleMessage = newPhase.description;
    state.subtitleTimer = 6;

    initializePhaseWaves(state, state.currentPhaseIndex);
  }
}

// ============================================================================
// REWARD CALCULATION
// ============================================================================

function calculateReward(state: CoruscantRuntimeState): number {
  let reward = state.mission.baseCredits;

  // Check bonus objectives
  for (const bonus of state.mission.bonusObjectives) {
    let achieved = false;

    switch (bonus.condition) {
      case "no_ally_deaths":
        achieved = state.alliesLost === 0;
        break;
      case "time_limit":
        achieved = state.totalMissionTime < (bonus.value ?? 480);
        break;
      case "destroy_all":
        achieved = state.enemiesDestroyed >= (bonus.value ?? 50);
        break;
      case "no_damage":
        achieved = state.playerDamageReceived === 0;
        break;
    }

    if (achieved) {
      reward += bonus.creditBonus;
    }
  }

  return reward;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function eulerToQuat(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);

  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3
  ];
}

// ============================================================================
// HUD HELPERS
// ============================================================================

export type CoruscantHUDState = {
  phaseName: string;
  phaseObjective: string;
  phaseTimer: number;
  enemiesRemaining: number;
  alliesRemaining: number;
  message: string;
  messageActive: boolean;
  dialogue: {
    speaker: string;
    callsign?: string;
    text: string;
  } | null;
  buzzDroidWarning: boolean;
  capitalShipHealth: Array<{
    name: string;
    team: number;
    hpPercent: number;
  }>;
};

export function getCoruscantHUDState(
  world: IWorld,
  state: CoruscantRuntimeState
): CoruscantHUDState {
  const phase = state.mission.phases[state.currentPhaseIndex];

  const capitalShipHealth: CoruscantHUDState["capitalShipHealth"] = [];
  for (const [name, data] of state.capitalShipEids) {
    if (hasComponent(world, Health, data.shipEid)) {
      const hp = Health.hp[data.shipEid] ?? 0;
      const maxHp = Health.maxHp[data.shipEid] ?? 1;
      const team = hasComponent(world, Team, data.shipEid) ? (Team.id[data.shipEid] ?? 0) : 0;

      capitalShipHealth.push({
        name,
        team,
        hpPercent: Math.max(0, Math.min(100, (hp / maxHp) * 100))
      });
    }
  }

  return {
    phaseName: phase?.name ?? "Unknown",
    phaseObjective: phase?.objectives[0]?.hudText ?? "",
    phaseTimer: state.phaseTimer,
    enemiesRemaining: state.enemyFighterEids.length,
    alliesRemaining: state.allyFighterEids.length,
    message: state.messageTimer > 0 ? state.message : "",
    messageActive: state.messageTimer > 0,
    dialogue: state.activeDialogue ? {
      speaker: state.activeDialogue.speaker,
      callsign: state.activeDialogue.callsign,
      text: state.activeDialogue.text
    } : null,
    buzzDroidWarning: state.buzzDroidAttached,
    capitalShipHealth
  };
}
