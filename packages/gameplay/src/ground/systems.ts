import {
  IWorld,
  addEntity,
  addComponent,
  removeComponent,
  defineQuery,
  hasComponent,
  removeEntity
} from "bitecs";
import { Vector3, Quaternion } from "three";
import type { PhysicsWorld } from "@xwingz/physics";
import { createRng, deriveSeed } from "@xwingz/procgen";

// Frame counter for deterministic blaster spread (incremented each blasterSystem call)
let blasterFrameCounter = 0;
import {
  CharacterController,
  GroundInput,
  InGroundDomain,
  Soldier,
  Piloting,
  Enterable,
  BlasterWeapon,
  CommandPost,
  GroundAI,
  Stamina,
  DodgeRoll,
  WeaponHeat,
  GrenadeInventory,
  Grenade,
  DamageReaction,
  BlasterBolt,
  GroundVehicle,
  GroundVehicleType
} from "./components";
import {
  Transform,
  Velocity,
  Team,
  Health,
  HitRadius,
  Ship,
  PlayerControlled
} from "../space/components";
import type { GroundInputState } from "./input";

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────────

const groundCharQuery = defineQuery([
  InGroundDomain,
  CharacterController,
  GroundInput,
  Soldier,
  Transform
]);

const playerGroundQuery = defineQuery([
  InGroundDomain,
  CharacterController,
  Soldier,
  Transform
]);

const enterableQuery = defineQuery([Enterable, Transform]);

const blasterQuery = defineQuery([InGroundDomain, BlasterWeapon, Transform, Team]);

const commandPostQuery = defineQuery([CommandPost, Transform]);

const groundCombatantQuery = defineQuery([InGroundDomain, Health, Transform, Team]);

const groundAIQuery = defineQuery([
  InGroundDomain,
  GroundAI,
  CharacterController,
  GroundInput,
  Soldier,
  Transform,
  Team
]);

const blasterBoltQuery = defineQuery([BlasterBolt, Transform, Velocity]);

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE TEMPS
// ─────────────────────────────────────────────────────────────────────────────

const tmpMoveDir = new Vector3();
const tmpDesiredMove = new Vector3();
const tmpForward = new Vector3();
const tmpRight = new Vector3();
const tmpUp = new Vector3(0, 1, 0);
const tmpQuat = new Quaternion();

// ─────────────────────────────────────────────────────────────────────────────
// IMPACT EVENTS (for VFX)
// ─────────────────────────────────────────────────────────────────────────────

export type GroundImpactEvent = {
  x: number;
  y: number;
  z: number;
  shooterTeam: number;
  killed: boolean;
};

const groundImpactEvents: GroundImpactEvent[] = [];

