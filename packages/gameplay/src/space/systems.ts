import { IWorld, addEntity, addComponent, defineQuery, removeEntity, hasComponent } from "bitecs";
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
  Team,
  Targetable,
  Targeting,
  Transform,
  Velocity,
  TorpedoLauncher,
  TorpedoProjectile,
  WeaponLoadout
} from "./components";
import type { SpaceInputState } from "./input";
import { SpatialHash } from "@xwingz/physics";

export type ImpactEvent = {
  x: number;
  y: number;
  z: number;
  team: number; // team of shooter, -1 unknown
  killed: 0 | 1;
};

const impactEvents: ImpactEvent[] = [];

export function consumeImpactEvents(): ImpactEvent[] {
  return impactEvents.splice(0, impactEvents.length);
}

export function spawnPlayerShip(world: IWorld, params?: Partial<{ maxSpeed: number; accel: number; turnRate: number; torpedoAmmo: number }>) {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Ship, eid);
  addComponent(world, LaserWeapon, eid);
  addComponent(world, TorpedoLauncher, eid);
  addComponent(world, WeaponLoadout, eid);
  addComponent(world, Targeting, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
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

  Team.id[eid] = 0;

  Ship.throttle[eid] = 0.6;
  Ship.maxSpeed[eid] = params?.maxSpeed ?? 250;
  Ship.accel[eid] = params?.accel ?? 120;
  Ship.turnRate[eid] = params?.turnRate ?? 1.2;

  LaserWeapon.cooldown[eid] = 0.12;
  LaserWeapon.cooldownRemaining[eid] = 0;
  LaserWeapon.projectileSpeed[eid] = 900;
  LaserWeapon.damage[eid] = 10;

  // Proton torpedo launcher - X-Wing carries 6 torpedoes
  TorpedoLauncher.ammo[eid] = params?.torpedoAmmo ?? 6;
  TorpedoLauncher.maxAmmo[eid] = params?.torpedoAmmo ?? 6;
  TorpedoLauncher.lockProgress[eid] = 0;
  TorpedoLauncher.lockTime[eid] = 2.0;  // 2 seconds to lock
  TorpedoLauncher.lockTargetEid[eid] = -1;
  TorpedoLauncher.cooldown[eid] = 1.5;  // 1.5 seconds between shots
  TorpedoLauncher.cooldownRemaining[eid] = 0;
  TorpedoLauncher.damage[eid] = 150;    // 15x laser damage
  TorpedoLauncher.projectileSpeed[eid] = 450;  // Slower than lasers
  TorpedoLauncher.trackingStrength[eid] = 0.85;

  WeaponLoadout.activeWeapon[eid] = 0;  // Start with lasers

  Targeting.targetEid[eid] = -1;

  Health.hp[eid] = 360;    // 3x for better survivability against turrets
  Health.maxHp[eid] = 360;
  HitRadius.r[eid] = 11;

  Shield.maxSp[eid] = 420;  // 7x for better survivability against turrets
  Shield.sp[eid] = 420;
  Shield.regenRate[eid] = 30;  // Increased regen to match higher shield pool
  Shield.lastHit[eid] = 999;

  return eid;
}

const shipQuery = defineQuery([Ship, Transform, Velocity, AngularVelocity]);
const playerQuery = defineQuery([Ship, PlayerControlled]);
const weaponQuery = defineQuery([Ship, LaserWeapon, Transform, Velocity]);
const projectileQuery = defineQuery([Projectile, Transform, Velocity]);
const targetableQuery = defineQuery([Targetable, Transform, Team]);
const combatTargetQuery = defineQuery([Health, HitRadius, Transform]);
const targetingQuery = defineQuery([Targeting, PlayerControlled, Transform, Team]);
const aiQuery = defineQuery([AIControlled, FighterBrain, Ship, LaserWeapon, Transform, Velocity, AngularVelocity, Team]);
const combatantQuery = defineQuery([Health, Transform, Team]);

