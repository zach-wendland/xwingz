/**
 * Objective System Types
 * Type definitions for mission objectives, triggers, and progress tracking.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export enum ObjectiveStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  OPTIONAL_AVAILABLE = "OPTIONAL_AVAILABLE",
  OPTIONAL_COMPLETED = "OPTIONAL_COMPLETED",
  OPTIONAL_FAILED = "OPTIONAL_FAILED"
}

export enum TriggerType {
  MISSION_START = "MISSION_START",
  OBJECTIVE_COMPLETE = "OBJECTIVE_COMPLETE",
  KILL_COUNT = "KILL_COUNT",
  KILL_ALL = "KILL_ALL",
  KILL_STREAK = "KILL_STREAK",
  SUBSYSTEMS_DESTROYED = "SUBSYSTEMS_DESTROYED",
  ENTITY_DESTROYED = "ENTITY_DESTROYED",
  ENTITY_HEALTH_BELOW = "ENTITY_HEALTH_BELOW",
  DISTANCE_TO_ENTITY = "DISTANCE_TO_ENTITY",
  ALTITUDE_ABOVE = "ALTITUDE_ABOVE",
  NEAR_ALLIES = "NEAR_ALLIES",
  DURATION = "DURATION",
  COMPOUND = "COMPOUND",
  CABLE_STATE = "CABLE_STATE",
  CABLE_WRAPS = "CABLE_WRAPS",
  REACH_LOCATION = "REACH_LOCATION",
  INTERACT = "INTERACT",
  ESCORT_ALIVE = "ESCORT_ALIVE",
  NPC_HEALTH_ZERO = "NPC_HEALTH_ZERO",
  NPC_DAMAGE_TAKEN = "NPC_DAMAGE_TAKEN",
  ALLIES_ALIVE = "ALLIES_ALIVE",
  ALLY_DEATH = "ALLY_DEATH"
}

export enum ProgressIndicatorType {
  NUMERIC_COUNTER = "NUMERIC_COUNTER",
  PROGRESS_BAR = "PROGRESS_BAR",
  CIRCULAR_PROGRESS = "CIRCULAR_PROGRESS",
  CHECKPOINT_MARKERS = "CHECKPOINT_MARKERS",
  NONE = "NONE"
}

export enum ObjectivePriority {
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL"
}

export enum ObjectiveEventType {
  OBJECTIVE_ACTIVATED = "OBJECTIVE_ACTIVATED",
  OBJECTIVE_PROGRESS = "OBJECTIVE_PROGRESS",
  OBJECTIVE_MILESTONE = "OBJECTIVE_MILESTONE",
  OBJECTIVE_COMPLETED = "OBJECTIVE_COMPLETED",
  OBJECTIVE_FAILED = "OBJECTIVE_FAILED",
  MISSION_COMPLETE = "MISSION_COMPLETE",
  MISSION_FAILED = "MISSION_FAILED"
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface TriggerCondition {
  type: TriggerType;
  /** Numeric value for thresholds (altitude, health %, etc.) */
  value?: number;
  /** Count for kill counts, subsystems, allies */
  count?: number;
  /** Radius for distance/proximity checks */
  radius?: number;
  /** Duration in seconds */
  seconds?: number;
  /** Target type for kill counts (e.g., "tie_fighter", "tie_bomber") */
  targetType?: string;
  /** Target types array for KILL_ALL */
  targetTypes?: string[];
  /** Entity reference for entity-specific triggers */
  entity?: string;
  /** Threshold percentage */
  thresholdPercent?: number;
  /** Sub-conditions for COMPOUND triggers */
  conditions?: TriggerCondition[];
  /** Objective ID for OBJECTIVE_COMPLETE triggers */
  objectiveId?: string;
  /** Wave ID for wave-specific kills */
  waveId?: number;
  /** Location name for REACH_LOCATION */
  location?: string;
  /** NPC name for escort triggers */
  npc?: string;
  /** Subsystem types for SUBSYSTEMS_DESTROYED */
  subsystemTypes?: string[];
  /** Allow any combination of subsystems */
  anyCombination?: boolean;
}

export interface ObjectiveDefinition {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Full description */
  description: string;
  /** Short HUD text when pending */
  hudText: string;
  /** HUD text when active */
  hudTextActive: string;
  /** HUD text when completed */
  hudTextComplete: string;
  /** Mission phase this objective belongs to */
  phase: string;
  /** Order in sequence (lower = earlier) */
  sequence: number;
  /** Priority level for display */
  priority: ObjectivePriority;
  /** Condition to activate this objective */
  triggerStart: TriggerCondition | string;
  /** Condition to complete this objective */
  triggerComplete: TriggerCondition;
  /** Condition that fails this objective (optional) */
  triggerFail?: TriggerCondition | null;
  /** Type of progress indicator to display */
  progressType: ProgressIndicatorType;
  /** Maximum progress value */
  progressMax: number;
  /** Credits awarded on completion */
  rewardCredits: number;
  /** Whether this is an optional/bonus objective */
  isOptional: boolean;
  /** Radio messages to queue on start */
  radioOnStart?: string[];
  /** Radio messages to queue on complete */
  radioOnComplete?: string[];
  /** Milestone messages keyed by progress percentage */
  radioMilestones?: Record<string, string>;
}

