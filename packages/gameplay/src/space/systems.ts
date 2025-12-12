import { IWorld, addEntity, addComponent, defineQuery, removeEntity } from "bitecs";
import { Euler, Quaternion, Vector3 } from "three";
import {
  AngularVelocity,
  AIControlled,
  FighterBrain,
  Health,
  HitRadius,
  LaserWeapon,
  PlayerControlled,
  Projectile,
  Ship,
  Shield,
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
  addComponent(world, Shield, eid);
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

  Shield.maxSp[eid] = 60;
  Shield.sp[eid] = 60;
  Shield.regenRate[eid] = 6;
  Shield.lastHit[eid] = 999;

  return eid;
}

const shipQuery = defineQuery([Ship, Transform, Velocity, AngularVelocity]);
const playerQuery = defineQuery([Ship, PlayerControlled]);
const weaponQuery = defineQuery([Ship, LaserWeapon, Transform, Velocity]);
const projectileQuery = defineQuery([Projectile, Transform, Velocity]);
const targetableQuery = defineQuery([Targetable, Transform]);
const combatTargetQuery = defineQuery([Targetable, Health, HitRadius, Transform]);
const targetingQuery = defineQuery([Targeting, PlayerControlled, Transform]);
const aiQuery = defineQuery([AIControlled, FighterBrain, Ship, LaserWeapon, Transform, Velocity, AngularVelocity]);

const tmpQ = new Quaternion();
const tmpEuler = new Euler();
const tmpForward = new Vector3();
const tmpVel = new Vector3();
const tmpInvQ = new Quaternion();
const tmpDesired = new Vector3();
const tmpLocal = new Vector3();
const tmpTargetVel = new Vector3();
const tmpSep = new Vector3();

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
    const throttle = clamp01(Ship.throttle[eid] ?? 1);
    const maxSpeed = maxSpeed0 * (isPlayer && input.boost ? 1.7 : 1);
    const accel = accel0 * throttle * (isPlayer && input.boost ? 2.0 : 1);
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

function fireLaser(world: IWorld, shooterEid: number) {
  const pid = addEntity(world);
  addComponent(world, Transform, pid);
  addComponent(world, Velocity, pid);
  addComponent(world, Projectile, pid);

  const qx = Transform.qx[shooterEid] ?? 0;
  const qy = Transform.qy[shooterEid] ?? 0;
  const qz = Transform.qz[shooterEid] ?? 0;
  const qw = Transform.qw[shooterEid] ?? 1;
  Transform.qx[pid] = qx;
  Transform.qy[pid] = qy;
  Transform.qz[pid] = qz;
  Transform.qw[pid] = qw;

  tmpQ.set(qx, qy, qz, qw);
  tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();

  const offset = 3;
  const sx = Transform.x[shooterEid] ?? 0;
  const sy = Transform.y[shooterEid] ?? 0;
  const sz = Transform.z[shooterEid] ?? 0;
  Transform.x[pid] = sx + tmpForward.x * offset;
  Transform.y[pid] = sy + tmpForward.y * offset;
  Transform.z[pid] = sz + tmpForward.z * offset;

  const projSpeed = LaserWeapon.projectileSpeed[shooterEid] ?? 900;
  const svx = Velocity.vx[shooterEid] ?? 0;
  const svy = Velocity.vy[shooterEid] ?? 0;
  const svz = Velocity.vz[shooterEid] ?? 0;
  Velocity.vx[pid] = svx + tmpForward.x * projSpeed;
  Velocity.vy[pid] = svy + tmpForward.y * projSpeed;
  Velocity.vz[pid] = svz + tmpForward.z * projSpeed;

  Projectile.life[pid] = 2.5;
  Projectile.owner[pid] = shooterEid;
  Projectile.damage[pid] = LaserWeapon.damage[shooterEid] ?? 10;
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

    fireLaser(world, eid);
  }
}