// Spatial hash for efficient collision queries (O(n) instead of O(n*m))
// Cell size 100 balances distribution for typical engagement ranges
const targetSpatialHash = new SpatialHash(100);

/**
 * Rebuild the spatial hash with current target positions.
 * Call once per frame BEFORE projectileSystem/torpedoProjectileSystem.
 */
export function rebuildTargetSpatialHash(world: IWorld): void {
  targetSpatialHash.clear();
  const targets = combatTargetQuery(world);
  for (const tid of targets) {
    const x = Transform.x[tid] ?? 0;
    const y = Transform.y[tid] ?? 0;
    const z = Transform.z[tid] ?? 0;
    targetSpatialHash.insert(tid, x, y, z);
  }
}

const tmpQ = new Quaternion();
const tmpEuler = new Euler();
const tmpDq = new Quaternion();
const tmpForward = new Vector3();
const tmpVel = new Vector3();
const tmpInvQ = new Quaternion();
const tmpDesired = new Vector3();
const tmpLocal = new Vector3();
const tmpTargetVel = new Vector3();
const tmpSep = new Vector3();
const tmpLateral = new Vector3();
const tmpShotDir = new Vector3();
const tmpShotQ = new Quaternion();
const tmpMount = new Vector3();
const tmpMountWorld = new Vector3();
const baseForward = new Vector3(0, 0, -1);

const XWING_MOUNTS: Array<[number, number, number]> = [
  [-6.2, 3.5, -6.0],
  [6.2, 3.5, -6.0],
  [-6.2, -3.5, -6.0],
  [6.2, -3.5, -6.0]
];
const TIE_MOUNTS: Array<[number, number, number]> = [
  [-0.65, 0.0, -1.35],
  [0.65, 0.0, -1.35]
];

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
    tmpDq.setFromEuler(tmpEuler);
    tmpQ.multiply(tmpDq).normalize();
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
    const boostScalar = isPlayer && input.boost ? 1.7 : 1;

    // Throttle drives target speed (arcade dogfight feel).
    let desiredSpeed = maxSpeed0 * throttle * boostScalar;
    if (isPlayer && input.brake) desiredSpeed = 0;

    const accelLimit = accel0 * (isPlayer && input.boost ? 2.0 : 1) * dt;
    const decelLimit = accel0 * (isPlayer && input.brake ? 3.5 : 2.0) * dt;

    const forwardSpeed0 = tmpVel.dot(tmpForward);
    const delta = desiredSpeed - forwardSpeed0;
    const forwardSpeed =
      delta >= 0 ? forwardSpeed0 + clamp(delta, 0, accelLimit) : forwardSpeed0 + clamp(delta, -decelLimit, 0);

    // Damp lateral drift moderately for arcade feel with some drift.
    tmpDesired.copy(tmpForward).multiplyScalar(forwardSpeed0);
    tmpLateral.copy(tmpVel).sub(tmpDesired);
    const lateralDamp = isPlayer && input.brake ? 5.0 : 1.3;
    tmpLateral.multiplyScalar(Math.max(0, 1 - dt * lateralDamp));

    tmpVel.copy(tmpForward).multiplyScalar(forwardSpeed).add(tmpLateral);

    Velocity.vx[eid] = tmpVel.x;
    Velocity.vy[eid] = tmpVel.y;
    Velocity.vz[eid] = tmpVel.z;

    // Position integration.
    Transform.x[eid] = (Transform.x[eid] ?? 0) + (Velocity.vx[eid] ?? 0) * dt;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + (Velocity.vy[eid] ?? 0) * dt;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + (Velocity.vz[eid] ?? 0) * dt;
  }
}

