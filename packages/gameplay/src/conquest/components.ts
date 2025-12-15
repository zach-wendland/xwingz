/**
 * Galactic Conquest ECS Components
 *
 * Real-time conquest with seamless space-to-ground transitions.
 * Supports both strategic layer (fleets, planets) and tactical (battles).
 */

import { defineComponent, Types } from "bitecs";

// ─────────────────────────────────────────────────────────────────────────────
// Faction Constants
// ─────────────────────────────────────────────────────────────────────────────

export const CONQUEST_FACTION = {
  NEUTRAL: 0,
  REBEL: 1,
  EMPIRE: 2
} as const;

export type ConquestFactionId = (typeof CONQUEST_FACTION)[keyof typeof CONQUEST_FACTION];

// ─────────────────────────────────────────────────────────────────────────────
// Domain Tags - Which physics/systems affect this entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entity exists in space domain (affected by space physics/combat)
 */
export const InSpaceDomain = defineComponent({});

/**
 * Note: InGroundDomain already exists in ground/components.ts
 * We re-export it for convenience but don't redefine
 */

// ─────────────────────────────────────────────────────────────────────────────
// Persistence Tags - Survive mode transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entity persists across mode transitions (not destroyed on mode exit)
 */
export const Persistent = defineComponent({});

/**
 * Entity is owned/controlled by player (special handling during transitions)
 */
export const PlayerOwned = defineComponent({});

/**
 * Entity is currently hidden (paused during domain transition)
 */
export const Hidden = defineComponent({});

// ─────────────────────────────────────────────────────────────────────────────
// Planet Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ConquestPlanet - Strategic state for a planet in the galactic map.
 * Links to static PLANETS array via planetIndex.
 */
export const ConquestPlanet = defineComponent({
  /** Index into PLANETS array for static data (name, style, position) */
  planetIndex: Types.ui8,

  /** Overall controlling faction (0=neutral, 1=rebel, 2=empire) */
  controllingFaction: Types.ui8,

  /** Who controls orbital space (0=contested, 1=rebel, 2=empire) */
  spaceControl: Types.ui8,

  /** Who controls planet surface (0=contested, 1=rebel, 2=empire) */
  groundControl: Types.ui8,

  /** Ground garrison strength (0-100) */
  garrison: Types.f32,

  /** Max garrison capacity */
  maxGarrison: Types.f32,

  /** Accumulated resources (credits) */
  resources: Types.f32,

  /** Resource generation rate per second */
  resourceRate: Types.f32,

  /** Industry level (0-1, affects fleet build speed) */
  industryLevel: Types.f32,

  /** Defense bonus for battles (0-1) */
  defenseBonus: Types.f32,

  /** Is planet currently under attack? */
  underAttack: Types.ui8,

  /** Battle phase: 0=none, 1=space_battle, 2=ground_battle */
  battlePhase: Types.ui8
});

// ─────────────────────────────────────────────────────────────────────────────
// Fleet Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ConquestFleet - Mobile space force that moves between planets.
 */
export const ConquestFleet = defineComponent({
  /** Owning faction (1=rebel, 2=empire) */
  faction: Types.ui8,

  /** Number of fighter squadrons (each = ~12 fighters) */
  fighterSquadrons: Types.ui8,

  /** Number of capital ships */
  capitalShips: Types.ui8,

  /** Number of bomber squadrons */
  bomberSquadrons: Types.ui8,

  /** Current planet entity ID (-1 if in hyperspace) */
  currentPlanetEid: Types.i32,

  /** Destination planet entity ID (-1 if stationary) */
  destinationPlanetEid: Types.i32,

  /** Movement progress (0-1, reaches 1 at destination) */
  movementProgress: Types.f32,

  /** Hyperspace travel time (seconds total) */
  travelTime: Types.f32,

  /** Fleet strength rating (computed) */
  strength: Types.f32,

  /** Fleet veterancy/experience (0-1, affects combat) */
  veterancy: Types.f32,

  /** Is this the player's fleet? */
  isPlayerFleet: Types.ui8,

  /** Fleet state: 0=idle, 1=moving, 2=combat, 3=retreating */
  state: Types.ui8
});

