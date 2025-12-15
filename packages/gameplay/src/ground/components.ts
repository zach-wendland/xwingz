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
  firePrimary: Types.ui8, // 0 or 1 (mouse left / space)
  dodge: Types.ui8,      // 0 or 1 (Alt key, consumed each frame)
  throwGrenade: Types.ui8 // 0 or 1 (G key, consumed each frame)
});

/**
 * Infantry soldier stats.
 */
export const Soldier = defineComponent({
  classId: Types.ui8,        // 0=Assault, 1=Heavy, 2=Sniper, 3=Officer
  walkSpeed: Types.f32,      // 4.5 m/s default
  sprintSpeed: Types.f32,    // 7.0 m/s
  crouchSpeed: Types.f32,    // 2.0 m/s
  jumpImpulse: Types.f32,    // ~5.0 m/s upward
  ammo: Types.ui16,
  maxAmmo: Types.ui16
});

// ─────────────────────────────────────────────────────────────────────────────
// STAMINA SYSTEM (for sprint and dodge roll)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stamina for sprint and dodge roll mechanics.
 * Drains while sprinting/dodging, regenerates when idle.
 */
export const Stamina = defineComponent({
  current: Types.f32,        // 0..max
  max: Types.f32,            // 100 default
  regenRate: Types.f32,      // per second when not sprinting (20/s default)
  regenDelay: Types.f32,     // seconds before regen starts (1.5s default)
  timeSinceDrain: Types.f32, // tracks time since last stamina use
  sprintDrainRate: Types.f32 // per second while sprinting (15/s default)
});

// ─────────────────────────────────────────────────────────────────────────────
// DODGE ROLL (Battlefront-style evasion with i-frames)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dodge roll state for evasive maneuvers.
 * Provides brief invincibility during roll animation.
 */
export const DodgeRoll = defineComponent({
  state: Types.ui8,          // 0=Ready, 1=Rolling, 2=Cooldown
  timer: Types.f32,          // time remaining in current state
  rollDuration: Types.f32,   // how long the roll lasts (0.5s default)
  cooldown: Types.f32,       // cooldown after roll (1.0s default)
  staminaCost: Types.f32,    // stamina required to roll (25 default)
  rollSpeed: Types.f32,      // movement speed during roll (8.0 m/s)
  directionX: Types.f32,     // roll direction (normalized)
  directionZ: Types.f32,
  iFrames: Types.ui8         // 1 if currently invincible, 0 otherwise
});

// ─────────────────────────────────────────────────────────────────────────────
// WEAPON HEAT (overheat mechanic for blasters)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weapon heat system for blasters (replaces traditional ammo).
 * Heat builds up when firing, cools down when not firing.
 * Overheat locks weapon until fully cooled.
 */
export const WeaponHeat = defineComponent({
  current: Types.f32,        // 0..100
  heatPerShot: Types.f32,    // heat added per shot (10 default)
  cooldownRate: Types.f32,   // heat lost per second (25 default)
  cooldownDelay: Types.f32,  // seconds before cooldown starts (0.3s)
  timeSinceShot: Types.f32,  // tracks time since last shot
  overheated: Types.ui8,     // 1 if locked from overheat
  overheatCoolRate: Types.f32 // faster cooldown during overheat (40 default)
});

// ─────────────────────────────────────────────────────────────────────────────
// GRENADE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grenade inventory and throw state.
 */
export const GrenadeInventory = defineComponent({
  count: Types.ui8,          // current grenades
  maxCount: Types.ui8,       // max grenades (3 default)
  type: Types.ui8,           // 0=Thermal, 1=Impact, 2=Smoke, 3=Ion
  cooldown: Types.f32,       // time until next throw allowed
  cooldownMax: Types.f32     // cooldown duration (5s default)
});

/**
 * Active grenade projectile in flight.
 */
export const Grenade = defineComponent({
  throwerEid: Types.i32,     // who threw it
  type: Types.ui8,           // grenade type
  fuseTime: Types.f32,       // time until detonation
  damage: Types.f32,         // damage at center
  blastRadius: Types.f32,    // radius of effect
  bounced: Types.ui8         // has it bounced? (for impact grenades)
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
  state: Types.ui8,            // 0=Idle, 1=MoveTo, 2=Attack, 3=Capture, 4=Flee, 5=Evade, 6=Strafe
  stateTime: Types.f32,        // seconds in current state
  targetEid: Types.i32,        // -1 when none
  waypointX: Types.f32,        // current nav target
  waypointY: Types.f32,
  waypointZ: Types.f32,
  aggression: Types.f32,       // 0..1
  accuracy: Types.f32,         // 0..1 (affects spread multiplier)
  strafeDir: Types.f32,        // -1 or 1 for strafe direction
  strafeTimer: Types.f32       // time until strafe direction change
});

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE REACTION (for reactive AI evasion)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks recent damage for AI reaction.
 * When hit, AI can trigger evasive maneuvers.
 */
export const DamageReaction = defineComponent({
  lastHitTime: Types.f32,      // time since last hit (seconds)
  hitCount: Types.ui8,         // hits in recent window
  evadeChance: Types.f32       // 0..1 chance to evade when hit
});

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL BLASTER BOLT (visible projectile instead of hitscan)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visible blaster bolt projectile.
 * Slower than hitscan, creates Star Wars-style blaster fire.
 */
export const BlasterBolt = defineComponent({
  ownerEid: Types.i32,         // who fired it
  ownerTeam: Types.i32,        // team ID for hit detection
  damage: Types.f32,           // damage on hit
  speed: Types.f32,            // m/s (150-200)
  life: Types.f32,             // seconds remaining
  maxLife: Types.f32           // for fade calculations
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUND VEHICLE (speeder bikes, AT-ST)
// ─────────────────────────────────────────────────────────────────────────────

export const enum GroundVehicleType {
  SpeederBike = 0,
  ATST = 1
}

/**
 * Ground vehicle stats and state.
 */
export const GroundVehicle = defineComponent({
  type: Types.ui8,             // GroundVehicleType
  maxSpeed: Types.f32,         // m/s
  acceleration: Types.f32,     // m/s²
  turnRate: Types.f32,         // rad/s
  weaponCooldown: Types.f32,   // time until next shot
  weaponCooldownMax: Types.f32 // cooldown duration
});
