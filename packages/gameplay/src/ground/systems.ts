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
  Grenade
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
// BLASTER WEAPON SYSTEM (hitscan)
// ─────────────────────────────────────────────────────────────────────────────

export function blasterSystem(
  world: IWorld,
  physics: PhysicsWorld,
  dt: number
): void {
  blasterFrameCounter++;
  const shooters = blasterQuery(world);
  const targets = groundCombatantQuery(world);

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

    const sx = Transform.x[eid] ?? 0;
    const sy = Transform.y[eid] ?? 0;
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

    const range = BlasterWeapon.range[eid] ?? 150;
    const damage = BlasterWeapon.damage[eid] ?? 20;
    const myTeam = Team.id[eid] ?? 0;

    // Simple target check (no physics raycast for now, just proximity in line)
    for (const tid of targets) {
      if (tid === eid) continue;
      if ((Team.id[tid] ?? -1) === myTeam) continue;

      // Skip targets with active i-frames (dodge rolling)
      if (hasComponent(world, DodgeRoll, tid)) {
        if ((DodgeRoll.iFrames[tid] ?? 0) !== 0) continue;
      }

      const tx = Transform.x[tid] ?? 0;
      const ty = Transform.y[tid] ?? 0;
      const tz = Transform.z[tid] ?? 0;

      const dx = tx - sx;
      const dy = ty - sy;
      const dz = tz - sz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > range) continue;

      // Check if target is roughly in aim direction
      const dotProduct = (dx * tmpForward.x + dy * tmpForward.y + dz * tmpForward.z) / dist;
      const hitRadius = HitRadius.r[tid] ?? 0.5;
      const coneAngle = Math.asin(Math.min(1, hitRadius / dist));

      if (dotProduct > Math.cos(coneAngle + spread)) {
        // Hit!
        Health.hp[tid] = (Health.hp[tid] ?? 0) - damage;

        groundImpactEvents.push({
          x: tx,
          y: ty,
          z: tz,
          shooterTeam: myTeam,
          killed: (Health.hp[tid] ?? 0) <= 0
        });

        if ((Health.hp[tid] ?? 0) <= 0) {
          removeEntity(world, tid);
        }
        break; // Only one hit per shot
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
// GROUND AI SYSTEM (basic state machine)
// ─────────────────────────────────────────────────────────────────────────────

export const enum GroundAIState {
  Idle = 0,
  MoveTo = 1,
  Attack = 2,
  Capture = 3,
  Flee = 4
}

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

    // Check for nearby enemies
    let nearestEnemy = -1;
    let nearestEnemyDist = Infinity;

    for (const tid of combatants) {
      if (tid === eid) continue;
      if ((Team.id[tid] ?? -1) === myTeam) continue;

      const dx = (Transform.x[tid] ?? 0) - sx;
      const dy = (Transform.y[tid] ?? 0) - sy;
      const dz = (Transform.z[tid] ?? 0) - sz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < nearestEnemyDist) {
        nearestEnemyDist = dist;
        nearestEnemy = tid;
      }
    }

    // State transitions
    const aggression = GroundAI.aggression[eid] ?? 0.5;
    const engageRange = 30 + aggression * 20;
    const fleeHealthThreshold = 20 + (1 - aggression) * 30;

    const hp = Health.hp[eid] ?? 100;
    if (hp < fleeHealthThreshold && state !== GroundAIState.Flee) {
      state = GroundAIState.Flee;
      stateTime = 0;
    } else if (nearestEnemy >= 0 && nearestEnemyDist < engageRange && state !== GroundAIState.Attack) {
      state = GroundAIState.Attack;
      stateTime = 0;
      GroundAI.targetEid[eid] = nearestEnemy;
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

    // Execute state behavior
    let moveX = 0;
    let moveZ = 0;
    let wantsFire = 0;

    if (state === GroundAIState.MoveTo || state === GroundAIState.Capture) {
      const wx = GroundAI.waypointX[eid] ?? 0;
      const wz = GroundAI.waypointZ[eid] ?? 0;
      const dx = wx - sx;
      const dz = wz - sz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 2) {
        // Move toward waypoint
        const yaw = Math.atan2(-dx, -dz);
        GroundInput.aimYaw[eid] = yaw;
        moveZ = 1; // Forward
      } else {
        state = GroundAIState.Capture;
      }
    } else if (state === GroundAIState.Attack) {
      const tid = GroundAI.targetEid[eid] ?? -1;
      if (tid >= 0 && hasComponent(world, Transform, tid)) {
        const tx = Transform.x[tid] ?? 0;
        const tz = Transform.z[tid] ?? 0;
        const dx = tx - sx;
        const dz = tz - sz;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Face target
        const yaw = Math.atan2(-dx, -dz);
        GroundInput.aimYaw[eid] = yaw;

        if (dist > 15) {
          moveZ = 1; // Advance
        } else if (dist < 8) {
          moveZ = -0.5; // Back up
        }

        wantsFire = 1;
      } else {
        state = GroundAIState.Idle;
        stateTime = 0;
      }
    } else if (state === GroundAIState.Flee) {
      if (nearestEnemy >= 0) {
        const tx = Transform.x[nearestEnemy] ?? 0;
        const tz = Transform.z[nearestEnemy] ?? 0;
        const dx = sx - tx; // Away from enemy
        const dz = sz - tz;
        const yaw = Math.atan2(-dx, -dz);
        GroundInput.aimYaw[eid] = yaw;
        moveZ = 1; // Run away
      }
      if (stateTime > 5) {
        state = GroundAIState.Idle;
        stateTime = 0;
      }
    }

    // Apply AI decisions to input components
    GroundInput.moveX[eid] = moveX;
    GroundInput.moveZ[eid] = moveZ;
    GroundInput.firePrimary[eid] = wantsFire;
    GroundInput.sprint[eid] = state === GroundAIState.Flee ? 1 : 0;

    GroundAI.state[eid] = state;
    GroundAI.stateTime[eid] = stateTime;
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