export function aiWeaponSystem(world: IWorld, dt: number) {
  const ais = aiQuery(world);
  const players = playerQuery(world);
  const player = players[0];
  if (player === undefined) return;

  const px = Transform.x[player] ?? 0;
  const py = Transform.y[player] ?? 0;
  const pz = Transform.z[player] ?? 0;

  for (const eid of ais) {
    const cd = LaserWeapon.cooldown[eid] ?? 0.14;
    const cdRem0 = LaserWeapon.cooldownRemaining[eid] ?? 0;
    const cdRem = Math.max(0, cdRem0 - dt);
    LaserWeapon.cooldownRemaining[eid] = cdRem;
    if (cdRem > 0) continue;

    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;

    const dx = px - sx;
    const dy = py - sy;
    const dz = pz - sz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 > 900 * 900) continue;

    // Fire if player is roughly in front cone.
    tmpQ.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();
    tmpDesired.set(dx, dy, dz).normalize();
    const dot = tmpForward.dot(tmpDesired);
    if (dot < 0.9) continue;

    LaserWeapon.cooldownRemaining[eid] = cd;
    fireLaser(world, eid);
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
        const shieldSp = Shield.sp[tid];
        if (shieldSp !== undefined && Shield.maxSp[tid] !== undefined) {
          const spLeft = shieldSp - dmg;
          Shield.sp[tid] = Math.max(0, spLeft);
          Shield.lastHit[tid] = 0;
          if (spLeft < 0) {
            Health.hp[tid] = (Health.hp[tid] ?? 0) + spLeft;
          }
        } else {
          Health.hp[tid] = (Health.hp[tid] ?? 0) - dmg;
        }
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

export enum AIState {
  Acquire = 0,
  Pursue = 1,
  Attack = 2,
  BreakOff = 3,
  Evade = 4
}

export function dogfightAISystem(world: IWorld, dt: number) {
  const ais = aiQuery(world);
  const players = playerQuery(world);
  const player = players[0];
  if (player === undefined) return;

  const px = Transform.x[player] ?? 0;
  const py = Transform.y[player] ?? 0;
  const pz = Transform.z[player] ?? 0;

  const pvx = Velocity.vx[player] ?? 0;
  const pvy = Velocity.vy[player] ?? 0;
  const pvz = Velocity.vz[player] ?? 0;
  tmpTargetVel.set(pvx, pvy, pvz);

  for (const eid of ais) {
    let state = FighterBrain.state[eid] ?? AIState.Acquire;
    let stateTime = (FighterBrain.stateTime[eid] ?? 0) + dt;

    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;

    const dx = px - sx;
    const dy = py - sy;
    const dz = pz - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const aggression = FighterBrain.aggression[eid] ?? 0.6;
    const evadeBias = FighterBrain.evadeBias[eid] ?? 0.5;

    const attackStartDist = lerp(620, 820, aggression);
    const breakOffDist = lerp(220, 140, aggression);
    const maxAttackTime = lerp(4.5, 7.5, aggression);
    const breakOffDuration = lerp(1.8, 1.1, aggression);
    const evadeDuration = lerp(0.8, 1.8, evadeBias);

    // transition helpers
    const forwardConeDot = lerp(0.95, 0.9, aggression);

    if (state === AIState.Acquire) {
      FighterBrain.targetEid[eid] = player;
      state = AIState.Pursue;
      stateTime = 0;
    }

    const lastHit = Shield.lastHit[eid];
    if (lastHit !== undefined) {
      Shield.lastHit[eid] = lastHit + dt;
      const evadeTriggerWindow = 0.5 + evadeBias * 0.8;
      if (lastHit < evadeTriggerWindow && state !== AIState.Evade) {
        state = AIState.Evade;
        stateTime = 0;
      }
    }

    if (state === AIState.Pursue) {
      if (dist < attackStartDist) {
        state = AIState.Attack;
        stateTime = 0;
      }
    } else if (state === AIState.Attack) {
      if (dist < breakOffDist) {
        state = AIState.BreakOff;
        stateTime = 0;
      }
      if (stateTime > maxAttackTime) {
        state = AIState.BreakOff;
        stateTime = 0;
      }
    } else if (state === AIState.BreakOff) {
      if (stateTime > breakOffDuration) {
        state = AIState.Pursue;
        stateTime = 0;
      }
    } else if (state === AIState.Evade) {
      if (stateTime > evadeDuration) {
        state = AIState.Pursue;
        stateTime = 0;
      }
    }

    FighterBrain.state[eid] = state;
    FighterBrain.stateTime[eid] = stateTime;

    // Desired vector depending on state.
    let desiredWorld: Vector3;
    if (state === AIState.BreakOff) {
      desiredWorld = tmpDesired.set(-dx, -dy * 0.3, -dz).normalize();
    } else if (state === AIState.Evade) {
      const wobbleAmp = 0.4 + evadeBias * 0.9;
      const wobble = Math.sin((stateTime + eid * 0.13) * 6) * wobbleAmp;
      desiredWorld = tmpDesired.set(dx + dy * wobble, dy + dz * wobble, dz - dx * wobble).normalize();
    } else {
      // Lead intercept aim.
      const projSpeed = LaserWeapon.projectileSpeed[eid] ?? 900;
      const svx = Velocity.vx[eid] ?? 0;
      const svy = Velocity.vy[eid] ?? 0;
      const svz = Velocity.vz[eid] ?? 0;
      const rvx = pvx - svx;
      const rvy = pvy - svy;
      const rvz = pvz - svz;
      const leadTime =
        computeInterceptTime(dx, dy, dz, rvx, rvy, rvz, projSpeed) ??
        dist / projSpeed;
      desiredWorld = tmpDesired
        .set(dx + rvx * leadTime, dy + rvy * leadTime, dz + rvz * leadTime)
        .normalize();
    }

    // Separation from nearby AI to reduce clustering.
    const sepRadius = 90;
    const sepRadius2 = sepRadius * sepRadius;
    let sepX = 0, sepY = 0, sepZ = 0;
    for (const other of ais) {
      if (other === eid) continue;
      const ox = Transform.x[other] ?? 0;
      const oy = Transform.y[other] ?? 0;
      const oz = Transform.z[other] ?? 0;
      const rx = sx - ox;
      const ry = sy - oy;
      const rz = sz - oz;
      const d2 = rx * rx + ry * ry + rz * rz;
      if (d2 < 1e-3 || d2 > sepRadius2) continue;
      const invD = 1 / Math.sqrt(d2);
      const strength = (sepRadius * invD - 1);
      sepX += rx * strength;
      sepY += ry * strength;
      sepZ += rz * strength;
    }
    if (sepX * sepX + sepY * sepY + sepZ * sepZ > 1e-4) {
      tmpSep.set(sepX, sepY, sepZ).normalize();
      const sepWeight = 0.35 + (1 - aggression) * 0.35;
      desiredWorld.addScaledVector(tmpSep, sepWeight).normalize();
    }

    tmpQ.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
    tmpInvQ.copy(tmpQ).invert();
    tmpLocal.copy(desiredWorld).applyQuaternion(tmpInvQ);

    const yawErr = Math.atan2(tmpLocal.x, -tmpLocal.z);
    const pitchErr = Math.atan2(tmpLocal.y, -tmpLocal.z);

    const turnRate = Ship.turnRate[eid] ?? 1.2;
    const gain = lerp(1.1, 1.7, aggression);
    const damp = 0.35;
    const yawCmd = clamp(yawErr * gain - (AngularVelocity.wy[eid] ?? 0) / turnRate * damp, -1, 1);
    const pitchCmd = clamp(pitchErr * gain - (AngularVelocity.wx[eid] ?? 0) / turnRate * damp, -1, 1);
    const rollCmd = state === AIState.Evade ? clamp(-yawCmd * (0.6 + evadeBias * 0.5), -1, 1) : 0;

    AngularVelocity.wx[eid] = pitchCmd * turnRate;
    AngularVelocity.wy[eid] = yawCmd * turnRate;
    AngularVelocity.wz[eid] = rollCmd * turnRate;

    // Throttle based on distance/state.
    const throttle0 = Ship.throttle[eid] ?? 0.6;
    const desiredThrottle =
      state === AIState.Attack ? 0.85 :
      state === AIState.BreakOff ? 1.0 :
      dist > 1200 ? 1.0 : 0.7;
    Ship.throttle[eid] = throttle0 + (desiredThrottle - throttle0) * clamp(dt * 2.5, 0, 1);

    // Optional: if close and in front, push into Attack.
    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();
    const dot = tmpForward.dot(tmpDesired.set(dx, dy, dz).normalize());
    if (state === AIState.Pursue && dot > forwardConeDot && dist < 850) {
      FighterBrain.state[eid] = AIState.Attack;
      FighterBrain.stateTime[eid] = 0;
    }
  }
}

export function shieldRegenSystem(world: IWorld, dt: number) {
  const ships = defineQuery([Shield, Health])(world);
  for (const eid of ships) {
    const maxSp = Shield.maxSp[eid] ?? 0;
    if (maxSp <= 0) continue;
    const lastHit = Shield.lastHit[eid] ?? 999;
    Shield.lastHit[eid] = lastHit + dt;
    if (lastHit < 2) continue;
    const sp = Shield.sp[eid] ?? 0;
    const regen = Shield.regenRate[eid] ?? 0;
    Shield.sp[eid] = Math.min(maxSp, sp + regen * dt);
  }
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

export function computeInterceptTime(
  dx: number,
  dy: number,
  dz: number,
  dvx: number,
  dvy: number,
  dvz: number,
  projectileSpeed: number
): number | null {
  if (!Number.isFinite(projectileSpeed) || projectileSpeed <= 1e-3) return null;

  const a = dvx * dvx + dvy * dvy + dvz * dvz - projectileSpeed * projectileSpeed;
  const b = 2 * (dx * dvx + dy * dvy + dz * dvz);
  const c = dx * dx + dy * dy + dz * dz;

  // Handle near-linear case when relative speed ~= projectile speed.
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return null;
    const t = -c / b;
    return t > 0 ? t : null;
  }

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const invDen = 1 / (2 * a);
  const t1 = (-b - sqrtDisc) * invDen;
  const t2 = (-b + sqrtDisc) * invDen;

  let t = Number.POSITIVE_INFINITY;
  if (t1 > 0 && t1 < t) t = t1;
  if (t2 > 0 && t2 < t) t = t2;
  return t !== Number.POSITIVE_INFINITY ? t : null;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