function fireLaser(world: IWorld, shooterEid: number, targetEid: number) {
  const sx = Transform.x[shooterEid] ?? 0;
  const sy = Transform.y[shooterEid] ?? 0;
  const sz = Transform.z[shooterEid] ?? 0;

  const qx = Transform.qx[shooterEid] ?? 0;
  const qy = Transform.qy[shooterEid] ?? 0;
  const qz = Transform.qz[shooterEid] ?? 0;
  const qw = Transform.qw[shooterEid] ?? 1;
  tmpQ.set(qx, qy, qz, qw);
  tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();

  const myTeam = hasComponent(world, Team, shooterEid) ? (Team.id[shooterEid] ?? 0) : 0;
  let shotDir = tmpForward;

  // Mild aim assist toward lead point when a target is selected and roughly in front.
  if (targetEid >= 0 && hasComponent(world, Transform, targetEid) && hasComponent(world, Team, targetEid)) {
    const theirTeam = Team.id[targetEid] ?? -1;
    if (theirTeam !== myTeam) {
      const tx = Transform.x[targetEid] ?? 0;
      const ty = Transform.y[targetEid] ?? 0;
      const tz = Transform.z[targetEid] ?? 0;
      const dx = tx - sx;
      const dy = ty - sy;
      const dz = tz - sz;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const projSpeed = LaserWeapon.projectileSpeed[shooterEid] ?? 900;
      if (dist2 < 1400 * 1400 && projSpeed > 1e-3) {
        const tvx = hasComponent(world, Velocity, targetEid) ? (Velocity.vx[targetEid] ?? 0) : 0;
        const tvy = hasComponent(world, Velocity, targetEid) ? (Velocity.vy[targetEid] ?? 0) : 0;
        const tvz = hasComponent(world, Velocity, targetEid) ? (Velocity.vz[targetEid] ?? 0) : 0;
        const svx = Velocity.vx[shooterEid] ?? 0;
        const svy = Velocity.vy[shooterEid] ?? 0;
        const svz = Velocity.vz[shooterEid] ?? 0;
        const rvx = tvx - svx;
        const rvy = tvy - svy;
        const rvz = tvz - svz;
        const dist = Math.sqrt(dist2);
        const leadTime = computeInterceptTime(dx, dy, dz, rvx, rvy, rvz, projSpeed) ?? dist / projSpeed;
        tmpShotDir.set(dx + rvx * leadTime, dy + rvy * leadTime, dz + rvz * leadTime).normalize();

        const cone = hasComponent(world, PlayerControlled, shooterEid) ? 0.70 : 0.9;
        if (tmpForward.dot(tmpShotDir) >= cone) {
          shotDir = tmpShotDir;
        }
      }
    }
  }

  tmpShotQ.setFromUnitVectors(baseForward, shotDir);

  const mounts = myTeam === 0 ? XWING_MOUNTS : TIE_MOUNTS;
  const totalDamage = LaserWeapon.damage[shooterEid] ?? 10;
  const damagePer = totalDamage / mounts.length;
  const projSpeed = LaserWeapon.projectileSpeed[shooterEid] ?? 900;
  const svx = Velocity.vx[shooterEid] ?? 0;
  const svy = Velocity.vy[shooterEid] ?? 0;
  const svz = Velocity.vz[shooterEid] ?? 0;

  for (const [mx, my, mz] of mounts) {
    const pid = addEntity(world);
    addComponent(world, Transform, pid);
    addComponent(world, Velocity, pid);
    addComponent(world, Projectile, pid);

    Transform.qx[pid] = tmpShotQ.x;
    Transform.qy[pid] = tmpShotQ.y;
    Transform.qz[pid] = tmpShotQ.z;
    Transform.qw[pid] = tmpShotQ.w;

    tmpMount.set(mx, my, mz).applyQuaternion(tmpQ);
    tmpMountWorld.set(sx + tmpMount.x, sy + tmpMount.y, sz + tmpMount.z);

    Transform.x[pid] = tmpMountWorld.x + shotDir.x * 1.2;
    Transform.y[pid] = tmpMountWorld.y + shotDir.y * 1.2;
    Transform.z[pid] = tmpMountWorld.z + shotDir.z * 1.2;

    Velocity.vx[pid] = svx + shotDir.x * projSpeed;
    Velocity.vy[pid] = svy + shotDir.y * projSpeed;
    Velocity.vz[pid] = svz + shotDir.z * projSpeed;

    Projectile.life[pid] = 2.2;
    Projectile.owner[pid] = shooterEid;
    Projectile.damage[pid] = damagePer;
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

    fireLaser(world, eid, Targeting.targetEid[eid] ?? -1);
  }
}

