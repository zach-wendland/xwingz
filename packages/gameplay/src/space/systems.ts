import { IWorld, addEntity, addComponent, defineQuery, removeEntity } from "bitecs";
import { Euler, Quaternion, Vector3 } from "three";
import {
  AngularVelocity,
  Health,
  HitRadius,
  LaserWeapon,
  PlayerControlled,
  Projectile,
  Ship,
  Targetable,
  Targeting,
  Transform,
  Velocity
} from "./components";
import type { SpaceInputState } from "./input";

export function spawnPlayerShip(world: IWorld, params?: Partial<{ maxSpeed: number; accel: number; turnRate: number }>) {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Ship, eid);
  addComponent(world, LaserWeapon, eid);
  addComponent(world, Targeting, eid);
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

  LaserWeapon.cooldown[eid] = 0.12;
  LaserWeapon.cooldownRemaining[eid] = 0;
  LaserWeapon.projectileSpeed[eid] = 900;
  LaserWeapon.damage[eid] = 10;

  Targeting.targetEid[eid] = -1;

  return eid;
}

const shipQuery = defineQuery([Ship, Transform, Velocity, AngularVelocity]);
const playerQuery = defineQuery([Ship, PlayerControlled]);
const weaponQuery = defineQuery([Ship, LaserWeapon, Transform, Velocity]);
const projectileQuery = defineQuery([Projectile, Transform, Velocity]);
const targetableQuery = defineQuery([Targetable, Transform]);
const combatTargetQuery = defineQuery([Targetable, Health, HitRadius, Transform]);
const targetingQuery = defineQuery([Targeting, PlayerControlled, Transform]);

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

export function weaponSystem(world: IWorld, input: SpaceInputState, dt: number) {
  const ships = weaponQuery(world);
  const players = playerQuery(world);

  for (const eid of ships) {
    if (!players.includes(eid)) continue;

    const cd = LaserWeapon.cooldown[eid] ?? 0.12;
    const cdRem0 = LaserWeapon.cooldownRemaining[eid] ?? 0;
    const cdRem = Math.max(0, cdRem0 - dt);
    LaserWeapon.cooldownRemaining[eid] = cdRem;

    if (!input.firePrimary || cdRem > 0) continue;
    LaserWeapon.cooldownRemaining[eid] = cd;

    // Spawn a laser bolt projectile.
    const pid = addEntity(world);
    addComponent(world, Transform, pid);
    addComponent(world, Velocity, pid);
    addComponent(world, Projectile, pid);

    // Copy orientation.
    const qx = Transform.qx[eid] ?? 0;
    const qy = Transform.qy[eid] ?? 0;
    const qz = Transform.qz[eid] ?? 0;
    const qw = Transform.qw[eid] ?? 1;
    Transform.qx[pid] = qx;
    Transform.qy[pid] = qy;
    Transform.qz[pid] = qz;
    Transform.qw[pid] = qw;

    tmpQ.set(qx, qy, qz, qw);
    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();

    const offset = 3;
    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;
    Transform.x[pid] = sx + tmpForward.x * offset;
    Transform.y[pid] = sy + tmpForward.y * offset;
    Transform.z[pid] = sz + tmpForward.z * offset;

    const projSpeed = LaserWeapon.projectileSpeed[eid] ?? 900;
    const svx = Velocity.vx[eid] ?? 0;
    const svy = Velocity.vy[eid] ?? 0;
    const svz = Velocity.vz[eid] ?? 0;
    Velocity.vx[pid] = svx + tmpForward.x * projSpeed;
    Velocity.vy[pid] = svy + tmpForward.y * projSpeed;
    Velocity.vz[pid] = svz + tmpForward.z * projSpeed;

    Projectile.life[pid] = 2.5;
    Projectile.owner[pid] = eid;
    Projectile.damage[pid] = LaserWeapon.damage[eid] ?? 10;
  }
}

export function projectileSystem(world: IWorld, dt: number) {
  const ps = projectileQuery(world);
  const targets = combatTargetQuery(world);

  for (const eid of ps) {
    const life0 = Projectile.life[eid] ?? 0;
    const life = life0 - dt;
    Projectile.life[eid] = life;
    if (life <= 0) {
      removeEntity(world, eid);
      continue;
    }

    Transform.x[eid] = (Transform.x[eid] ?? 0) + (Velocity.vx[eid] ?? 0) * dt;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + (Velocity.vy[eid] ?? 0) * dt;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + (Velocity.vz[eid] ?? 0) * dt;

    // Naive collision against targetables (small counts in v1).
    const px = Transform.x[eid] ?? 0;
    const py = Transform.y[eid] ?? 0;
    const pz = Transform.z[eid] ?? 0;
    const owner = Projectile.owner[eid] ?? -1;
    const dmg = Projectile.damage[eid] ?? 0;

    for (const tid of targets) {
      if (tid === owner) continue;
      const dx = (Transform.x[tid] ?? 0) - px;
      const dy = (Transform.y[tid] ?? 0) - py;
      const dz = (Transform.z[tid] ?? 0) - pz;
      const r = HitRadius.r[tid] ?? 8;
      if (dx * dx + dy * dy + dz * dz <= r * r) {
        Health.hp[tid] = (Health.hp[tid] ?? 0) - dmg;
        removeEntity(world, eid);
        if ((Health.hp[tid] ?? 0) <= 0) {
          removeEntity(world, tid);
        }
        break;
      }
    }
  }
}

export function targetingSystem(world: IWorld, input: SpaceInputState) {
  if (!input.cycleTarget) return;

  const players = targetingQuery(world);
  if (players.length === 0) return;
  const pid = players[0];
  if (pid === undefined) return;

  const targets = targetableQuery(world);
  if (targets.length === 0) {
    Targeting.targetEid[pid] = -1;
    return;
  }

  const px = Transform.x[pid] ?? 0;
  const py = Transform.y[pid] ?? 0;
  const pz = Transform.z[pid] ?? 0;

  const sorted = targets
    .map((eid) => {
      const dx = (Transform.x[eid] ?? 0) - px;
      const dy = (Transform.y[eid] ?? 0) - py;
      const dz = (Transform.z[eid] ?? 0) - pz;
      return { eid, d2: dx * dx + dy * dy + dz * dz };
    })
    .sort((a, b) => a.d2 - b.d2)
    .map((t) => t.eid);

  const current = Targeting.targetEid[pid] ?? -1;
  const idx = sorted.indexOf(current);
  const next = idx >= 0 ? sorted[(idx + 1) % sorted.length]! : sorted[0]!;
  Targeting.targetEid[pid] = next;
}

export function getProjectiles(world: IWorld) {
  return projectileQuery(world);
}

export function getTargetables(world: IWorld) {
  return targetableQuery(world);
}

export function getPlayerShip(world: IWorld): number | null {
  const players = playerQuery(world);
  return players[0] ?? null;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
