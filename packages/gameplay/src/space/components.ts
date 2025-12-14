import { defineComponent, Types } from "bitecs";

export const Transform = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
  qx: Types.f32,
  qy: Types.f32,
  qz: Types.f32,
  qw: Types.f32
});

export const Velocity = defineComponent({
  vx: Types.f32,
  vy: Types.f32,
  vz: Types.f32
});

export const AngularVelocity = defineComponent({
  wx: Types.f32,
  wy: Types.f32,
  wz: Types.f32
});

export const Team = defineComponent({
  id: Types.i32 // 0 = friendly, 1 = enemy (v0)
});

export const Ship = defineComponent({
  throttle: Types.f32,   // 0..1
  maxSpeed: Types.f32,   // units/sec
  accel: Types.f32,      // units/sec^2
  turnRate: Types.f32    // rad/sec
});

// Simple laser weapon mounted on a ship.
export const LaserWeapon = defineComponent({
  cooldown: Types.f32,           // seconds between shots
  cooldownRemaining: Types.f32,  // seconds until next shot
  projectileSpeed: Types.f32,    // units/sec
  damage: Types.f32              // per hit
});

// Projectile entity.
export const Projectile = defineComponent({
  life: Types.f32,   // seconds remaining
  owner: Types.i32,  // eid of firing ship
  damage: Types.f32
});

export const Health = defineComponent({
  hp: Types.f32,
  maxHp: Types.f32
});

export const HitRadius = defineComponent({
  r: Types.f32
});

export const AIControlled = defineComponent();

// Simple dogfight brain for AI fighters.
export const FighterBrain = defineComponent({
  state: Types.i32,       // enum
  stateTime: Types.f32,   // seconds in current state
  aggression: Types.f32,  // 0..1
  evadeBias: Types.f32,   // 0..1
  targetEid: Types.i32    // -1 when none
});

export const Shield = defineComponent({
  sp: Types.f32,
  maxSp: Types.f32,
  regenRate: Types.f32,   // sp/sec
  lastHit: Types.f32      // seconds since last hit
});

// Marks an entity as targetable by players/AI.
export const Targetable = defineComponent();

// Player/AI targeting state.
export const Targeting = defineComponent({
  targetEid: Types.i32 // -1 when none
});

export const PlayerControlled = defineComponent();

// Proton Torpedo Launcher - secondary weapon with lock-on
export const TorpedoLauncher = defineComponent({
  ammo: Types.ui8,             // 4-6 typical for X-Wing
  maxAmmo: Types.ui8,
  lockProgress: Types.f32,     // 0..1 (1 = locked)
  lockTime: Types.f32,         // seconds to achieve lock (2.0)
  lockTargetEid: Types.i32,    // -1 when no lock attempt
  cooldown: Types.f32,         // seconds between shots
  cooldownRemaining: Types.f32,
  damage: Types.f32,           // 150-200 (vs laser's 10)
  projectileSpeed: Types.f32,  // slower than lasers (400-500)
  trackingStrength: Types.f32  // 0..1 homing capability
});

// Tracking proton torpedo projectile
export const TorpedoProjectile = defineComponent({
  life: Types.f32,
  owner: Types.i32,
  damage: Types.f32,
  targetEid: Types.i32,        // locked target for tracking
  trackingStrength: Types.f32
});

// Weapon switching - 0=lasers, 1=torpedoes
export const WeaponLoadout = defineComponent({
  activeWeapon: Types.ui8      // 0=primary (lasers), 1=secondary (torpedoes)
});