export function aiWeaponSystem(world: IWorld, dt: number) {
  const ais = aiQuery(world);

  for (const eid of ais) {
    const cd = LaserWeapon.cooldown[eid] ?? 0.14;
    const cdRem0 = LaserWeapon.cooldownRemaining[eid] ?? 0;
    const cdRem = Math.max(0, cdRem0 - dt);
    LaserWeapon.cooldownRemaining[eid] = cdRem;
    if (cdRem > 0) continue;

    const tid = FighterBrain.targetEid[eid] ?? -1;
    if (tid < 0) continue;
    if (!hasComponent(world, Transform, tid) || !hasComponent(world, Health, tid) || !hasComponent(world, Team, tid)) continue;
    if ((Team.id[tid] ?? -1) === (Team.id[eid] ?? -2)) continue;

    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;

    const tx = Transform.x[tid] ?? 0;
    const ty = Transform.y[tid] ?? 0;
    const tz = Transform.z[tid] ?? 0;

    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 > 900 * 900) continue;

    // Fire if target is roughly in front cone.
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
    fireLaser(world, eid, tid);
  }
}

export function projectileSystem(world: IWorld, dt: number) {
  const ps = projectileQuery(world);

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

    // Spatial hash collision query - O(n) instead of O(n*m)
    const px = Transform.x[eid] ?? 0;
    const py = Transform.y[eid] ?? 0;
    const pz = Transform.z[eid] ?? 0;
    const owner = Projectile.owner[eid] ?? -1;
    const dmg = Projectile.damage[eid] ?? 0;

    const ownerTeam =
      owner >= 0 && hasComponent(world, Team, owner) ? (Team.id[owner] ?? -1) : -1;

    // Query radius: max hit radius (typically ~11-15) plus margin for movement
    const nearbyTargets = targetSpatialHash.query(px, py, pz, 30);

    for (const tid of nearbyTargets) {
      if (tid === owner) continue;
      if (ownerTeam !== -1 && hasComponent(world, Team, tid) && (Team.id[tid] ?? -2) === ownerTeam) {
        continue;
      }
      // Verify entity still exists (could have been destroyed earlier this frame)
      if (!hasComponent(world, Health, tid)) continue;

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
        const killed = (Health.hp[tid] ?? 0) <= 0;
        impactEvents.push({ x: px, y: py, z: pz, team: ownerTeam, killed: killed ? 1 : 0 });
        if (killed) {
          removeEntity(world, tid);
        }
        break;
      }
    }
  }
}

