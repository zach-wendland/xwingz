import { defineComponent, Types } from "bitecs";

// ─────────────────────────────────────────────────────────────────────────────
// GROUND DOMAIN COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tags an entity as existing in ground-physics space.
 * Mutually exclusive with space domain (Ship + PlayerControlled) during gameplay.
 */
export const InGroundDomain = defineComponent();

/**
 * Kinematic character controller state for Rapier.
 * The actual Rapier objects are stored in PhysicsWorld maps keyed by eid.
 */
export const CharacterController = defineComponent({
  rapierHandle: Types.ui32,   // RigidBody handle for lookups
  capsuleHeight: Types.f32,   // 1.8m default (Stormtrooper height)
  capsuleRadius: Types.f32,   // 0.35m
  grounded: Types.ui8,        // 0 or 1
  stepHeight: Types.f32,      // max step-up (0.35m)
  slopeLimit: Types.f32       // max walkable slope in radians
});

/**
 * Ground movement intent (from player input or AI).
 */
export const GroundInput = defineComponent({
  moveX: Types.f32,      // -1..1 strafe (A/D)
  moveZ: Types.f32,      // -1..1 forward/back (W/S)
  jump: Types.ui8,       // 0 or 1 (consumed each frame)
  sprint: Types.ui8,     // 0 or 1 (Shift held)
  crouch: Types.ui8,     // 0 or 1 (Ctrl held)
  aimYaw: Types.f32,     // radians (mouse X accumulator)
  aimPitch: Types.f32,   // radians (clamped -80° to +80°)
  interact: Types.ui8,   // 0 or 1 (E key, consumed each frame)
  firePrimary: Types.ui8 // 0 or 1 (mouse left / space)
});

/**
 * Infantry soldier stats.
 */
export const Soldier = defineComponent({
  classId: Types.ui8,        // 0=Assault, 1=Heavy, 2=Sniper
  walkSpeed: Types.f32,      // 4.5 m/s default
  sprintSpeed: Types.f32,    // 7.0 m/s
  crouchSpeed: Types.f32,    // 2.0 m/s
  jumpImpulse: Types.f32,    // ~5.0 m/s upward
  ammo: Types.ui16,
  maxAmmo: Types.ui16
});

/**
 * Links a character entity to a vehicle/ship entity they are piloting.
 * When vehicleEid >= 0, the character's ground movement is disabled.
 */
export const Piloting = defineComponent({
  vehicleEid: Types.i32      // -1 when on foot
});

/**
 * Marks an entity as enterable (ship, turret, speeder, etc).
 */
export const Enterable = defineComponent({
  seatCount: Types.ui8,
  seatsFilled: Types.ui8,
  enterRadius: Types.f32     // proximity required to enter (default 4m)
});

// ─────────────────────────────────────────────────────────────────────────────
// BLASTER WEAPON (hitscan, distinct from slow space projectiles)
// ─────────────────────────────────────────────────────────────────────────────

export const BlasterWeapon = defineComponent({
  damage: Types.f32,
  fireRate: Types.f32,           // shots per second
  cooldownRemaining: Types.f32,
  range: Types.f32,              // hitscan range (150m typical)
  spread: Types.f32              // radians of cone spread
});

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND POST (Battlefront objective)
// ─────────────────────────────────────────────────────────────────────────────

export const CommandPost = defineComponent({
  ownerTeam: Types.i32,        // -1 = neutral, 0 = friendly, 1 = enemy
  captureProgress: Types.f32,  // 0..1 (1 = fully captured by contestingTeam)
  captureRadius: Types.f32,    // units within this radius can capture
  captureRate: Types.f32,      // progress per second per unit advantage
  contestingTeam: Types.i32    // team currently pushing capture (-1 if tied)
});

// ─────────────────────────────────────────────────────────────────────────────
// AI GROUND BRAIN (for bot infantry)
// ─────────────────────────────────────────────────────────────────────────────

export const GroundAI = defineComponent({
  state: Types.ui8,            // 0=Idle, 1=MoveTo, 2=Attack, 3=Capture, 4=Flee
  stateTime: Types.f32,        // seconds in current state
  targetEid: Types.i32,        // -1 when none
  waypointX: Types.f32,        // current nav target
  waypointY: Types.f32,
  waypointZ: Types.f32,
  aggression: Types.f32,       // 0..1
  accuracy: Types.f32          // 0..1 (affects spread multiplier)
});
