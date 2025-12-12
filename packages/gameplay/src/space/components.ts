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