export function targetingSystem(world: IWorld, input: SpaceInputState) {
  const players = targetingQuery(world);
  if (players.length === 0) return;
  const pid = players[0];
  if (pid === undefined) return;

  const targets = targetableQuery(world);
  const myTeam = Team.id[pid] ?? 0;
  const hostiles = targets.filter((eid) => (Team.id[eid] ?? -1) !== myTeam);

  const current = Targeting.targetEid[pid] ?? -1;
  const currentValid = current >= 0 && hostiles.includes(current);

  if (hostiles.length === 0) {
    Targeting.targetEid[pid] = -1;
    return;
  }

  const px = Transform.x[pid] ?? 0;
  const py = Transform.y[pid] ?? 0;
  const pz = Transform.z[pid] ?? 0;

  tmpQ.set(
    Transform.qx[pid] ?? 0,
    Transform.qy[pid] ?? 0,
    Transform.qz[pid] ?? 0,
    Transform.qw[pid] ?? 1
  );
  tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();

  const sorted = hostiles
    .map((eid) => {
      const dx = (Transform.x[eid] ?? 0) - px;
      const dy = (Transform.y[eid] ?? 0) - py;
      const dz = (Transform.z[eid] ?? 0) - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const inv = 1 / Math.max(1e-6, Math.sqrt(d2));
      const dot = tmpForward.dot(tmpDesired.set(dx * inv, dy * inv, dz * inv));
      return { eid, dot, d2 };
    })
    .sort((a, b) => (b.dot - a.dot) || (a.d2 - b.d2))
    .map((t) => t.eid);

  // Auto-acquire nearest hostile if no valid target
  if (!currentValid) {
    Targeting.targetEid[pid] = sorted[0] ?? -1;
    return;
  }

  // Manual cycle only when T pressed
  if (!input.cycleTarget) return;

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
  const combatants = combatantQuery(world);

  for (const eid of ais) {
    let state = FighterBrain.state[eid] ?? AIState.Acquire;
    let stateTime = (FighterBrain.stateTime[eid] ?? 0) + dt;

    const myTeam = Team.id[eid] ?? 1;
    let tid = FighterBrain.targetEid[eid] ?? -1;
    if (!isValidTarget(world, eid, tid, myTeam)) {
      tid = pickNearestHostile(world, eid, myTeam, combatants);
      FighterBrain.targetEid[eid] = tid;
      state = tid >= 0 ? AIState.Pursue : AIState.Acquire;
      stateTime = 0;
    }
    if (tid < 0) {
      FighterBrain.state[eid] = state;
      FighterBrain.stateTime[eid] = stateTime;
      continue;
    }

    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;

    const tx = Transform.x[tid] ?? 0;
    const ty = Transform.y[tid] ?? 0;
    const tz = Transform.z[tid] ?? 0;

    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const tvx = hasComponent(world, Velocity, tid) ? (Velocity.vx[tid] ?? 0) : 0;
    const tvy = hasComponent(world, Velocity, tid) ? (Velocity.vy[tid] ?? 0) : 0;
    const tvz = hasComponent(world, Velocity, tid) ? (Velocity.vz[tid] ?? 0) : 0;
    tmpTargetVel.set(tvx, tvy, tvz);

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
      const rvx = tvx - svx;
      const rvy = tvy - svy;
      const rvz = tvz - svz;
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

function isValidTarget(world: IWorld, self: number, tid: number, myTeam: number) {
  if (tid < 0 || tid === self) return false;
  if (!hasComponent(world, Transform, tid) || !hasComponent(world, Health, tid) || !hasComponent(world, Team, tid)) {
    return false;
  }
  if ((Health.hp[tid] ?? 0) <= 0) return false;
  if ((Team.id[tid] ?? -1) === myTeam) return false;
  return true;
}

function pickNearestHostile(world: IWorld, self: number, myTeam: number, combatants: number[]) {
  const sx = Transform.x[self] ?? 0;
  const sy = Transform.y[self] ?? 0;
  const sz = Transform.z[self] ?? 0;

  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;

  for (const tid of combatants) {
    if (tid === self) continue;
    if (!hasComponent(world, Team, tid) || !hasComponent(world, Health, tid) || !hasComponent(world, Transform, tid)) continue;
    if ((Health.hp[tid] ?? 0) <= 0) continue;
    if ((Team.id[tid] ?? -1) === myTeam) continue;

    const dx = (Transform.x[tid] ?? 0) - sx;
    const dy = (Transform.y[tid] ?? 0) - sy;
    const dz = (Transform.z[tid] ?? 0) - sz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = tid;
    }
  }

  return best;
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

// ─────────────────────────────────────────────────────────────────────────────
// PROTON TORPEDO SYSTEMS
// ─────────────────────────────────────────────────────────────────────────────

const torpedoLauncherQuery = defineQuery([TorpedoLauncher, Transform, Targeting, PlayerControlled]);
const torpedoProjectileQuery = defineQuery([TorpedoProjectile, Transform, Velocity]);

const tmpTorpedoDir = new Vector3();
const tmpTorpedoToTarget = new Vector3();

/**
 * Updates torpedo lock-on progress based on target position.
 * Lock builds when target is in front cone and in range, decays otherwise.
 */
export function torpedoLockSystem(world: IWorld, input: SpaceInputState, dt: number): void {
  const launchers = torpedoLauncherQuery(world);

  for (const eid of launchers) {
    const targetEid = Targeting.targetEid[eid] ?? -1;
    const currentLockTarget = TorpedoLauncher.lockTargetEid[eid] ?? -1;
    const lockTime = TorpedoLauncher.lockTime[eid] ?? 2.0;
    let lockProgress = TorpedoLauncher.lockProgress[eid] ?? 0;

    // Reset lock if target changed or invalid
    if (targetEid !== currentLockTarget) {
      TorpedoLauncher.lockTargetEid[eid] = targetEid;
      TorpedoLauncher.lockProgress[eid] = 0;
      if (targetEid < 0) continue;
    }

    if (targetEid < 0 || !hasComponent(world, Transform, targetEid)) {
      TorpedoLauncher.lockProgress[eid] = 0;
      continue;
    }

    // Check if target is in valid lock cone (front 60 degrees) and range
    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;
    const tx = Transform.x[targetEid] ?? 0;
    const ty = Transform.y[targetEid] ?? 0;
    const tz = Transform.z[targetEid] ?? 0;

    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    tmpQ.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();

    const dot = (dx * tmpForward.x + dy * tmpForward.y + dz * tmpForward.z) / Math.max(1, dist);
    const inCone = dot > 0.5;  // ~60 degree cone
    const inRange = dist < 1200;  // Torpedo effective range

    if (inCone && inRange) {
      // Progress lock
      lockProgress = Math.min(1, lockProgress + dt / lockTime);
    } else {
      // Decay lock when target leaves cone
      lockProgress = Math.max(0, lockProgress - dt / (lockTime * 2));
    }

    TorpedoLauncher.lockProgress[eid] = lockProgress;
  }
}

/**
 * Handles weapon switching between lasers and torpedoes.
 */
export function weaponSwitchSystem(world: IWorld, input: SpaceInputState): void {
  if (!input.switchWeapon) return;

  const players = playerQuery(world);
  for (const eid of players) {
    if (!hasComponent(world, WeaponLoadout, eid)) continue;
    const current = WeaponLoadout.activeWeapon[eid] ?? 0;
    WeaponLoadout.activeWeapon[eid] = current === 0 ? 1 : 0;
  }
}

/**
 * Fires proton torpedoes when locked and triggered.
 */
export function torpedoFireSystem(world: IWorld, input: SpaceInputState, dt: number): void {
  const launchers = torpedoLauncherQuery(world);

  for (const eid of launchers) {
    // Update cooldown
    const cdRem = Math.max(0, (TorpedoLauncher.cooldownRemaining[eid] ?? 0) - dt);
    TorpedoLauncher.cooldownRemaining[eid] = cdRem;

    if (!input.fireSecondary || cdRem > 0) continue;

    const ammo = TorpedoLauncher.ammo[eid] ?? 0;
    const lockProgress = TorpedoLauncher.lockProgress[eid] ?? 0;

    // Require lock and ammo to fire
    if (ammo <= 0 || lockProgress < 0.99) continue;

    // Fire torpedo!
    TorpedoLauncher.ammo[eid] = ammo - 1;
    TorpedoLauncher.cooldownRemaining[eid] = TorpedoLauncher.cooldown[eid] ?? 1.5;

    const targetEid = TorpedoLauncher.lockTargetEid[eid] ?? -1;
    fireTorpedo(world, eid, targetEid);
  }
}

function fireTorpedo(world: IWorld, shooterEid: number, targetEid: number): void {
  const sx = Transform.x[shooterEid] ?? 0;
  const sy = Transform.y[shooterEid] ?? 0;
  const sz = Transform.z[shooterEid] ?? 0;

  tmpQ.set(
    Transform.qx[shooterEid] ?? 0,
    Transform.qy[shooterEid] ?? 0,
    Transform.qz[shooterEid] ?? 0,
    Transform.qw[shooterEid] ?? 1
  );
  tmpForward.set(0, 0, -1).applyQuaternion(tmpQ).normalize();

  const projSpeed = TorpedoLauncher.projectileSpeed[shooterEid] ?? 450;
  const damage = TorpedoLauncher.damage[shooterEid] ?? 150;
  const trackingStrength = TorpedoLauncher.trackingStrength[shooterEid] ?? 0.85;

  const svx = Velocity.vx[shooterEid] ?? 0;
  const svy = Velocity.vy[shooterEid] ?? 0;
  const svz = Velocity.vz[shooterEid] ?? 0;

  const pid = addEntity(world);
  addComponent(world, Transform, pid);
  addComponent(world, Velocity, pid);
  addComponent(world, TorpedoProjectile, pid);

  // Spawn slightly ahead of ship
  Transform.x[pid] = sx + tmpForward.x * 15;
  Transform.y[pid] = sy + tmpForward.y * 15;
  Transform.z[pid] = sz + tmpForward.z * 15;
  Transform.qx[pid] = tmpQ.x;
  Transform.qy[pid] = tmpQ.y;
  Transform.qz[pid] = tmpQ.z;
  Transform.qw[pid] = tmpQ.w;

  Velocity.vx[pid] = svx + tmpForward.x * projSpeed;
  Velocity.vy[pid] = svy + tmpForward.y * projSpeed;
  Velocity.vz[pid] = svz + tmpForward.z * projSpeed;

  TorpedoProjectile.life[pid] = 8.0;  // 8 second lifetime
  TorpedoProjectile.owner[pid] = shooterEid;
  TorpedoProjectile.damage[pid] = damage;
  TorpedoProjectile.targetEid[pid] = targetEid;
  TorpedoProjectile.trackingStrength[pid] = trackingStrength;
}

/**
 * Updates torpedo projectiles - tracking and collision.
 */
export function torpedoProjectileSystem(world: IWorld, dt: number): void {
  const torpedoes = torpedoProjectileQuery(world);

  for (const eid of torpedoes) {
    const life = (TorpedoProjectile.life[eid] ?? 0) - dt;
    TorpedoProjectile.life[eid] = life;

    if (life <= 0) {
      removeEntity(world, eid);
      continue;
    }

    const px = Transform.x[eid] ?? 0;
    const py = Transform.y[eid] ?? 0;
    const pz = Transform.z[eid] ?? 0;

    let vx = Velocity.vx[eid] ?? 0;
    let vy = Velocity.vy[eid] ?? 0;
    let vz = Velocity.vz[eid] ?? 0;

    // Tracking behavior
    const targetEid = TorpedoProjectile.targetEid[eid] ?? -1;
    const trackingStrength = TorpedoProjectile.trackingStrength[eid] ?? 0.85;

    if (targetEid >= 0 && hasComponent(world, Transform, targetEid)) {
      const tx = Transform.x[targetEid] ?? 0;
      const ty = Transform.y[targetEid] ?? 0;
      const tz = Transform.z[targetEid] ?? 0;

      // Lead target if it has velocity
      let leadX = tx, leadY = ty, leadZ = tz;
      if (hasComponent(world, Velocity, targetEid)) {
        const tvx = Velocity.vx[targetEid] ?? 0;
        const tvy = Velocity.vy[targetEid] ?? 0;
        const tvz = Velocity.vz[targetEid] ?? 0;
        const dist = Math.sqrt((tx - px) ** 2 + (ty - py) ** 2 + (tz - pz) ** 2);
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const eta = dist / Math.max(1, speed);
        leadX = tx + tvx * eta * 0.5;
        leadY = ty + tvy * eta * 0.5;
        leadZ = tz + tvz * eta * 0.5;
      }

      // Compute desired direction to target
      tmpTorpedoToTarget.set(leadX - px, leadY - py, leadZ - pz).normalize();

      // Current velocity direction
      const currentSpeed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      tmpTorpedoDir.set(vx, vy, vz).normalize();

      // Blend toward target direction
      const blendFactor = trackingStrength * dt * 3;
      tmpTorpedoDir.lerp(tmpTorpedoToTarget, blendFactor).normalize();

      // Apply new velocity
      vx = tmpTorpedoDir.x * currentSpeed;
      vy = tmpTorpedoDir.y * currentSpeed;
      vz = tmpTorpedoDir.z * currentSpeed;

      Velocity.vx[eid] = vx;
      Velocity.vy[eid] = vy;
      Velocity.vz[eid] = vz;
    }

    // Update position
    Transform.x[eid] = px + vx * dt;
    Transform.y[eid] = py + vy * dt;
    Transform.z[eid] = pz + vz * dt;

    // Spatial hash collision query - O(n) instead of O(n*m)
    const owner = TorpedoProjectile.owner[eid] ?? -1;
    const dmg = TorpedoProjectile.damage[eid] ?? 150;
    const ownerTeam = owner >= 0 && hasComponent(world, Team, owner) ? (Team.id[owner] ?? -1) : -1;

    const newPx = Transform.x[eid] ?? 0;
    const newPy = Transform.y[eid] ?? 0;
    const newPz = Transform.z[eid] ?? 0;

    // Torpedo has larger hit radius (+5), so query radius 35
    const nearbyTargets = targetSpatialHash.query(newPx, newPy, newPz, 35);

    for (const tid of nearbyTargets) {
      if (tid === owner) continue;
      if (ownerTeam !== -1 && hasComponent(world, Team, tid) && (Team.id[tid] ?? -2) === ownerTeam) {
        continue;
      }
      // Verify entity still exists
      if (!hasComponent(world, Health, tid)) continue;

      const dx = (Transform.x[tid] ?? 0) - newPx;
      const dy = (Transform.y[tid] ?? 0) - newPy;
      const dz = (Transform.z[tid] ?? 0) - newPz;
      const r = (HitRadius.r[tid] ?? 8) + 5;  // Larger hit radius for torpedoes

      if (dx * dx + dy * dy + dz * dz <= r * r) {
        // Hit! Torpedoes bypass shields partially
        const shieldSp = Shield.sp[tid];
        if (shieldSp !== undefined && Shield.maxSp[tid] !== undefined) {
          const shieldDamage = dmg * 0.4;  // 40% absorbed by shields
          const hullDamage = dmg * 0.6;    // 60% goes through
          Shield.sp[tid] = Math.max(0, shieldSp - shieldDamage);
          Shield.lastHit[tid] = 0;
          Health.hp[tid] = (Health.hp[tid] ?? 0) - hullDamage;
        } else {
          Health.hp[tid] = (Health.hp[tid] ?? 0) - dmg;
        }

        removeEntity(world, eid);
        const killed = (Health.hp[tid] ?? 0) <= 0;
        impactEvents.push({ x: newPx, y: newPy, z: newPz, team: ownerTeam, killed: killed ? 1 : 0 });

        if (killed) {
          removeEntity(world, tid);
        }
        break;
      }
    }
  }
}

/**
 * Get current torpedo ammo and lock state for HUD display.
 */
export function getTorpedoState(world: IWorld): { ammo: number; maxAmmo: number; lockProgress: number; activeWeapon: number } | null {
  const players = playerQuery(world);
  if (players.length === 0) return null;

  const eid = players[0];
  if (eid === undefined || !hasComponent(world, TorpedoLauncher, eid)) return null;

  return {
    ammo: TorpedoLauncher.ammo[eid] ?? 0,
    maxAmmo: TorpedoLauncher.maxAmmo[eid] ?? 6,
    lockProgress: TorpedoLauncher.lockProgress[eid] ?? 0,
    activeWeapon: hasComponent(world, WeaponLoadout, eid) ? (WeaponLoadout.activeWeapon[eid] ?? 0) : 0
  };
}

export function getTorpedoProjectiles(world: IWorld): number[] {
  return torpedoProjectileQuery(world);
}
