/**
 * Hoth-specific ECS components
 *
 * Isolated from main components.ts to avoid bloat.
 * These components are only used in the Battle of Hoth mission.
 */

import { defineComponent, Types } from "bitecs";

// ─────────────────────────────────────────────────────────────────────────────
// AT-AT WALKER (boss enemy - not player driveable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AT-AT Walker state machine.
 *
 * Specs (from lore):
 * - Height: 22.5m
 * - Speed: ~60 km/h (16.7 m/s), reduced to 8 m/s for gameplay
 * - Crew: 5 (commander, driver, 2 gunners, deck officer) + 40 troops
 * - Armor: Impervious to blasters, vulnerable to tow cables and concentrated fire on neck
 */
export const ATATWalker = defineComponent({
  // Health zones
  headHealth: Types.f32,         // Cockpit - vulnerable when tripped
  bodyHealth: Types.f32,         // Main transport section
  legHealthLeft: Types.f32,      // Left legs combined
  legHealthRight: Types.f32,     // Right legs combined

  // Tow cable state
  cableWraps: Types.ui8,         // 0-3, AT-AT trips at 3 wraps
  cableAttached: Types.ui8,      // 1 if speeder has cable attached
  cableAttacherEid: Types.i32,   // Entity ID of the attached snowspeeder

  // State machine
  state: Types.ui8,              // 0=Advancing, 1=Firing, 2=Stumbling, 3=Falling, 4=Down, 5=Destroyed
  stateTimer: Types.f32,         // Time in current state

  // Movement
  walkSpeed: Types.f32,          // m/s (8.0 default, much slower than lore for gameplay)
  targetX: Types.f32,            // Target position (usually shield generator)
  targetZ: Types.f32,

  // Weapons
  chinLaserCooldown: Types.f32,  // Heavy laser cannons (high damage, slow)
  templeLaserCooldown: Types.f32, // Medium blasters (lower damage, faster)
  chinLaserDamage: Types.f32,    // Damage per chin laser shot
  templeLaserDamage: Types.f32,  // Damage per temple blaster shot

  // Animation
  legPhase: Types.f32,           // For leg animation (0..2PI)
  headYaw: Types.f32,            // Head rotation for aiming
  headPitch: Types.f32
});