export interface ObjectiveState {
  /** Reference to the definition */
  definition: ObjectiveDefinition;
  /** Current status */
  status: ObjectiveStatus;
  /** Current progress (0 to progressMax) */
  progress: number;
  /** Time when objective was activated (mission time) */
  startTime: number;
  /** Time when objective was completed (null if not completed) */
  completedTime: number | null;
  /** Arbitrary metadata for objective-specific state */
  metadata: Record<string, unknown>;
}

export interface ObjectiveEvent {
  type: ObjectiveEventType;
  objectiveId: string;
  objective?: ObjectiveState;
  previousProgress?: number;
  newProgress?: number;
  milestone?: string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Objective Context - Runtime state for trigger evaluation
// ─────────────────────────────────────────────────────────────────────────────

export interface KillTrackingData {
  /** Kills by enemy type */
  byType: Map<string, number>;
  /** Kills by wave number */
  byWave: Map<number, number>;
  /** Total kills */
  total: number;
  /** Current kill streak */
  streak: number;
  /** Whether current streak is valid (player above shield threshold) */
  streakValid: boolean;
}

export interface AllyTrackingData {
  /** Currently alive allies */
  alive: number;
  /** Allies at mission start */
  started: number;
  /** Allies within proximity radius */
  nearbyCount: number;
}

export interface EntityTrackingData {
  /** Subsystems destroyed on capital ship */
  subsystemsDestroyed: number;
  /** Shield generators destroyed */
  shieldGensDestroyed: number;
  /** Whether the capital ship is destroyed */
  capitalShipDestroyed: boolean;
  /** Temple/base health */
  baseHealth: number;
  /** Temple/base health as percentage */
  baseHealthPercent: number;
  /** Cable state for Hoth speeder */
  cableState: number;
  /** Cable wraps completed */
  cableWraps: number;
  /** AT-ATs brought down */
  atatDown: number;
  /** Destroyed subsystem types */
  destroyedSubsystemTypes: string[];
}

export interface EscortTrackingData {
  /** Whether escort NPC is alive */
  escortAlive: boolean;
  /** Escort NPC health */
  escortHealth: number;
  /** Escort NPC max health */
  escortMaxHealth: number;
  /** Total damage taken by escort */
  escortDamageTaken: number;
  /** Player distance to escort */
  distanceToEscort: number;
}

export interface LocationTrackingData {
  /** Player position */
  playerPosition: { x: number; y: number; z: number };
  /** Player altitude */
  playerAltitude: number;
  /** Named locations and distances to them */
  locationDistances: Map<string, number>;
  /** Current checkpoint reached */
  checkpoint: number;
}

export interface ObjectiveContext {
  /** Mission elapsed time in seconds */
  missionTime: number;
  /** Kill tracking data */
  kills: KillTrackingData;
  /** Ally tracking data */
  allies: AllyTrackingData;
  /** Entity tracking data */
  entities: EntityTrackingData;
  /** Escort tracking data (for ground missions) */
  escort: EscortTrackingData;
  /** Location tracking data */
  location: LocationTrackingData;
  /** Player shield percentage (0-100) */
  playerShieldPercent: number;
  /** Completed objective IDs */
  completedObjectives: Set<string>;
  /** Interaction progress (for INTERACT triggers) */
  interactProgress: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ObjectiveTrackerSaveData {
  version: number;
  activeObjectiveId: string | null;
  completedObjectives: string[];
  failedObjectives: string[];
  objectiveStates: Array<{
    id: string;
    status: ObjectiveStatus;
    progress: number;
    startTime: number;
    completedTime: number | null;
    metadata: Record<string, unknown>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a default ObjectiveContext with zeroed values
 */
export function createDefaultObjectiveContext(): ObjectiveContext {
  return {
    missionTime: 0,
    kills: {
      byType: new Map(),
      byWave: new Map(),
      total: 0,
      streak: 0,
      streakValid: true
    },
    allies: {
      alive: 0,
      started: 0,
      nearbyCount: 0
    },
    entities: {
      subsystemsDestroyed: 0,
      shieldGensDestroyed: 0,
      capitalShipDestroyed: false,
      baseHealth: 0,
      baseHealthPercent: 100,
      cableState: 0,
      cableWraps: 0,
      atatDown: 0,
      destroyedSubsystemTypes: []
    },
    escort: {
      escortAlive: true,
      escortHealth: 100,
      escortMaxHealth: 100,
      escortDamageTaken: 0,
      distanceToEscort: 0
    },
    location: {
      playerPosition: { x: 0, y: 0, z: 0 },
      playerAltitude: 0,
      locationDistances: new Map(),
      checkpoint: 0
    },
    playerShieldPercent: 100,
    completedObjectives: new Set(),
    interactProgress: 0
  };
}

/**
 * Create a simple MISSION_START trigger
 */
export function missionStartTrigger(): TriggerCondition {
  return { type: TriggerType.MISSION_START };
}

/**
 * Create an OBJECTIVE_COMPLETE trigger
 */
export function objectiveCompleteTrigger(objectiveId: string): TriggerCondition {
  return { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId };
}

/**
 * Create a KILL_COUNT trigger
 */
export function killCountTrigger(targetType: string, count: number, waveId?: number): TriggerCondition {
  return { type: TriggerType.KILL_COUNT, targetType, count, waveId };
}

/**
 * Create a COMPOUND trigger (AND logic)
 */
export function compoundTrigger(conditions: TriggerCondition[]): TriggerCondition {
  return { type: TriggerType.COMPOUND, conditions };
}