/** Fleet state constants */
export const FLEET_STATE = {
  IDLE: 0,
  MOVING: 1,
  COMBAT: 2,
  RETREATING: 3
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Ground Force Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GroundForce - Ground troops stationed at or attacking a planet.
 */
export const GroundForce = defineComponent({
  /** Owning faction (1=rebel, 2=empire) */
  faction: Types.ui8,

  /** Number of infantry platoons */
  infantryPlatoons: Types.ui8,

  /** Number of vehicle squadrons (walkers, tanks, etc.) */
  vehicleSquadrons: Types.ui8,

  /** Number of artillery units */
  artilleryUnits: Types.ui8,

  /** Planet entity ID where force is located */
  planetEid: Types.i32,

  /** Force strength rating (computed) */
  strength: Types.f32,

  /** Force veterancy (0-1) */
  veterancy: Types.f32,

  /** Is this the player's ground force? */
  isPlayerForce: Types.ui8,

  /** Force state: 0=garrison, 1=attacking, 2=defending, 3=retreating */
  state: Types.ui8
});

/** Ground force state constants */
export const GROUND_FORCE_STATE = {
  GARRISON: 0,
  ATTACKING: 1,
  DEFENDING: 2,
  RETREATING: 3
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Conquest Game State (Singleton)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ConquestState - Global game state for the conquest campaign.
 * Only one entity should have this component.
 */
export const ConquestState = defineComponent({
  /** Game time elapsed (seconds) */
  gameTime: Types.f32,

  /** Rebel Alliance total credits */
  rebelCredits: Types.f32,

  /** Galactic Empire total credits */
  empireCredits: Types.f32,

  /** Rebel victory points */
  rebelVictoryPoints: Types.i32,

  /** Empire victory points */
  empireVictoryPoints: Types.i32,

  /** Victory threshold (first to reach wins) */
  victoryThreshold: Types.i32,

  /** Game phase: 0=setup, 1=playing, 2=rebel_victory, 3=empire_victory */
  phase: Types.ui8,

  /** Number of planets controlled by rebels */
  rebelPlanets: Types.ui8,

  /** Number of planets controlled by empire */
  empirePlanets: Types.ui8,

  /** Time until next AI strategic decision (seconds) */
  nextAiTick: Types.f32,

  /** Player's faction (1=rebel, 2=empire) */
  playerFaction: Types.ui8
});

/** Game phase constants */
export const CONQUEST_PHASE = {
  SETUP: 0,
  PLAYING: 1,
  REBEL_VICTORY: 2,
  EMPIRE_VICTORY: 3
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Battle Marker Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BattlePending - Marks a location where a battle needs resolution.
 * When player is present, triggers FlightMode or GroundMode.
 * When player is absent, auto-resolves.
 */
export const BattlePending = defineComponent({
  /** Planet where battle occurs */
  planetEid: Types.i32,

  /** Attacking fleet entity (-1 if ground-only) */
  attackerFleetEid: Types.i32,

  /** Defending fleet entity (-1 if no fleet) */
  defenderFleetEid: Types.i32,

  /** Attacking ground force entity (-1 if space-only) */
  attackerGroundEid: Types.i32,

  /** Defending ground force entity (-1 if no ground force) */
  defenderGroundEid: Types.i32,

  /** Attacker faction */
  attackerFaction: Types.ui8,

  /** Defender faction */
  defenderFaction: Types.ui8,

  /** Battle type: 0=space, 1=ground, 2=combined */
  battleType: Types.ui8,

  /** Is player involved in this battle? */
  playerInvolved: Types.ui8,

  /** Time until auto-resolve if player not present (seconds) */
  autoResolveTimer: Types.f32
});

/** Battle type constants */
export const BATTLE_TYPE = {
  SPACE: 0,
  GROUND: 1,
  COMBINED: 2
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Hyperlane Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hyperlane - Defines travel routes between planets.
 * Fleets can only move along hyperlanes.
 */
export const Hyperlane = defineComponent({
  /** Source planet entity ID */
  fromPlanetEid: Types.i32,

  /** Destination planet entity ID */
  toPlanetEid: Types.i32,

  /** Base travel time in seconds */
  baseTravelTime: Types.f32,

  /** Is this a major trade route? (faster travel) */
  isMajorRoute: Types.ui8
});

// ─────────────────────────────────────────────────────────────────────────────
// Transition State Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TransitionState - Tracks player's current transition between domains.
 * Attached to player entity during space↔ground transitions.
 */
export const TransitionState = defineComponent({
  /** Transition type: 0=none, 1=landing, 2=launching */
  type: Types.ui8,

  /** Transition progress (0-1) */
  progress: Types.f32,

  /** Source position X */
  sourceX: Types.f32,
  /** Source position Y */
  sourceY: Types.f32,
  /** Source position Z */
  sourceZ: Types.f32,

  /** Target position X */
  targetX: Types.f32,
  /** Target position Y */
  targetY: Types.f32,
  /** Target position Z */
  targetZ: Types.f32,

  /** Planet entity being landed on / launched from */
  planetEid: Types.i32,

  /** Player health to preserve */
  preservedHealth: Types.f32,

  /** Player shields to preserve */
  preservedShields: Types.f32
});

/** Transition type constants */
export const TRANSITION_TYPE = {
  NONE: 0,
  LANDING: 1,
  LAUNCHING: 2
} as const;