// AT-AT state enum values
export const ATAT_STATE = {
  ADVANCING: 0,    // Walking toward target
  FIRING: 1,       // Stopped to fire at high-value target
  STUMBLING: 2,    // Hit by speeder, momentarily unsteady
  FALLING: 3,      // Tow cable tripped, falling animation
  DOWN: 4,         // On the ground, vulnerable to finishing strikes
  DESTROYED: 5     // Exploding/dead
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TURRET EMPLACEMENT (E-Web, DF.9, v-150)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stationary turret that can be manned by infantry.
 *
 * Types:
 * - E-Web: Heavy repeating blaster (anti-infantry)
 * - DF.9: Anti-vehicle laser turret
 * - v-150: Ion cannon (scripted, not player-controllable)
 */
export const TurretEmplacement = defineComponent({
  type: Types.ui8,               // 0=E-Web, 1=DF.9, 2=IonCannon
  yaw: Types.f32,                // Current aim direction
  pitch: Types.f32,              // -45° to +45° typical
  yawMin: Types.f32,             // Turret traverse limits
  yawMax: Types.f32,
  pitchMin: Types.f32,
  pitchMax: Types.f32,

  // Stats
  damage: Types.f32,
  fireRate: Types.f32,           // Shots per second
  cooldown: Types.f32,           // Time until next shot
  range: Types.f32,              // Effective range
  spread: Types.f32,             // Accuracy spread

  // State
  manned: Types.ui8,             // 1 if someone is operating
  operatorEid: Types.i32,        // Entity ID of operator (-1 if unmanned)
  targetEid: Types.i32,          // Current target for AI turrets

  // Heat (for E-Web)
  heat: Types.f32,
  heatMax: Types.f32,
  heatPerShot: Types.f32,
  coolRate: Types.f32
});

// Turret type enum
export const TURRET_TYPE = {
  E_WEB: 0,        // Anti-infantry repeater
  DF_9: 1,         // Anti-vehicle
  ION_CANNON: 2    // Scripted orbital defense
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SNOWTROOPER (specialized Imperial infantry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Snowtrooper variant marker.
 * Snowtroopers have insulated armor and are more aggressive in cold environments.
 */
export const Snowtrooper = defineComponent({
  coldResistance: Types.f32,     // Environmental damage reduction (unused for now)
  squadId: Types.ui8,            // Which squad this trooper belongs to
  squadLeader: Types.ui8         // 1 if this is the squad leader
});

// ─────────────────────────────────────────────────────────────────────────────
// T-47 SNOWSPEEDER (player vehicle for tow cable runs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * T-47 Airspeeder (Snowspeeder) state.
 *
 * Specs (from lore):
 * - Speed: 1,100 km/h max, 600 km/h combat effective
 * - Crew: Pilot + Tailgunner
 * - Armament: 2x laser cannons (front), harpoon gun (rear)
 * - Special: Tow cable for AT-AT takedowns
 */
export const Snowspeeder = defineComponent({
  // Flight
  altitude: Types.f32,           // Current altitude above terrain
  maxAltitude: Types.f32,        // Max flight ceiling (50m for Hoth mission)
  speed: Types.f32,              // Current speed
  maxSpeed: Types.f32,           // 166 m/s (600 km/h)

  // Weapons
  laserCooldown: Types.f32,      // Front laser cannons
  laserDamage: Types.f32,

  // Tow cable state
  cableState: Types.ui8,         // 0=Ready, 1=Firing, 2=Attached, 3=Wrapping, 4=Released, 5=Broken
  cableTargetEid: Types.i32,     // AT-AT entity ID (-1 if none)
  cableLength: Types.f32,        // Current cable extension
  cableStrength: Types.f32,      // 0..100, breaks if speed too low while wrapping
  orbitAngle: Types.f32,         // Current angle around AT-AT during wrap

  // Crew
  pilotEid: Types.i32,           // Player or AI pilot
  gunnerEid: Types.i32           // Rear gunner (AI or second player)
});

// Tow cable state enum
export const CABLE_STATE = {
  READY: 0,      // Cable retracted, ready to fire
  FIRING: 1,     // Harpoon in flight toward target
  ATTACHED: 2,   // Harpoon hit, beginning orbit
  WRAPPING: 3,   // Actively circling AT-AT legs
  RELEASED: 4,   // Cable released after successful wrap
  BROKEN: 5      // Cable snapped (speed too low)
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SHIELD GENERATOR (mission objective)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shield generator - primary defense objective.
 * If destroyed, the ground phase ends and AT-ATs breach Echo Base.
 */
export const ShieldGenerator = defineComponent({
  health: Types.f32,
  maxHealth: Types.f32,
  shieldRadius: Types.f32,       // Protective coverage radius
  active: Types.ui8              // 1 if operational
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT (evacuation objective)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GR-75 Transport - evacuation objective.
 * Transports launch periodically; player must protect them until they escape.
 */
export const Transport = defineComponent({
  state: Types.ui8,              // 0=Boarding, 1=Launching, 2=Ascending, 3=Escaped, 4=Destroyed
  stateTimer: Types.f32,         // Time in current state
  boardingTime: Types.f32,       // Time needed to finish boarding
  escapeAltitude: Types.f32      // Altitude at which transport is "safe"
});

// Transport state enum
export const TRANSPORT_STATE = {
  BOARDING: 0,    // Loading passengers
  LAUNCHING: 1,   // Engines firing, lifting off
  ASCENDING: 2,   // Flying to escape altitude
  ESCAPED: 3,     // Successfully evacuated
  DESTROYED: 4    // Shot down
} as const;
