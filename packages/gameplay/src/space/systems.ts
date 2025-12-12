import { IWorld, addEntity, addComponent, defineQuery } from "bitecs";
import { Euler, Quaternion, Vector3 } from "three";
import { AngularVelocity, PlayerControlled, Ship, Transform, Velocity } from "./components";
import type { SpaceInputState } from "./input";

export function spawnPlayerShip(world: IWorld, params?: Partial<{ maxSpeed: number; accel: number; turnRate: number }>) {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Ship, eid);
  addComponent(world, PlayerControlled, eid);

  Transform.x[eid] = 0;
  Transform.y[eid] = 0;
  Transform.z[eid] = 0;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  AngularVelocity.wx[eid] = 0;
  AngularVelocity.wy[eid] = 0;
  AngularVelocity.wz[eid] = 0;

  Ship.throttle[eid] = 0.2;
  Ship.maxSpeed[eid] = params?.maxSpeed ?? 250;
  Ship.accel[eid] = params?.accel ?? 120;
  Ship.turnRate[eid] = params?.turnRate ?? 1.2;

  return eid;
}

const shipQuery = defineQuery([Ship, Transform, Velocity, AngularVelocity]);
const playerQuery = defineQuery([Ship, PlayerControlled]);

const tmpQ = new Quaternion();
const tmpEuler = new Euler();
const tmpForward = new Vector3();
const tmpVel = new Vector3();

export function spaceflightSystem(world: IWorld, input: SpaceInputState, dt: number) {
  const ships = shipQuery(world);
  const players = playerQuery(world);

  for (const eid of ships) {
    const isPlayer = players.includes(eid);

    // Input to angular velocity / throttle.
    if (isPlayer) {
      const throttle0 = Ship.throttle[eid] ?? 0;
      Ship.throttle[eid] = clamp01(throttle0 + input.throttleDelta * dt * 0.4);

      const turnRate = Ship.turnRate[eid] ?? 1.2;
      AngularVelocity.wx[eid] = input.pitch * turnRate;
      AngularVelocity.wy[eid] = input.yaw * turnRate;
      AngularVelocity.wz[eid] = input.roll * turnRate;
    }

    // Orientation integration.
    tmpQ.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
    tmpEuler.set(
      (AngularVelocity.wx[eid] ?? 0) * dt,
      (AngularVelocity.wy[eid] ?? 0) * dt,
      (AngularVelocity.wz[eid] ?? 0) * dt,
      "XYZ"
    );
    const dq = new Quaternion().setFromEuler(tmpEuler);
    tmpQ.multiply(dq).normalize();
    Transform.qx[eid] = tmpQ.x;
    Transform.qy[eid] = tmpQ.y;
    Transform.qz[eid] = tmpQ.z;
    Transform.qw[eid] = tmpQ.w;

    // Linear velocity integration.
    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();
    tmpVel.set(Velocity.vx[eid] ?? 0, Velocity.vy[eid] ?? 0, Velocity.vz[eid] ?? 0);

    const maxSpeed0 = Ship.maxSpeed[eid] ?? 250;
    const accel0 = Ship.accel[eid] ?? 120;
    const maxSpeed = maxSpeed0 * (isPlayer && input.boost ? 1.7 : 1);
    const accel = accel0 * (isPlayer && input.boost ? 2.0 : 1);
    tmpVel.addScaledVector(tmpForward, accel * dt);

    if (isPlayer && input.brake) {
      tmpVel.multiplyScalar(Math.max(0, 1 - dt * 3.5));
    }

    // Soft cap speed.
    const speed = tmpVel.length();
    if (speed > maxSpeed) tmpVel.multiplyScalar(maxSpeed / speed);

    // Drift damping to keep it controllable in v1.
    tmpVel.multiplyScalar(Math.max(0, 1 - dt * 0.05));

    Velocity.vx[eid] = tmpVel.x;
    Velocity.vy[eid] = tmpVel.y;
    Velocity.vz[eid] = tmpVel.z;

    // Position integration.
    Transform.x[eid] = (Transform.x[eid] ?? 0) + (Velocity.vx[eid] ?? 0) * dt;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + (Velocity.vy[eid] ?? 0) * dt;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + (Velocity.vz[eid] ?? 0) * dt;
  }
}

export function getPlayerShip(world: IWorld): number | null {
  const players = playerQuery(world);
  return players[0] ?? null;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
