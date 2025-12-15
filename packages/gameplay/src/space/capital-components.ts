import { defineComponent, Types } from "bitecs";

// ─────────────────────────────────────────────────────────────────────────────
// CAPITAL SHIP ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const enum ShipClass {
  Corvette = 0,    // ~150m (CR90, Raider)
  Frigate = 1,     // ~300m (Nebulon-B, Arquitens)
  Cruiser = 2,     // ~900m (MC80, Victory SD)
  Destroyer = 3,   // ~1600m (ISD, Home One)
}

export const enum SubsystemType {
  Bridge = 0,       // Destruction = ship disabled
  ShieldGen = 1,    // Destruction = no shield regen
  Engines = 2,      // Destruction = immobile
  Targeting = 3,    // Destruction = turrets less accurate
  Power = 4,        // Destruction = reveals weak points
  Hangar = 5,       // Destruction = no fighter spawns
}

export const enum TurretType {
  PointDefense = 0, // Anti-fighter, high ROF, low damage
  Medium = 1,       // Dual/quad lasers, balanced
  Heavy = 2,        // Turbolaser batteries, slow, high damage
  Ion = 3,          // Disables shields/subsystems
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPITAL SHIP COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main capital ship component. Represents large warships like Star Destroyers.
 * Hull is segmented into fore/mid/aft sections for localized damage.
 * Shields are split into front/rear arcs.
 *
 * Note: Named CapitalShipV2 to avoid conflict with legacy coruscant-systems.ts
 */
export const CapitalShipV2 = defineComponent({
  shipClass: Types.ui8,        // ShipClass enum
  length: Types.f32,           // meters (for collision scaling)

  // Hull section health
  hullFore: Types.f32,
  hullMid: Types.f32,
  hullAft: Types.f32,
  hullForeMax: Types.f32,
  hullMidMax: Types.f32,
  hullAftMax: Types.f32,

  // Shield arcs (front/rear)
  shieldFront: Types.f32,
  shieldRear: Types.f32,
  shieldMax: Types.f32,
  shieldRegenRate: Types.f32,
  shieldRegenDelay: Types.f32, // seconds before regen starts
  shieldLastHit: Types.f32,    // time since last hit

  // Movement (capital ships are slower, momentum-based)
  throttle: Types.f32,         // 0..1
  maxSpeed: Types.f32,         // ~20-50 units/sec
  accel: Types.f32,            // ~5-10 units/sec^2
  turnRate: Types.f32,         // ~0.02-0.1 rad/sec

  // Hangar spawning
  hangarCapacity: Types.ui8,
  hangarCurrent: Types.ui8,
  spawnCooldown: Types.f32,
  spawnCooldownMax: Types.f32,
});

// ─────────────────────────────────────────────────────────────────────────────
// TURRET COMPONENT (child entity of capital ship)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turret mounted on a capital ship. Each turret is a separate entity
 * with parentEid linking to the capital ship.
 */
export const Turret = defineComponent({
  // Parent reference
  parentEid: Types.i32,        // capital ship eid (-1 if standalone)

  // Local offset from parent center
  offsetX: Types.f32,
  offsetY: Types.f32,
  offsetZ: Types.f32,

  // Turret characteristics
  turretType: Types.ui8,       // TurretType enum
  barrelCount: Types.ui8,      // 1-4 typically

  // Rotation state (local to parent)
  yaw: Types.f32,              // current local yaw
  pitch: Types.f32,            // current local pitch
  yawTarget: Types.f32,        // desired yaw
  pitchTarget: Types.f32,      // desired pitch

  // Rotation limits (relative to parent forward)
  yawMin: Types.f32,           // -PI to PI (-180 to 180 deg)
  yawMax: Types.f32,
  pitchMin: Types.f32,         // typically -10 to +60 deg
  pitchMax: Types.f32,
  rotationSpeed: Types.f32,    // rad/sec tracking speed

  // Firing state
  cooldown: Types.f32,
  cooldownRemaining: Types.f32,
  damage: Types.f32,
  range: Types.f32,            // effective range
  projectileSpeed: Types.f32,

  // AI targeting
  targetEid: Types.i32,        // -1 when no target
  targetPriority: Types.ui8,   // 0=any, 1=fighters, 2=bombers, 3=capitals
  trackingAccuracy: Types.f32, // 0..1 (affects aim scatter)

  // State flags
  disabled: Types.ui8,         // 1 if damaged/disabled
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBSYSTEM COMPONENT (child entity of capital ship)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Targetable subsystem on a capital ship (bridge, shield gen, engines, etc).
 * Destroying subsystems applies debuffs to the parent ship.
 */
export const Subsystem = defineComponent({
  parentEid: Types.i32,        // capital ship eid

  // Position offset (local to parent)
  offsetX: Types.f32,
  offsetY: Types.f32,
  offsetZ: Types.f32,
  hitRadius: Types.f32,        // collision sphere radius

  subsystemType: Types.ui8,    // SubsystemType enum

  // Health
  hp: Types.f32,
  maxHp: Types.f32,

  // State
  disabled: Types.ui8,         // 1 if HP <= 0
});

// ─────────────────────────────────────────────────────────────────────────────
// TURRET PROJECTILE (heavier than fighter lasers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projectile fired by capital ship turrets.
 * Visually larger and slower than fighter lasers.
 */
export const TurretProjectile = defineComponent({
  life: Types.f32,
  ownerEid: Types.i32,         // turret eid
  parentShipEid: Types.i32,    // capital ship eid (for team lookup)
  damage: Types.f32,
  turretType: Types.ui8,       // TurretType for visual/behavior
});

// ─────────────────────────────────────────────────────────────────────────────
// WEAK POINT (revealed after power system destroyed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weak point on capital ship hull. Revealed when power system is destroyed.
 * Taking damage at weak points deals bonus hull damage.
 *
 * Note: Named WeakPointV2 to avoid conflict with legacy coruscant-systems.ts
 */
export const WeakPointV2 = defineComponent({
  parentEid: Types.i32,
  offsetX: Types.f32,
  offsetY: Types.f32,
  offsetZ: Types.f32,
  hitRadius: Types.f32,
  damageMultiplier: Types.f32, // typically 2-3x
  revealed: Types.ui8,         // 1 if power system destroyed
});