export function consumeGroundImpactEvents(): GroundImpactEvent[] {
  return groundImpactEvents.splice(0, groundImpactEvents.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUND MOVEMENT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export function groundMovementSystem(
  world: IWorld,
  physics: PhysicsWorld,
  dt: number
): void {
  const entities = groundCharQuery(world);

  for (const eid of entities) {
    // Skip if piloting a vehicle
    if (hasComponent(world, Piloting, eid)) {
      const vehicleEid = Piloting.vehicleEid[eid] ?? -1;
      if (vehicleEid >= 0) continue;
    }

    const controller = physics.characterControllers.get(eid);
    const collider = physics.colliders.get(eid);
    if (!controller || !collider) continue;

    // ─────────────────────────────────────────────────────────────
    // 1. Gather input
    // ─────────────────────────────────────────────────────────────
    const inputX = GroundInput.moveX[eid] ?? 0;
    const inputZ = GroundInput.moveZ[eid] ?? 0;
    const wantsJump = (GroundInput.jump[eid] ?? 0) !== 0;
    const isSprinting = (GroundInput.sprint[eid] ?? 0) !== 0;
    const isCrouching = (GroundInput.crouch[eid] ?? 0) !== 0;
    const yaw = GroundInput.aimYaw[eid] ?? 0;

    // Consume jump input
    GroundInput.jump[eid] = 0;

    // ─────────────────────────────────────────────────────────────
    // 2. Compute world-space movement direction from yaw
    // ─────────────────────────────────────────────────────────────
    tmpForward.set(0, 0, -1).applyAxisAngle(tmpUp, yaw);
    tmpRight.set(1, 0, 0).applyAxisAngle(tmpUp, yaw);

    tmpMoveDir.set(0, 0, 0);
    tmpMoveDir.addScaledVector(tmpRight, inputX);
    tmpMoveDir.addScaledVector(tmpForward, inputZ);
    if (tmpMoveDir.lengthSq() > 1e-4) {
      tmpMoveDir.normalize();
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Determine speed based on modifiers
    // ─────────────────────────────────────────────────────────────
    const walkSpeed = Soldier.walkSpeed[eid] ?? 4.5;
    const sprintSpeed = Soldier.sprintSpeed[eid] ?? 7.0;
    const crouchSpeed = Soldier.crouchSpeed[eid] ?? 2.0;

    let speed = walkSpeed;
    if (isCrouching) {
      speed = crouchSpeed;
    } else if (isSprinting) {
      speed = sprintSpeed;
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Handle vertical velocity (gravity/jump)
    // ─────────────────────────────────────────────────────────────
    let vy = Velocity.vy[eid] ?? 0;
    const grounded = CharacterController.grounded[eid] !== 0;

    if (!grounded) {
      vy -= 9.81 * dt; // Gravity
    } else {
      vy = -0.1; // Small downward force to stay grounded
    }

    if (wantsJump && grounded) {
      vy = Soldier.jumpImpulse[eid] ?? 5.0;
    }

    Velocity.vy[eid] = vy;

    // ─────────────────────────────────────────────────────────────
    // 5. Compute final desired translation
    // ─────────────────────────────────────────────────────────────
    tmpDesiredMove.set(
      tmpMoveDir.x * speed * dt,
      vy * dt,
      tmpMoveDir.z * speed * dt
    );

    // ─────────────────────────────────────────────────────────────
    // 6. Use Rapier character controller for collision resolution
    // ─────────────────────────────────────────────────────────────
    controller.computeColliderMovement(collider, tmpDesiredMove);

    const correctedMove = controller.computedMovement();
    const isGroundedNow = controller.computedGrounded();
    CharacterController.grounded[eid] = isGroundedNow ? 1 : 0;

    // ─────────────────────────────────────────────────────────────
    // 7. Apply movement to Transform
    // ─────────────────────────────────────────────────────────────
    Transform.x[eid] = (Transform.x[eid] ?? 0) + correctedMove.x;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + correctedMove.y;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + correctedMove.z;

    // Sync rigid body position
    const body = physics.rigidBodies.get(eid);
    if (body) {
      body.setTranslation(
        {
          x: Transform.x[eid]!,
          y: Transform.y[eid]!,
          z: Transform.z[eid]!
        },
        true
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 8. Update orientation from yaw
    // ─────────────────────────────────────────────────────────────
    tmpQuat.setFromAxisAngle(tmpUp, yaw);
    Transform.qx[eid] = tmpQuat.x;
    Transform.qy[eid] = tmpQuat.y;
    Transform.qz[eid] = tmpQuat.z;
    Transform.qw[eid] = tmpQuat.w;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER INPUT SYNC SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export function syncPlayerGroundInput(
  world: IWorld,
  playerEid: number,
  input: GroundInputState
): void {
  if (!hasComponent(world, GroundInput, playerEid)) return;

  GroundInput.moveX[playerEid] = input.moveX;
  GroundInput.moveZ[playerEid] = input.moveZ;
  GroundInput.jump[playerEid] = input.jump ? 1 : 0;
  GroundInput.sprint[playerEid] = input.sprint ? 1 : 0;
  GroundInput.crouch[playerEid] = input.crouch ? 1 : 0;
  GroundInput.aimYaw[playerEid] = input.aimYaw;
  GroundInput.aimPitch[playerEid] = input.aimPitch;
  GroundInput.interact[playerEid] = input.interact ? 1 : 0;
  GroundInput.firePrimary[playerEid] = input.firePrimary ? 1 : 0;
  GroundInput.dodge[playerEid] = input.dodge ? 1 : 0;
  GroundInput.throwGrenade[playerEid] = input.throwGrenade ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE INTERACTION SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const ENTER_RADIUS_DEFAULT = 4.0;

export function vehicleInteractionSystem(world: IWorld): void {
  const onFootEntities = playerGroundQuery(world);
  const enterables = enterableQuery(world);

  for (const playerEid of onFootEntities) {
    const wantsInteract = (GroundInput.interact[playerEid] ?? 0) !== 0;
    if (!wantsInteract) continue;

    // Consume interact input
    GroundInput.interact[playerEid] = 0;

    // Check if already piloting (exit)
    if (hasComponent(world, Piloting, playerEid)) {
      const vehicleEid = Piloting.vehicleEid[playerEid] ?? -1;
      if (vehicleEid >= 0) {
        exitVehicle(world, playerEid, vehicleEid);
        continue;
      }
    }

    // Find nearby enterable vehicle
    const px = Transform.x[playerEid] ?? 0;
    const py = Transform.y[playerEid] ?? 0;
    const pz = Transform.z[playerEid] ?? 0;

    for (const vEid of enterables) {
      const vx = Transform.x[vEid] ?? 0;
      const vy = Transform.y[vEid] ?? 0;
      const vz = Transform.z[vEid] ?? 0;

      const dx = vx - px;
      const dy = vy - py;
      const dz = vz - pz;
      const dist2 = dx * dx + dy * dy + dz * dz;

      const enterRadius = Enterable.enterRadius[vEid] ?? ENTER_RADIUS_DEFAULT;
      if (dist2 <= enterRadius * enterRadius) {
        const seatsAvail =
          (Enterable.seatCount[vEid] ?? 1) - (Enterable.seatsFilled[vEid] ?? 0);
        if (seatsAvail > 0) {
          enterVehicle(world, playerEid, vEid);
          break;
        }
      }
    }
  }
}

function enterVehicle(world: IWorld, playerEid: number, vehicleEid: number): void {
  // Remove from ground domain
  removeComponent(world, InGroundDomain, playerEid);

  // Link to vehicle
  if (!hasComponent(world, Piloting, playerEid)) {
    addComponent(world, Piloting, playerEid);
  }
  Piloting.vehicleEid[playerEid] = vehicleEid;
  Enterable.seatsFilled[vehicleEid] = (Enterable.seatsFilled[vehicleEid] ?? 0) + 1;

  // If it's a Ship, mark it player-controlled
  if (hasComponent(world, Ship, vehicleEid)) {
    addComponent(world, PlayerControlled, vehicleEid);
  }
}

function exitVehicle(world: IWorld, playerEid: number, vehicleEid: number): void {
  // Restore ground domain
  addComponent(world, InGroundDomain, playerEid);

  // Position near vehicle
  Transform.x[playerEid] = (Transform.x[vehicleEid] ?? 0) + 3;
  Transform.y[playerEid] = (Transform.y[vehicleEid] ?? 0) + 2;
  Transform.z[playerEid] = Transform.z[vehicleEid] ?? 0;

  // Unlink
  Piloting.vehicleEid[playerEid] = -1;
  Enterable.seatsFilled[vehicleEid] = Math.max(
    0,
    (Enterable.seatsFilled[vehicleEid] ?? 1) - 1
  );

  // Remove player control from vehicle
  if (hasComponent(world, Ship, vehicleEid)) {
    removeComponent(world, PlayerControlled, vehicleEid);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLASTER WEAPON SYSTEM (spawns visible bolts)
// ─────────────────────────────────────────────────────────────────────────────

// Track spawned bolts for renderer to pick up
export type BlasterBoltSpawnEvent = {
  eid: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  team: number;
};

const blasterBoltSpawnEvents: BlasterBoltSpawnEvent[] = [];

export function consumeBlasterBoltSpawnEvents(): BlasterBoltSpawnEvent[] {
  return blasterBoltSpawnEvents.splice(0, blasterBoltSpawnEvents.length);
}

export function blasterSystem(
  world: IWorld,
  _physics: PhysicsWorld,
  dt: number
): void {
  blasterFrameCounter++;
  const shooters = blasterQuery(world);

  for (const eid of shooters) {
    // Update cooldown
    const cdRem = (BlasterWeapon.cooldownRemaining[eid] ?? 0) - dt;
    BlasterWeapon.cooldownRemaining[eid] = Math.max(0, cdRem);

    const wantsFire = (GroundInput.firePrimary[eid] ?? 0) !== 0;
    if (!wantsFire || cdRem > 0) continue;

    // Check weapon heat - don't fire if overheated
    if (hasComponent(world, WeaponHeat, eid)) {
      if ((WeaponHeat.overheated[eid] ?? 0) !== 0) continue;
    }

    // Fire!
    const fireRate = BlasterWeapon.fireRate[eid] ?? 5;
    BlasterWeapon.cooldownRemaining[eid] = 1 / fireRate;

    // Add weapon heat
    if (hasComponent(world, WeaponHeat, eid)) {
      const heat = WeaponHeat.current[eid] ?? 0;
      const heatPerShot = WeaponHeat.heatPerShot[eid] ?? 10;
      const newHeat = heat + heatPerShot;
      WeaponHeat.current[eid] = newHeat;
      WeaponHeat.timeSinceShot[eid] = 0;

      // Check for overheat
      if (newHeat >= 100) {
        WeaponHeat.overheated[eid] = 1;
        WeaponHeat.current[eid] = 100;
      }
    }

    // Spawn position (muzzle offset)
    const sx = Transform.x[eid] ?? 0;
    const sy = (Transform.y[eid] ?? 0) + 1.3; // Chest height
    const sz = Transform.z[eid] ?? 0;
    const yaw = GroundInput.aimYaw[eid] ?? 0;
    const pitch = GroundInput.aimPitch[eid] ?? 0;

    // Compute aim direction
    tmpForward.set(0, 0, -1);
    tmpQuat.setFromAxisAngle(tmpUp, yaw);
    tmpForward.applyQuaternion(tmpQuat);

    // Apply pitch
    tmpRight.set(1, 0, 0).applyQuaternion(tmpQuat);
    tmpQuat.setFromAxisAngle(tmpRight, pitch);
    tmpForward.applyQuaternion(tmpQuat).normalize();

    // Add spread (deterministic based on entity ID and frame counter)
    const spread = BlasterWeapon.spread[eid] ?? 0.02;
    const spreadSeed = deriveSeed(BigInt(eid), "blaster_spread", blasterFrameCounter.toString());
    const spreadRng = createRng(spreadSeed);
    tmpForward.x += (spreadRng.nextF01() - 0.5) * spread * 2;
    tmpForward.y += (spreadRng.nextF01() - 0.5) * spread * 2;
    tmpForward.z += (spreadRng.nextF01() - 0.5) * spread * 2;
    tmpForward.normalize();

    const damage = BlasterWeapon.damage[eid] ?? 20;
    const myTeam = Team.id[eid] ?? 0;
    const boltSpeed = BLASTER_BOLT_SPEED;
    const boltLife = (BlasterWeapon.range[eid] ?? 150) / boltSpeed;

    // Muzzle offset forward
    const muzzleX = sx + tmpForward.x * 0.8;
    const muzzleY = sy + tmpForward.y * 0.8;
    const muzzleZ = sz + tmpForward.z * 0.8;

    // Spawn blaster bolt entity
    const boltEid = addEntity(world);
    addComponent(world, Transform, boltEid);
    addComponent(world, Velocity, boltEid);
    addComponent(world, BlasterBolt, boltEid);

    Transform.x[boltEid] = muzzleX;
    Transform.y[boltEid] = muzzleY;
    Transform.z[boltEid] = muzzleZ;
    Transform.qx[boltEid] = 0;
    Transform.qy[boltEid] = 0;
    Transform.qz[boltEid] = 0;
    Transform.qw[boltEid] = 1;

    Velocity.vx[boltEid] = tmpForward.x * boltSpeed;
    Velocity.vy[boltEid] = tmpForward.y * boltSpeed;
    Velocity.vz[boltEid] = tmpForward.z * boltSpeed;

    BlasterBolt.ownerEid[boltEid] = eid;
    BlasterBolt.ownerTeam[boltEid] = myTeam;
    BlasterBolt.damage[boltEid] = damage;
    BlasterBolt.speed[boltEid] = boltSpeed;
    BlasterBolt.life[boltEid] = boltLife;
    BlasterBolt.maxLife[boltEid] = boltLife;

    // Record spawn event for renderer
    blasterBoltSpawnEvents.push({
      eid: boltEid,
      x: muzzleX,
      y: muzzleY,
      z: muzzleZ,
      vx: Velocity.vx[boltEid]!,
      vy: Velocity.vy[boltEid]!,
      vz: Velocity.vz[boltEid]!,
      team: myTeam
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLASTER BOLT FLIGHT SYSTEM (moves bolts and checks collisions)
// ─────────────────────────────────────────────────────────────────────────────

export function blasterBoltFlightSystem(world: IWorld, dt: number): void {
  const bolts = blasterBoltQuery(world);
  const targets = groundCombatantQuery(world);

  for (const eid of bolts) {
    // Update life
    const life = (BlasterBolt.life[eid] ?? 0) - dt;
    BlasterBolt.life[eid] = life;

    if (life <= 0) {
      removeEntity(world, eid);
      continue;
    }

    // Move bolt
    const vx = Velocity.vx[eid] ?? 0;
    const vy = Velocity.vy[eid] ?? 0;
    const vz = Velocity.vz[eid] ?? 0;

    const oldX = Transform.x[eid] ?? 0;
    const oldY = Transform.y[eid] ?? 0;
    const oldZ = Transform.z[eid] ?? 0;

    const newX = oldX + vx * dt;
    const newY = oldY + vy * dt;
    const newZ = oldZ + vz * dt;

    Transform.x[eid] = newX;
    Transform.y[eid] = newY;
    Transform.z[eid] = newZ;

    // Ground collision (remove if below ground)
    if (newY < 0) {
      groundImpactEvents.push({
        x: newX,
        y: 0,
        z: newZ,
        shooterTeam: BlasterBolt.ownerTeam[eid] ?? 0,
        killed: false
      });
      removeEntity(world, eid);
      continue;
    }

    // Check collision with targets (raycast from old to new position)
    const ownerEid = BlasterBolt.ownerEid[eid] ?? -1;
    const ownerTeam = BlasterBolt.ownerTeam[eid] ?? 0;
    const damage = BlasterBolt.damage[eid] ?? 20;

    // Ray direction (normalized)
    const rayLen = Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
    if (rayLen < 0.001) continue;

    const rayDirX = vx * dt / rayLen;
    const rayDirY = vy * dt / rayLen;
    const rayDirZ = vz * dt / rayLen;

    for (const tid of targets) {
      if (tid === ownerEid) continue;
      if ((Team.id[tid] ?? -1) === ownerTeam) continue;

      // Skip targets with active i-frames (dodge rolling)
      if (hasComponent(world, DodgeRoll, tid)) {
        if ((DodgeRoll.iFrames[tid] ?? 0) !== 0) continue;
      }

      const tx = Transform.x[tid] ?? 0;
      const ty = Transform.y[tid] ?? 0;
      const tz = Transform.z[tid] ?? 0;
      const hitRadius = HitRadius.r[tid] ?? 0.5;

      // Closest point on ray to target center
      const toTargetX = tx - oldX;
      const toTargetY = ty - oldY;
      const toTargetZ = tz - oldZ;

      const dot = toTargetX * rayDirX + toTargetY * rayDirY + toTargetZ * rayDirZ;
      const closestT = Math.max(0, Math.min(rayLen, dot));

      const closestX = oldX + rayDirX * closestT;
      const closestY = oldY + rayDirY * closestT;
      const closestZ = oldZ + rayDirZ * closestT;

      const dx = tx - closestX;
      const dy = ty - closestY;
      const dz = tz - closestZ;
      const dist2 = dx * dx + dy * dy + dz * dz;

      if (dist2 <= hitRadius * hitRadius) {
        // Hit!
        Health.hp[tid] = (Health.hp[tid] ?? 0) - damage;

        // Record hit for AI damage reaction
        recordHit(world, tid);

        const killed = (Health.hp[tid] ?? 0) <= 0;
        groundImpactEvents.push({
          x: closestX,
          y: closestY,
          z: closestZ,
          shooterTeam: ownerTeam,
          killed
        });

        if (killed) {
          removeEntity(world, tid);
        }

        // Remove bolt on hit
        removeEntity(world, eid);
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND POST SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export function commandPostSystem(world: IWorld, dt: number): void {
  const posts = commandPostQuery(world);
  const combatants = groundCombatantQuery(world);

  for (const cpEid of posts) {
    const cpX = Transform.x[cpEid] ?? 0;
    const cpY = Transform.y[cpEid] ?? 0;
    const cpZ = Transform.z[cpEid] ?? 0;
    const captureRadius = CommandPost.captureRadius[cpEid] ?? 10;
    const captureRate = CommandPost.captureRate[cpEid] ?? 0.1;
    const radius2 = captureRadius * captureRadius;

    // Count units per team in radius
    const teamCounts = new Map<number, number>();

    for (const eid of combatants) {
      const dx = (Transform.x[eid] ?? 0) - cpX;
      const dy = (Transform.y[eid] ?? 0) - cpY;
      const dz = (Transform.z[eid] ?? 0) - cpZ;
      const dist2 = dx * dx + dy * dy + dz * dz;

      if (dist2 <= radius2) {
        const team = Team.id[eid] ?? -1;
        teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
      }
    }

    // Determine dominant team
    let maxTeam = -1;
    let maxCount = 0;
    let totalCount = 0;

    for (const [team, count] of teamCounts) {
      totalCount += count;
      if (count > maxCount) {
        maxCount = count;
        maxTeam = team;
      }
    }

    // Check for contested (multiple teams with equal max)
    let contested = false;
    for (const [team, count] of teamCounts) {
      if (team !== maxTeam && count === maxCount) {
        contested = true;
        break;
      }
    }

    const ownerTeam = CommandPost.ownerTeam[cpEid] ?? -1;
    let progress = CommandPost.captureProgress[cpEid] ?? 0;

    if (contested || maxTeam === -1) {
      // No progress when contested or empty
      CommandPost.contestingTeam[cpEid] = -1;
    } else if (maxTeam === ownerTeam) {
      // Reinforce - slowly reduce enemy capture progress
      progress = Math.max(0, progress - captureRate * dt);
      CommandPost.captureProgress[cpEid] = progress;
      CommandPost.contestingTeam[cpEid] = -1;
    } else {
      // Enemy capturing
      const advantage = maxCount - (teamCounts.get(ownerTeam) ?? 0);
      progress += captureRate * advantage * dt;
      CommandPost.captureProgress[cpEid] = progress;
      CommandPost.contestingTeam[cpEid] = maxTeam;

      if (progress >= 1) {
        // Captured!
        CommandPost.ownerTeam[cpEid] = maxTeam;
        CommandPost.captureProgress[cpEid] = 0;
        CommandPost.contestingTeam[cpEid] = -1;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUND AI SYSTEM (enhanced state machine with tactical behaviors)
// ─────────────────────────────────────────────────────────────────────────────

export const enum GroundAIState {
  Idle = 0,
  MoveTo = 1,
  Attack = 2,
  Capture = 3,
  Flee = 4,
  Evade = 5,   // Reactive dodge when hit
  Strafe = 6   // Circle-strafe while attacking
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAD INTERCEPT AIMING (ported from space combat)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute time-to-intercept for a projectile to hit a moving target.
 * Used for lead aiming - AI aims where target will be, not where it is.
 * (Internal function - not exported to avoid collision with space module)
 */
function computeInterceptTime(
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

  // Handle near-linear case when relative speed ~= projectile speed
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

// Blaster bolt speed for lead aiming (m/s)
const BLASTER_BOLT_SPEED = 150;

export function groundAISystem(world: IWorld, dt: number): void {
  const ais = groundAIQuery(world);
  const commandPosts = commandPostQuery(world);
  const combatants = groundCombatantQuery(world);

  for (const eid of ais) {
    const myTeam = Team.id[eid] ?? 0;
    let state = GroundAI.state[eid] ?? GroundAIState.Idle;
    let stateTime = (GroundAI.stateTime[eid] ?? 0) + dt;

    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
    const sz = Transform.z[eid] ?? 0;
    const svx = Velocity.vx[eid] ?? 0;
    const svy = Velocity.vy[eid] ?? 0;
    const svz = Velocity.vz[eid] ?? 0;

    // ─────────────────────────────────────────────────────────────
    // 1. Scan for enemies and allies (for separation)
    // ─────────────────────────────────────────────────────────────
    let nearestEnemy = -1;
    let nearestEnemyDist = Infinity;
    let nearestEnemyX = 0, nearestEnemyZ = 0;

    // Separation vector from nearby allies
    let sepX = 0, sepZ = 0;
    const SEPARATION_RADIUS = 4.0;
    const SEPARATION_WEIGHT = 0.4;

    for (const tid of combatants) {
      if (tid === eid) continue;

      const dx = (Transform.x[tid] ?? 0) - sx;
      const dy = (Transform.y[tid] ?? 0) - sy;
      const dz = (Transform.z[tid] ?? 0) - sz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const targetTeam = Team.id[tid] ?? -1;

      if (targetTeam === myTeam) {
        // Ally - compute separation
        if (dist < SEPARATION_RADIUS && dist > 0.1) {
          const repel = (SEPARATION_RADIUS - dist) / SEPARATION_RADIUS;
          sepX -= (dx / dist) * repel;
          sepZ -= (dz / dist) * repel;
        }
      } else {
        // Enemy
        if (dist < nearestEnemyDist) {
          nearestEnemyDist = dist;
          nearestEnemy = tid;
          nearestEnemyX = Transform.x[tid] ?? 0;
          nearestEnemyZ = Transform.z[tid] ?? 0;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Check for reactive evasion (recent hit triggers evade)
    // ─────────────────────────────────────────────────────────────
    const aggression = GroundAI.aggression[eid] ?? 0.5;
    const engageRange = 30 + aggression * 20;
    const fleeHealthThreshold = 20 + (1 - aggression) * 30;
    const hp = Health.hp[eid] ?? 100;

    if (hasComponent(world, DamageReaction, eid)) {
      const lastHit = DamageReaction.lastHitTime[eid] ?? 999;
      const evadeChance = DamageReaction.evadeChance[eid] ?? 0.6;

      // If hit recently and not already evading, trigger evasion
      if (lastHit < 0.5 && state !== GroundAIState.Evade && state !== GroundAIState.Flee) {
        // Use deterministic check based on entity ID
        const evadeRoll = ((eid * 7919) % 100) / 100;
        if (evadeRoll < evadeChance) {
          state = GroundAIState.Evade;
          stateTime = 0;
          // Trigger dodge roll
          GroundInput.dodge[eid] = 1;
          // Pick strafe direction away from attacker
          GroundAI.strafeDir[eid] = nearestEnemy >= 0 ? (((eid * 13) % 2) === 0 ? 1 : -1) : 1;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. State transitions
    // ─────────────────────────────────────────────────────────────
    if (hp < fleeHealthThreshold && state !== GroundAIState.Flee) {
      state = GroundAIState.Flee;
      stateTime = 0;
    } else if (state === GroundAIState.Evade && stateTime > 0.8) {
      // After evade, transition to strafe attack if enemy nearby
      if (nearestEnemy >= 0 && nearestEnemyDist < engageRange) {
        state = GroundAIState.Strafe;
        GroundAI.targetEid[eid] = nearestEnemy;
        GroundAI.strafeTimer[eid] = 1.5 + ((eid * 17) % 100) / 100; // 1.5-2.5s
      } else {
        state = GroundAIState.Idle;
      }
      stateTime = 0;
    } else if (nearestEnemy >= 0 && nearestEnemyDist < engageRange &&
               state !== GroundAIState.Attack && state !== GroundAIState.Strafe &&
               state !== GroundAIState.Evade && state !== GroundAIState.Flee) {
      // Engage enemy - aggressive AI uses strafe, others use attack
      if (aggression > 0.6) {
        state = GroundAIState.Strafe;
        GroundAI.strafeDir[eid] = ((eid * 13) % 2) === 0 ? 1 : -1;
        GroundAI.strafeTimer[eid] = 1.5 + ((eid * 23) % 100) / 100;
      } else {
        state = GroundAIState.Attack;
      }
      stateTime = 0;
      GroundAI.targetEid[eid] = nearestEnemy;
    } else if (state === GroundAIState.Strafe && stateTime > 4) {
      // Switch between strafe and attack periodically
      state = GroundAIState.Attack;
      stateTime = 0;
    } else if (state === GroundAIState.Attack && stateTime > 3 && aggression > 0.5) {
      // Switch to strafe for variety
      state = GroundAIState.Strafe;
      GroundAI.strafeDir[eid] = ((eid * 13 + Math.floor(stateTime * 10)) % 2) === 0 ? 1 : -1;
      GroundAI.strafeTimer[eid] = 1.5;
      stateTime = 0;
    } else if (state === GroundAIState.Idle && stateTime > 2) {
      // Find a command post to capture
      let targetPost = -1;
      let targetPostDist = Infinity;

      for (const cpEid of commandPosts) {
        const cpOwner = CommandPost.ownerTeam[cpEid] ?? -1;
        if (cpOwner === myTeam) continue;

        const dx = (Transform.x[cpEid] ?? 0) - sx;
        const dz = (Transform.z[cpEid] ?? 0) - sz;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < targetPostDist) {
          targetPostDist = dist;
          targetPost = cpEid;
        }
      }

      if (targetPost >= 0) {
        state = GroundAIState.MoveTo;
        stateTime = 0;
        GroundAI.waypointX[eid] = Transform.x[targetPost] ?? 0;
        GroundAI.waypointY[eid] = Transform.y[targetPost] ?? 0;
        GroundAI.waypointZ[eid] = Transform.z[targetPost] ?? 0;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Execute state behavior
    // ─────────────────────────────────────────────────────────────
    let moveX = 0;
    let moveZ = 0;
    let wantsFire = 0;
    let aimYaw = GroundInput.aimYaw[eid] ?? 0;

    if (state === GroundAIState.MoveTo || state === GroundAIState.Capture) {
      const wx = GroundAI.waypointX[eid] ?? 0;
      const wz = GroundAI.waypointZ[eid] ?? 0;
      const dx = wx - sx;
      const dz = wz - sz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 2) {
        aimYaw = Math.atan2(-dx, -dz);
        moveZ = 1;
      } else {
        state = GroundAIState.Capture;
      }
    } else if (state === GroundAIState.Attack || state === GroundAIState.Strafe) {
      const tid = GroundAI.targetEid[eid] ?? -1;
      if (tid >= 0 && hasComponent(world, Transform, tid)) {
        const tx = Transform.x[tid] ?? 0;
        const ty = Transform.y[tid] ?? 0;
        const tz = Transform.z[tid] ?? 0;
        const tvx = Velocity.vx[tid] ?? 0;
        const tvy = Velocity.vy[tid] ?? 0;
        const tvz = Velocity.vz[tid] ?? 0;

        // ─────────────────────────────────────────────────────────
        // LEAD INTERCEPT AIMING
        // Calculate where to aim based on target movement
        // ─────────────────────────────────────────────────────────
        const dx = tx - sx;
        const dy = ty - sy;
        const dz = tz - sz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Relative velocity
        const rvx = tvx - svx;
        const rvy = tvy - svy;
        const rvz = tvz - svz;

        // Compute lead time
        const leadTime = computeInterceptTime(dx, dy, dz, rvx, rvy, rvz, BLASTER_BOLT_SPEED) ?? dist / BLASTER_BOLT_SPEED;

        // Predicted target position
        const predX = tx + tvx * leadTime;
        const predZ = tz + tvz * leadTime;
        const predDx = predX - sx;
        const predDz = predZ - sz;

        // Aim at predicted position
        aimYaw = Math.atan2(-predDx, -predDz);

        // Movement behavior differs between Attack and Strafe
        if (state === GroundAIState.Strafe) {
          // Circle-strafe: move perpendicular to target
          const strafeDir = GroundAI.strafeDir[eid] ?? 1;
          let strafeTimer = GroundAI.strafeTimer[eid] ?? 0;
          strafeTimer -= dt;

          // Change strafe direction periodically
          if (strafeTimer <= 0) {
            GroundAI.strafeDir[eid] = -strafeDir;
            GroundAI.strafeTimer[eid] = 1.5 + ((eid * 31) % 100) / 100;
          } else {
            GroundAI.strafeTimer[eid] = strafeTimer;
          }

          // Strafe perpendicular + slight advance/retreat
          moveX = strafeDir * 0.8;
          if (dist > 20) {
            moveZ = 0.5; // Advance while strafing
          } else if (dist < 10) {
            moveZ = -0.3; // Retreat while strafing
          }
        } else {
          // Standard attack: advance/retreat based on distance
          if (dist > 15) {
            moveZ = 1;
          } else if (dist < 8) {
            moveZ = -0.5;
          }
        }

        wantsFire = 1;
      } else {
        // Target lost
        state = GroundAIState.Idle;
        stateTime = 0;
      }
    } else if (state === GroundAIState.Evade) {
      // During evade, move in strafe direction
      const strafeDir = GroundAI.strafeDir[eid] ?? 1;
      moveX = strafeDir;
      moveZ = -0.3; // Slight retreat

      // Keep facing nearest enemy if known
      if (nearestEnemy >= 0) {
        const dx = nearestEnemyX - sx;
        const dz = nearestEnemyZ - sz;
        aimYaw = Math.atan2(-dx, -dz);
      }
    } else if (state === GroundAIState.Flee) {
      if (nearestEnemy >= 0) {
        const dx = sx - nearestEnemyX;
        const dz = sz - nearestEnemyZ;
        aimYaw = Math.atan2(-dx, -dz);
        moveZ = 1;
      }
      if (stateTime > 5) {
        state = GroundAIState.Idle;
        stateTime = 0;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 5. Apply separation to movement
    // ─────────────────────────────────────────────────────────────
    const sepLen = Math.sqrt(sepX * sepX + sepZ * sepZ);
    if (sepLen > 0.1 && state !== GroundAIState.Evade) {
      // Convert separation to local movement space
      const cosYaw = Math.cos(aimYaw);
      const sinYaw = Math.sin(aimYaw);
      const localSepX = sepX * cosYaw - sepZ * sinYaw;
      const localSepZ = sepX * sinYaw + sepZ * cosYaw;

      moveX += localSepX * SEPARATION_WEIGHT;
      moveZ += localSepZ * SEPARATION_WEIGHT;
    }

    // Clamp movement
    const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveZ /= moveLen;
    }

    // ─────────────────────────────────────────────────────────────
    // 6. Apply AI decisions to input components
    // ─────────────────────────────────────────────────────────────
    GroundInput.aimYaw[eid] = aimYaw;
    GroundInput.moveX[eid] = moveX;
    GroundInput.moveZ[eid] = moveZ;
    GroundInput.firePrimary[eid] = wantsFire;
    GroundInput.sprint[eid] = state === GroundAIState.Flee ? 1 : 0;

    GroundAI.state[eid] = state;
    GroundAI.stateTime[eid] = stateTime;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE REACTION SYSTEM (tracks recent hits for AI evasion)
// ─────────────────────────────────────────────────────────────────────────────

const damageReactionQuery = defineQuery([DamageReaction]);

export function damageReactionSystem(world: IWorld, dt: number): void {
  const entities = damageReactionQuery(world);

  for (const eid of entities) {
    // Increment time since last hit
    const lastHit = DamageReaction.lastHitTime[eid] ?? 999;
    DamageReaction.lastHitTime[eid] = lastHit + dt;

    // Decay hit count over time
    if (lastHit > 2.0) {
      DamageReaction.hitCount[eid] = 0;
    }
  }
}

/**
 * Record a hit on an entity for damage reaction system.
 * Called by blasterSystem when a hit lands.
 */
export function recordHit(world: IWorld, eid: number): void {
  if (hasComponent(world, DamageReaction, eid)) {
    DamageReaction.lastHitTime[eid] = 0;
    DamageReaction.hitCount[eid] = (DamageReaction.hitCount[eid] ?? 0) + 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAMINA SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const staminaQuery = defineQuery([InGroundDomain, Stamina, GroundInput]);

export function staminaSystem(world: IWorld, dt: number): void {
  const entities = staminaQuery(world);

  for (const eid of entities) {
    const isSprinting = (GroundInput.sprint[eid] ?? 0) !== 0;
    const isMoving = Math.abs(GroundInput.moveX[eid] ?? 0) > 0.1 || Math.abs(GroundInput.moveZ[eid] ?? 0) > 0.1;

    let current = Stamina.current[eid] ?? 100;
    const max = Stamina.max[eid] ?? 100;
    const regenRate = Stamina.regenRate[eid] ?? 20;
    const regenDelay = Stamina.regenDelay[eid] ?? 1.5;
    const sprintDrain = Stamina.sprintDrainRate[eid] ?? 15;
    let timeSinceDrain = Stamina.timeSinceDrain[eid] ?? 0;

    if (isSprinting && isMoving && current > 0) {
      // Drain stamina while sprinting
      current -= sprintDrain * dt;
      timeSinceDrain = 0;

      // Disable sprint if out of stamina
      if (current <= 0) {
        current = 0;
        GroundInput.sprint[eid] = 0;
      }
    } else {
      // Regenerate stamina after delay
      timeSinceDrain += dt;
      if (timeSinceDrain >= regenDelay) {
        current = Math.min(max, current + regenRate * dt);
      }
    }

    Stamina.current[eid] = current;
    Stamina.timeSinceDrain[eid] = timeSinceDrain;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DODGE ROLL SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const dodgeRollQuery = defineQuery([InGroundDomain, DodgeRoll, Stamina, GroundInput, Transform]);

export const enum DodgeRollState {
  Ready = 0,
  Rolling = 1,
  Cooldown = 2
}

export function dodgeRollSystem(
  world: IWorld,
  physics: PhysicsWorld,
  dt: number
): void {
  const entities = dodgeRollQuery(world);

  for (const eid of entities) {
    let state = DodgeRoll.state[eid] ?? DodgeRollState.Ready;
    let timer = DodgeRoll.timer[eid] ?? 0;
    const rollDuration = DodgeRoll.rollDuration[eid] ?? 0.5;
    const cooldown = DodgeRoll.cooldown[eid] ?? 1.0;
    const staminaCost = DodgeRoll.staminaCost[eid] ?? 25;
    const rollSpeed = DodgeRoll.rollSpeed[eid] ?? 8.0;

    // Check for dodge input
    const wantsDodge = (GroundInput.dodge[eid] ?? 0) !== 0;
    GroundInput.dodge[eid] = 0; // Consume input

    if (state === DodgeRollState.Ready && wantsDodge) {
      const stamina = Stamina.current[eid] ?? 0;
      if (stamina >= staminaCost) {
        // Start dodge roll
        state = DodgeRollState.Rolling;
        timer = rollDuration;
        DodgeRoll.iFrames[eid] = 1;

        // Consume stamina
        Stamina.current[eid] = stamina - staminaCost;
        Stamina.timeSinceDrain[eid] = 0;

        // Set roll direction from input or forward
        const inputX = GroundInput.moveX[eid] ?? 0;
        const inputZ = GroundInput.moveZ[eid] ?? 0;
        const yaw = GroundInput.aimYaw[eid] ?? 0;

        if (Math.abs(inputX) > 0.1 || Math.abs(inputZ) > 0.1) {
          // Roll in input direction
          tmpForward.set(0, 0, -1).applyAxisAngle(tmpUp, yaw);
          tmpRight.set(1, 0, 0).applyAxisAngle(tmpUp, yaw);
          tmpMoveDir.set(0, 0, 0);
          tmpMoveDir.addScaledVector(tmpRight, inputX);
          tmpMoveDir.addScaledVector(tmpForward, inputZ);
          tmpMoveDir.normalize();
          DodgeRoll.directionX[eid] = tmpMoveDir.x;
          DodgeRoll.directionZ[eid] = tmpMoveDir.z;
        } else {
          // Roll forward
          tmpForward.set(0, 0, -1).applyAxisAngle(tmpUp, yaw);
          DodgeRoll.directionX[eid] = tmpForward.x;
          DodgeRoll.directionZ[eid] = tmpForward.z;
        }
      }
    }

    // Update state timer
    if (state === DodgeRollState.Rolling) {
      timer -= dt;
      if (timer <= 0) {
        state = DodgeRollState.Cooldown;
        timer = cooldown;
        DodgeRoll.iFrames[eid] = 0;
      } else {
        // Apply roll movement
        const controller = physics.characterControllers.get(eid);
        const collider = physics.colliders.get(eid);
        if (controller && collider) {
          const dirX = DodgeRoll.directionX[eid] ?? 0;
          const dirZ = DodgeRoll.directionZ[eid] ?? 0;
          tmpDesiredMove.set(
            dirX * rollSpeed * dt,
            -0.1 * dt, // Small downward to stay grounded
            dirZ * rollSpeed * dt
          );
          controller.computeColliderMovement(collider, tmpDesiredMove);
          const correctedMove = controller.computedMovement();
          Transform.x[eid] = (Transform.x[eid] ?? 0) + correctedMove.x;
          Transform.y[eid] = (Transform.y[eid] ?? 0) + correctedMove.y;
          Transform.z[eid] = (Transform.z[eid] ?? 0) + correctedMove.z;

          // Sync rigid body
          const body = physics.rigidBodies.get(eid);
          if (body) {
            body.setTranslation(
              { x: Transform.x[eid]!, y: Transform.y[eid]!, z: Transform.z[eid]! },
              true
            );
          }
        }
      }
    } else if (state === DodgeRollState.Cooldown) {
      timer -= dt;
      if (timer <= 0) {
        state = DodgeRollState.Ready;
        timer = 0;
      }
    }

    DodgeRoll.state[eid] = state;
    DodgeRoll.timer[eid] = timer;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEAPON HEAT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const weaponHeatQuery = defineQuery([InGroundDomain, WeaponHeat, BlasterWeapon]);

export function weaponHeatSystem(world: IWorld, dt: number): void {
  const entities = weaponHeatQuery(world);

  for (const eid of entities) {
    let heat = WeaponHeat.current[eid] ?? 0;
    const cooldownRate = WeaponHeat.cooldownRate[eid] ?? 25;
    const cooldownDelay = WeaponHeat.cooldownDelay[eid] ?? 0.3;
    const overheatCoolRate = WeaponHeat.overheatCoolRate[eid] ?? 40;
    let timeSinceShot = WeaponHeat.timeSinceShot[eid] ?? 0;
    let overheated = (WeaponHeat.overheated[eid] ?? 0) !== 0;

    timeSinceShot += dt;

    // Cool down weapon
    if (overheated) {
      // Faster cooldown during overheat state
      heat = Math.max(0, heat - overheatCoolRate * dt);
      if (heat <= 0) {
        overheated = false;
        heat = 0;
      }
    } else if (timeSinceShot >= cooldownDelay) {
      heat = Math.max(0, heat - cooldownRate * dt);
    }

    WeaponHeat.current[eid] = heat;
    WeaponHeat.timeSinceShot[eid] = timeSinceShot;
    WeaponHeat.overheated[eid] = overheated ? 1 : 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GRENADE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const grenadeInventoryQuery = defineQuery([InGroundDomain, GrenadeInventory, GroundInput, Transform, Team]);
const activeGrenadeQuery = defineQuery([Grenade, Transform, Velocity]);

export type GrenadeExplosionEvent = {
  x: number;
  y: number;
  z: number;
  radius: number;
  damage: number;
  throwerTeam: number;
};

const grenadeExplosionEvents: GrenadeExplosionEvent[] = [];

export function consumeGrenadeExplosionEvents(): GrenadeExplosionEvent[] {
  return grenadeExplosionEvents.splice(0, grenadeExplosionEvents.length);
}

export function grenadeThrowSystem(
  world: IWorld,
  dt: number
): void {
  const entities = grenadeInventoryQuery(world);

  for (const eid of entities) {
    // Update cooldown
    const cdRem = (GrenadeInventory.cooldown[eid] ?? 0) - dt;
    GrenadeInventory.cooldown[eid] = Math.max(0, cdRem);

    const wantsThrow = (GroundInput.throwGrenade[eid] ?? 0) !== 0;
    GroundInput.throwGrenade[eid] = 0; // Consume input

    if (!wantsThrow || cdRem > 0) continue;

    const count = GrenadeInventory.count[eid] ?? 0;
    if (count <= 0) continue;

    // Spawn grenade
    const grenadeEid = addEntity(world);
    addComponent(world, Transform, grenadeEid);
    addComponent(world, Velocity, grenadeEid);
    addComponent(world, Grenade, grenadeEid);

    // Position at thrower
    const sx = Transform.x[eid] ?? 0;
    const sy = (Transform.y[eid] ?? 0) + 1.5; // Throw from chest height
    const sz = Transform.z[eid] ?? 0;

    Transform.x[grenadeEid] = sx;
    Transform.y[grenadeEid] = sy;
    Transform.z[grenadeEid] = sz;
    Transform.qx[grenadeEid] = 0;
    Transform.qy[grenadeEid] = 0;
    Transform.qz[grenadeEid] = 0;
    Transform.qw[grenadeEid] = 1;

    // Calculate throw direction from aim
    const yaw = GroundInput.aimYaw[eid] ?? 0;
    const pitch = GroundInput.aimPitch[eid] ?? 0;
    tmpForward.set(0, 0, -1);
    tmpQuat.setFromAxisAngle(tmpUp, yaw);
    tmpForward.applyQuaternion(tmpQuat);
    tmpRight.set(1, 0, 0).applyQuaternion(tmpQuat);
    tmpQuat.setFromAxisAngle(tmpRight, pitch);
    tmpForward.applyQuaternion(tmpQuat).normalize();

    // Throw velocity (15 m/s + upward arc)
    const throwSpeed = 15;
    Velocity.vx[grenadeEid] = tmpForward.x * throwSpeed;
    Velocity.vy[grenadeEid] = tmpForward.y * throwSpeed + 5; // Arc upward
    Velocity.vz[grenadeEid] = tmpForward.z * throwSpeed;

    // Grenade properties
    const grenadeType = GrenadeInventory.type[eid] ?? 0;
    Grenade.throwerEid[grenadeEid] = eid;
    Grenade.type[grenadeEid] = grenadeType;
    Grenade.fuseTime[grenadeEid] = grenadeType === 1 ? 0.1 : 3.0; // Impact vs Thermal
    Grenade.damage[grenadeEid] = 100;
    Grenade.blastRadius[grenadeEid] = 6;
    Grenade.bounced[grenadeEid] = 0;

    // Consume grenade and start cooldown
    GrenadeInventory.count[eid] = count - 1;
    GrenadeInventory.cooldown[eid] = GrenadeInventory.cooldownMax[eid] ?? 5;
  }
}

export function grenadeFlightSystem(world: IWorld, dt: number): void {
  const grenades = activeGrenadeQuery(world);
  const targets = groundCombatantQuery(world);

  for (const eid of grenades) {
    // Apply gravity
    Velocity.vy[eid] = (Velocity.vy[eid] ?? 0) - 9.81 * dt;

    // Update position
    Transform.x[eid] = (Transform.x[eid] ?? 0) + (Velocity.vx[eid] ?? 0) * dt;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + (Velocity.vy[eid] ?? 0) * dt;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + (Velocity.vz[eid] ?? 0) * dt;

    // Ground collision (simple check)
    if ((Transform.y[eid] ?? 0) <= 0) {
      Transform.y[eid] = 0;
      Velocity.vy[eid] = Math.abs(Velocity.vy[eid] ?? 0) * 0.3; // Bounce
      Velocity.vx[eid] = (Velocity.vx[eid] ?? 0) * 0.7; // Friction
      Velocity.vz[eid] = (Velocity.vz[eid] ?? 0) * 0.7;
      Grenade.bounced[eid] = 1;

      // Impact grenades explode on bounce
      if ((Grenade.type[eid] ?? 0) === 1) {
        Grenade.fuseTime[eid] = 0;
      }
    }

    // Update fuse
    const fuseTime = (Grenade.fuseTime[eid] ?? 0) - dt;
    Grenade.fuseTime[eid] = fuseTime;

    // Explode
    if (fuseTime <= 0) {
      const gx = Transform.x[eid] ?? 0;
      const gy = Transform.y[eid] ?? 0;
      const gz = Transform.z[eid] ?? 0;
      const damage = Grenade.damage[eid] ?? 100;
      const radius = Grenade.blastRadius[eid] ?? 6;
      const throwerEid = Grenade.throwerEid[eid] ?? -1;
      const throwerTeam = throwerEid >= 0 ? (Team.id[throwerEid] ?? 0) : 0;

      // Damage nearby targets
      for (const tid of targets) {
        // Skip targets with active i-frames (dodge rolling)
        if (hasComponent(world, DodgeRoll, tid)) {
          if ((DodgeRoll.iFrames[tid] ?? 0) !== 0) continue;
        }

        const dx = (Transform.x[tid] ?? 0) - gx;
        const dy = (Transform.y[tid] ?? 0) - gy;
        const dz = (Transform.z[tid] ?? 0) - gz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < radius) {
          // Damage falloff with distance
          const falloff = 1 - (dist / radius);
          const actualDamage = damage * falloff;
          Health.hp[tid] = (Health.hp[tid] ?? 0) - actualDamage;

          if ((Health.hp[tid] ?? 0) <= 0) {
            removeEntity(world, tid);
          }
        }
      }

      // Record explosion event for VFX
      grenadeExplosionEvents.push({
        x: gx,
        y: gy,
        z: gz,
        radius,
        damage,
        throwerTeam
      });

      // Remove grenade
      removeEntity(world, eid);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export type SoldierClass = 0 | 1 | 2 | 3; // Assault, Heavy, Sniper, Officer

const CLASS_STATS: Array<{
  walk: number;
  sprint: number;
  crouch: number;
  jump: number;
  ammo: number;
  blasterDamage: number;
  blasterRate: number;
  blasterRange: number;
  blasterSpread: number;
  heatPerShot: number;
  grenades: number;
  grenadeType: number;
}> = [
  // Assault - balanced, high mobility
  { walk: 4.5, sprint: 7.0, crouch: 2.0, jump: 5.0, ammo: 200, blasterDamage: 15, blasterRate: 8, blasterRange: 100, blasterSpread: 0.03, heatPerShot: 8, grenades: 3, grenadeType: 0 },
  // Heavy - slower, high damage, high heat
  { walk: 3.5, sprint: 5.5, crouch: 1.5, jump: 4.0, ammo: 300, blasterDamage: 25, blasterRate: 4, blasterRange: 80, blasterSpread: 0.05, heatPerShot: 15, grenades: 2, grenadeType: 1 },
  // Sniper - precise, low heat, few shots
  { walk: 4.0, sprint: 6.5, crouch: 1.8, jump: 5.5, ammo: 50, blasterDamage: 80, blasterRate: 1, blasterRange: 200, blasterSpread: 0.005, heatPerShot: 25, grenades: 1, grenadeType: 2 },
  // Officer - support, medium stats
  { walk: 4.2, sprint: 6.5, crouch: 1.9, jump: 4.5, ammo: 150, blasterDamage: 18, blasterRate: 6, blasterRange: 90, blasterSpread: 0.025, heatPerShot: 10, grenades: 2, grenadeType: 3 }
];

export function spawnSoldier(
  world: IWorld,
  physics: PhysicsWorld,
  x: number,
  y: number,
  z: number,
  teamId: number,
  classId: SoldierClass = 0,
  isAI: boolean = false,
  seed: bigint = BigInt(0)
): number {
  const { rapier, world: rapierWorld, characterControllers, rigidBodies, colliders } = physics;

  const eid = addEntity(world);

  // Core components
  addComponent(world, InGroundDomain, eid);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, CharacterController, eid);
  addComponent(world, GroundInput, eid);
  addComponent(world, Soldier, eid);
  addComponent(world, Piloting, eid);
  addComponent(world, BlasterWeapon, eid);

  // Phase 1: Enhanced infantry components
  addComponent(world, Stamina, eid);
  addComponent(world, DodgeRoll, eid);
  addComponent(world, WeaponHeat, eid);
  addComponent(world, GrenadeInventory, eid);

  // Set transform
  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  // Team and health
  Team.id[eid] = teamId;
  Health.hp[eid] = 100;
  Health.maxHp[eid] = 100;
  HitRadius.r[eid] = 0.5;

  // Class stats
  const stats = CLASS_STATS[classId]!;
  Soldier.classId[eid] = classId;
  Soldier.walkSpeed[eid] = stats.walk;
  Soldier.sprintSpeed[eid] = stats.sprint;
  Soldier.crouchSpeed[eid] = stats.crouch;
  Soldier.jumpImpulse[eid] = stats.jump;
  Soldier.ammo[eid] = stats.ammo;
  Soldier.maxAmmo[eid] = stats.ammo;

  // Blaster
  BlasterWeapon.damage[eid] = stats.blasterDamage;
  BlasterWeapon.fireRate[eid] = stats.blasterRate;
  BlasterWeapon.cooldownRemaining[eid] = 0;
  BlasterWeapon.range[eid] = stats.blasterRange;
  BlasterWeapon.spread[eid] = stats.blasterSpread;

  // Stamina (for sprint and dodge roll)
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  Stamina.regenRate[eid] = 20;
  Stamina.regenDelay[eid] = 1.5;
  Stamina.timeSinceDrain[eid] = 10; // Start ready to regen
  Stamina.sprintDrainRate[eid] = 15;

  // Dodge roll
  DodgeRoll.state[eid] = DodgeRollState.Ready;
  DodgeRoll.timer[eid] = 0;
  DodgeRoll.rollDuration[eid] = 0.5;
  DodgeRoll.cooldown[eid] = 1.0;
  DodgeRoll.staminaCost[eid] = 25;
  DodgeRoll.rollSpeed[eid] = 8.0;
  DodgeRoll.directionX[eid] = 0;
  DodgeRoll.directionZ[eid] = 1;
  DodgeRoll.iFrames[eid] = 0;

  // Weapon heat
  WeaponHeat.current[eid] = 0;
  WeaponHeat.heatPerShot[eid] = stats.heatPerShot;
  WeaponHeat.cooldownRate[eid] = 25;
  WeaponHeat.cooldownDelay[eid] = 0.3;
  WeaponHeat.timeSinceShot[eid] = 10;
  WeaponHeat.overheated[eid] = 0;
  WeaponHeat.overheatCoolRate[eid] = 40;

  // Grenades
  GrenadeInventory.count[eid] = stats.grenades;
  GrenadeInventory.maxCount[eid] = stats.grenades;
  GrenadeInventory.type[eid] = stats.grenadeType;
  GrenadeInventory.cooldown[eid] = 0;
  GrenadeInventory.cooldownMax[eid] = 5;

  // Character controller
  const capsuleRadius = 0.35;
  const capsuleHalfHeight = 0.55; // Total height ~1.8m
  CharacterController.capsuleRadius[eid] = capsuleRadius;
  CharacterController.capsuleHeight[eid] = capsuleHalfHeight * 2 + capsuleRadius * 2;
  CharacterController.stepHeight[eid] = 0.35;
  CharacterController.slopeLimit[eid] = Math.PI / 4;
  CharacterController.grounded[eid] = 0;

  // Not piloting anything
  Piloting.vehicleEid[eid] = -1;

  // Initialize input
  GroundInput.moveX[eid] = 0;
  GroundInput.moveZ[eid] = 0;
  GroundInput.jump[eid] = 0;
  GroundInput.sprint[eid] = 0;
  GroundInput.crouch[eid] = 0;
  GroundInput.aimYaw[eid] = 0;
  GroundInput.aimPitch[eid] = 0;
  GroundInput.interact[eid] = 0;
  GroundInput.firePrimary[eid] = 0;
  GroundInput.dodge[eid] = 0;
  GroundInput.throwGrenade[eid] = 0;

  // AI components
  if (isAI) {
    addComponent(world, GroundAI, eid);
    addComponent(world, DamageReaction, eid);

    GroundAI.state[eid] = GroundAIState.Idle;
    GroundAI.stateTime[eid] = 0;
    GroundAI.targetEid[eid] = -1;
    GroundAI.waypointX[eid] = x;
    GroundAI.waypointY[eid] = y;
    GroundAI.waypointZ[eid] = z;

    // Deterministic AI stats based on seed
    const aiSeed = seed !== BigInt(0) ? seed : deriveSeed(BigInt(eid), "ai_stats");
    const aiRng = createRng(aiSeed);
    GroundAI.aggression[eid] = 0.3 + aiRng.nextF01() * 0.5;
    GroundAI.accuracy[eid] = 0.4 + aiRng.nextF01() * 0.4;

    // Strafe behavior
    GroundAI.strafeDir[eid] = aiRng.nextF01() > 0.5 ? 1 : -1;
    GroundAI.strafeTimer[eid] = 1.5 + aiRng.nextF01();

    // Damage reaction for evasion
    DamageReaction.lastHitTime[eid] = 999; // No recent hits
    DamageReaction.hitCount[eid] = 0;
    DamageReaction.evadeChance[eid] = 0.4 + aiRng.nextF01() * 0.4; // 40-80% evade chance
  }

  // Create Rapier physics objects
  const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z);
  const body = rapierWorld.createRigidBody(bodyDesc);
  rigidBodies.set(eid, body);

  const colliderDesc = rapier.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius);
  const collider = rapierWorld.createCollider(colliderDesc, body);
  colliders.set(eid, collider);

  const controller = rapierWorld.createCharacterController(0.01);
  controller.setSlideEnabled(true);
  controller.setMaxSlopeClimbAngle(CharacterController.slopeLimit[eid]!);
  controller.setMinSlopeSlideAngle(CharacterController.slopeLimit[eid]! + 0.1);
  controller.enableAutostep(CharacterController.stepHeight[eid]!, 0.3, true);
  controller.enableSnapToGround(0.5);
  characterControllers.set(eid, controller);

  CharacterController.rapierHandle[eid] = body.handle;

  return eid;
}

export function spawnCommandPost(
  world: IWorld,
  x: number,
  y: number,
  z: number,
  ownerTeam: number = -1,
  captureRadius: number = 10,
  captureRate: number = 0.1
): number {
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, CommandPost, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  CommandPost.ownerTeam[eid] = ownerTeam;
  CommandPost.captureProgress[eid] = 0;
  CommandPost.captureRadius[eid] = captureRadius;
  CommandPost.captureRate[eid] = captureRate;
  CommandPost.contestingTeam[eid] = -1;

  return eid;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET PLAYER SOLDIER
// ─────────────────────────────────────────────────────────────────────────────

const playerSoldierQuery = defineQuery([InGroundDomain, Soldier, CharacterController]);

export function getPlayerSoldier(world: IWorld): number | null {
  const soldiers = playerSoldierQuery(world);
  // Return first soldier that isn't AI-controlled
  for (const eid of soldiers) {
    if (!hasComponent(world, GroundAI, eid)) {
      return eid;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUND VEHICLE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const groundVehicleQuery = defineQuery([GroundVehicle, Transform, Velocity, Health, Team]);

/**
 * Move ground vehicles based on pilot input.
 * Vehicles are driven by the pilot's GroundInput when piloted.
 */
export function groundVehicleMovementSystem(
  world: IWorld,
  physics: PhysicsWorld,
  dt: number
): void {
  const vehicles = groundVehicleQuery(world);
  const onFootEntities = playerGroundQuery(world);

  for (const vEid of vehicles) {
    // Find if anyone is piloting this vehicle
    let pilotEid = -1;
    for (const eid of onFootEntities) {
      if (hasComponent(world, Piloting, eid)) {
        if ((Piloting.vehicleEid[eid] ?? -1) === vEid) {
          pilotEid = eid;
          break;
        }
      }
    }

    if (pilotEid < 0) continue; // No pilot - vehicle stays still

    // Get pilot input
    const inputX = GroundInput.moveX[pilotEid] ?? 0;
    const inputZ = GroundInput.moveZ[pilotEid] ?? 0;
    const yaw = GroundInput.aimYaw[pilotEid] ?? 0;
    const wantsFire = (GroundInput.firePrimary[pilotEid] ?? 0) !== 0;

    const maxSpeed = GroundVehicle.maxSpeed[vEid] ?? 15;
    const accel = GroundVehicle.acceleration[vEid] ?? 10;
    const turnRate = GroundVehicle.turnRate[vEid] ?? 2;

    // Get current velocity
    let vx = Velocity.vx[vEid] ?? 0;
    let vz = Velocity.vz[vEid] ?? 0;
    let vy = Velocity.vy[vEid] ?? 0;

    // Compute local forward/right from yaw
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    // Desired acceleration direction
    const desiredAccelX = rightX * inputX + fwdX * inputZ;
    const desiredAccelZ = rightZ * inputX + fwdZ * inputZ;
    const accelMag = Math.sqrt(desiredAccelX * desiredAccelX + desiredAccelZ * desiredAccelZ);

    if (accelMag > 0.1) {
      // Accelerate
      vx += (desiredAccelX / accelMag) * accel * dt;
      vz += (desiredAccelZ / accelMag) * accel * dt;
    } else {
      // Decelerate (friction)
      const friction = 0.95;
      vx *= friction;
      vz *= friction;
    }

    // Clamp to max speed
    const speed = Math.sqrt(vx * vx + vz * vz);
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vz = (vz / speed) * maxSpeed;
    }

    // Apply gravity if not grounded
    vy -= 9.81 * dt;

    // Update position
    const oldY = Transform.y[vEid] ?? 0;
    Transform.x[vEid] = (Transform.x[vEid] ?? 0) + vx * dt;
    Transform.y[vEid] = oldY + vy * dt;
    Transform.z[vEid] = (Transform.z[vEid] ?? 0) + vz * dt;

    // Simple ground clamp
    if ((Transform.y[vEid] ?? 0) < 0.5) {
      Transform.y[vEid] = 0.5;
      vy = 0;
    }

    // Store velocity
    Velocity.vx[vEid] = vx;
    Velocity.vy[vEid] = vy;
    Velocity.vz[vEid] = vz;

    // Update orientation
    tmpQuat.setFromAxisAngle(tmpUp, yaw);
    Transform.qx[vEid] = tmpQuat.x;
    Transform.qy[vEid] = tmpQuat.y;
    Transform.qz[vEid] = tmpQuat.z;
    Transform.qw[vEid] = tmpQuat.w;

    // Sync pilot input to vehicle for weapons
    GroundInput.aimYaw[vEid] = yaw;
    GroundInput.aimPitch[vEid] = GroundInput.aimPitch[pilotEid] ?? 0;
    GroundInput.firePrimary[vEid] = wantsFire ? 1 : 0;

    // Weapon cooldown
    const cdRem = (GroundVehicle.weaponCooldown[vEid] ?? 0) - dt;
    GroundVehicle.weaponCooldown[vEid] = Math.max(0, cdRem);

    // Vehicle fires blaster bolts if has InGroundDomain and BlasterWeapon
    // (handled by blasterSystem if those components exist)

    void turnRate; // For future steering refinement
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN SPEEDER BIKE
// ─────────────────────────────────────────────────────────────────────────────

export function spawnSpeederBike(
  world: IWorld,
  x: number,
  y: number,
  z: number,
  teamId: number
): number {
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, GroundVehicle, eid);
  addComponent(world, Enterable, eid);
  addComponent(world, InGroundDomain, eid);
  addComponent(world, GroundInput, eid);
  addComponent(world, BlasterWeapon, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  Team.id[eid] = teamId;
  Health.hp[eid] = 80;      // Fragile
  Health.maxHp[eid] = 80;
  HitRadius.r[eid] = 1.5;

  // Vehicle stats - fast and maneuverable
  GroundVehicle.type[eid] = GroundVehicleType.SpeederBike;
  GroundVehicle.maxSpeed[eid] = 25;         // Fast!
  GroundVehicle.acceleration[eid] = 15;
  GroundVehicle.turnRate[eid] = 3.0;
  GroundVehicle.weaponCooldown[eid] = 0;
  GroundVehicle.weaponCooldownMax[eid] = 0.15;  // Rapid fire

  // Enterable - 1 seat, quick entry
  Enterable.seatCount[eid] = 1;
  Enterable.seatsFilled[eid] = 0;
  Enterable.enterRadius[eid] = 3;

  // Light blaster
  BlasterWeapon.damage[eid] = 12;
  BlasterWeapon.fireRate[eid] = 6;
  BlasterWeapon.cooldownRemaining[eid] = 0;
  BlasterWeapon.range[eid] = 80;
  BlasterWeapon.spread[eid] = 0.04;

  // Initialize input
  GroundInput.moveX[eid] = 0;
  GroundInput.moveZ[eid] = 0;
  GroundInput.jump[eid] = 0;
  GroundInput.sprint[eid] = 0;
  GroundInput.crouch[eid] = 0;
  GroundInput.aimYaw[eid] = 0;
  GroundInput.aimPitch[eid] = 0;
  GroundInput.interact[eid] = 0;
  GroundInput.firePrimary[eid] = 0;
  GroundInput.dodge[eid] = 0;
  GroundInput.throwGrenade[eid] = 0;

  return eid;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN AT-ST WALKER
// ─────────────────────────────────────────────────────────────────────────────

export function spawnATST(
  world: IWorld,
  x: number,
  y: number,
  z: number,
  teamId: number
): number {
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, GroundVehicle, eid);
  addComponent(world, Enterable, eid);
  addComponent(world, InGroundDomain, eid);
  addComponent(world, GroundInput, eid);
  addComponent(world, BlasterWeapon, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  Team.id[eid] = teamId;
  Health.hp[eid] = 500;     // Tanky!
  Health.maxHp[eid] = 500;
  HitRadius.r[eid] = 4.0;

  // Vehicle stats - slow but powerful
  GroundVehicle.type[eid] = GroundVehicleType.ATST;
  GroundVehicle.maxSpeed[eid] = 6;          // Slow walker
  GroundVehicle.acceleration[eid] = 4;
  GroundVehicle.turnRate[eid] = 1.2;
  GroundVehicle.weaponCooldown[eid] = 0;
  GroundVehicle.weaponCooldownMax[eid] = 0.4;

  // Enterable - 2 seats (pilot + gunner)
  Enterable.seatCount[eid] = 2;
  Enterable.seatsFilled[eid] = 0;
  Enterable.enterRadius[eid] = 5;

  // Heavy blasters
  BlasterWeapon.damage[eid] = 35;
  BlasterWeapon.fireRate[eid] = 4;
  BlasterWeapon.cooldownRemaining[eid] = 0;
  BlasterWeapon.range[eid] = 120;
  BlasterWeapon.spread[eid] = 0.06;

  // Initialize input
  GroundInput.moveX[eid] = 0;
  GroundInput.moveZ[eid] = 0;
  GroundInput.jump[eid] = 0;
  GroundInput.sprint[eid] = 0;
  GroundInput.crouch[eid] = 0;
  GroundInput.aimYaw[eid] = 0;
  GroundInput.aimPitch[eid] = 0;
  GroundInput.interact[eid] = 0;
  GroundInput.firePrimary[eid] = 0;
  GroundInput.dodge[eid] = 0;
  GroundInput.throwGrenade[eid] = 0;

  return eid;
}
