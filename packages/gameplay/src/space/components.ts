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

export const PlayerControlled = defineComponent();

