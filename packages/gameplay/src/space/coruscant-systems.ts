/**
 * Battle of Coruscant - ECS Systems Integration
 *
 * This file provides the bitECS systems and components needed to run
 * the Battle of Coruscant mission. It integrates with the existing
 * space combat systems in systems.ts.
 *
 * THREE.JS / REACT THREE FIBER NOTES:
 * - Capital ships should use <LOD> component from @react-three/drei
 * - Buzz droid effects use <Points> with custom sparkShader
 * - Shield impacts use <Sphere> with animated opacity
 * - Large battles benefit from <InstancedMesh> for fighters
 */

import { defineComponent, Types, IWorld, addEntity, addComponent, removeEntity, hasComponent, defineQuery } from "bitecs";
import { Quaternion, Vector3, Euler } from "three";
import { createRng, deriveSeed } from "@xwingz/procgen";
import {
  Transform,
  Velocity,
  AngularVelocity,
  Team,
  Ship,
  LaserWeapon,
  Health,
  HitRadius,
  Shield,
  Targetable,
  AIControlled,
  FighterBrain
} from "./components";

// Frame counter for deterministic buzz droid escape
let buzzDroidFrameCounter = 0;

// ============================================================================
// CORUSCANT-SPECIFIC COMPONENTS
// ============================================================================

/**
 * Marks an entity as a capital ship with weak points.
 */
export const CapitalShip = defineComponent({
  shipType: Types.ui8,       // 0=venator, 1=providence, 2=munificent, 3=invisible_hand
  team: Types.i8,            // 0=republic, 1=separatist
  isObjective: Types.ui8,    // 1 if this is mission-critical
  weakPointCount: Types.ui8  // Number of weak points
});

/**
 * A targetable weak point on a capital ship.
 */
export const WeakPoint = defineComponent({
  parentShipEid: Types.i32,  // Entity ID of parent capital ship
  wpType: Types.ui8,         // 0=shield_gen, 1=bridge, 2=hangar, 3=turbolaser
  isCritical: Types.ui8,     // 1 if destroying this advances mission
  isDestroyed: Types.ui8     // 1 if already destroyed
});

/**
 * Buzz droid swarm entity - attaches to player and deals DOT.
 */
export const BuzzDroidSwarm = defineComponent({
  attachedToEid: Types.i32,     // -1 if not attached
  damagePerSecond: Types.f32,
  attachTime: Types.f32,        // How long attached
  droidCount: Types.ui8         // Visual/damage scaling
});

/**
 * Marks the player as having buzz droids attached.
 */
export const BuzzDroidVictim = defineComponent({
  swarmEid: Types.i32,          // Entity ID of attached swarm
  totalDamageReceived: Types.f32,
  canBarrelRoll: Types.ui8      // 1 if not on cooldown
});

/**
 * Separatist droid brain - extended AI for different droid types.
 */
export const DroidBrain = defineComponent({
  droidType: Types.ui8,         // 0=vulture, 1=tri_fighter, 2=hyena
  squadId: Types.ui8,           // For formation flying
  formationSlot: Types.ui8,     // Position in formation
  targetPriority: Types.ui8,    // 0=player, 1=friendlies, 2=capital_ships
  attackRunTimer: Types.f32     // For bomber runs
});

/**
 * Boarding craft escort objective.
 */
export const BoardingCraft = defineComponent({
  targetShipEid: Types.i32,     // Capital ship to dock with
  dockingProgress: Types.f32,   // 0-1, mission complete at 1
  escortRequired: Types.ui8     // 1 if needs escort
});

/**
 * Clone wingman AI extension.
 */
export const CloneWingman = defineComponent({
  callsignId: Types.ui8,        // Index into CLONE_WINGMEN
  formWithPlayer: Types.ui8,    // 1 to stay in formation
  protectObjective: Types.ui8   // 1 to prioritize objective defense
});

/**
 * Turbolaser battery on capital ships - fires at fighters.
 */
export const Turbolaser = defineComponent({
  parentShipEid: Types.i32,
  cooldown: Types.f32,
  cooldownRemaining: Types.f32,
  range: Types.f32,
  damage: Types.f32,
  targetEid: Types.i32
});

// ============================================================================
// QUERIES
// ============================================================================

const capitalShipQuery = defineQuery([CapitalShip, Transform, Health]);
const weakPointQuery = defineQuery([WeakPoint, Transform, Health, HitRadius]);
const buzzSwarmQuery = defineQuery([BuzzDroidSwarm, Transform]);
const buzzVictimQuery = defineQuery([BuzzDroidVictim]);
const droidQuery = defineQuery([DroidBrain, AIControlled, FighterBrain, Ship, Transform]);
const boardingCraftQuery = defineQuery([BoardingCraft, Transform, Health]);
const wingmanQuery = defineQuery([CloneWingman, AIControlled, FighterBrain, Ship, Transform]);
const turbolaserQuery = defineQuery([Turbolaser, Transform]);

// Temp vectors
const tmpVec = new Vector3();
const tmpVec2 = new Vector3();
const tmpQuat = new Quaternion();

// ============================================================================
// CAPITAL SHIP SYSTEM
// ============================================================================

/**
 * Updates capital ship behavior - minimal movement, damage tracking.
 */
export function capitalShipSystem(world: IWorld, dt: number): void {
  const ships = capitalShipQuery(world);

  for (const eid of ships) {
    // Capital ships move slowly in formation
    const vx = Velocity.vx[eid] ?? 0;
    const vy = Velocity.vy[eid] ?? 0;
    const vz = Velocity.vz[eid] ?? 0;

    // Very slow drift
    Transform.x[eid] = (Transform.x[eid] ?? 0) + vx * dt;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + vy * dt;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + vz * dt;

    // Check if destroyed
    const hp = Health.hp[eid] ?? 0;
    if (hp <= 0) {
      // Capital ship destroyed - handled by mission state
      // Don't remove entity - let mission controller handle
    }
  }
}

// ============================================================================
// WEAK POINT SYSTEM
// ============================================================================

export type WeakPointDestroyedEvent = {
  weakPointEid: number;
  parentShipEid: number;
  wpType: number;
  isCritical: boolean;
};

const weakPointDestroyedEvents: WeakPointDestroyedEvent[] = [];

export function consumeWeakPointEvents(): WeakPointDestroyedEvent[] {
  return weakPointDestroyedEvents.splice(0, weakPointDestroyedEvents.length);
}

/**
 * Updates weak point positions relative to parent ship and checks destruction.
 */
export function weakPointSystem(world: IWorld, dt: number): void {
  const weakPoints = weakPointQuery(world);

  for (const eid of weakPoints) {
    const isDestroyed = WeakPoint.isDestroyed[eid] ?? 0;
    if (isDestroyed) continue;

    const hp = Health.hp[eid] ?? 0;
    if (hp <= 0) {
      // Mark as destroyed
      WeakPoint.isDestroyed[eid] = 1;

      // Emit event
      weakPointDestroyedEvents.push({
        weakPointEid: eid,
        parentShipEid: WeakPoint.parentShipEid[eid] ?? -1,
        wpType: WeakPoint.wpType[eid] ?? 0,
        isCritical: (WeakPoint.isCritical[eid] ?? 0) === 1
      });
    }
  }
}

// ============================================================================
// BUZZ DROID SYSTEM
// ============================================================================

export type BuzzDroidDamageEvent = {
  victimEid: number;
  damage: number;
  shakenOff: boolean;
};

const buzzDroidEvents: BuzzDroidDamageEvent[] = [];

export function consumeBuzzDroidEvents(): BuzzDroidDamageEvent[] {
  return buzzDroidEvents.splice(0, buzzDroidEvents.length);
}

/**
 * Buzz droid swarm behavior:
 * - Seeks player if not attached
 * - Deals DOT when attached
 * - Can be shaken off with barrel roll
 */
export function buzzDroidSystem(
  world: IWorld,
  dt: number,
  barrelRollInput: boolean,
  barrelRollCooldown: { value: number }
): void {
  buzzDroidFrameCounter++;
  const swarms = buzzSwarmQuery(world);
  const victims = buzzVictimQuery(world);

  // Update barrel roll cooldown
  if (barrelRollCooldown.value > 0) {
    barrelRollCooldown.value = Math.max(0, barrelRollCooldown.value - dt);
  }

  for (const swarmEid of swarms) {
    const attachedTo = BuzzDroidSwarm.attachedToEid[swarmEid] ?? -1;

    if (attachedTo < 0) {
      // Seeking behavior - handled by spawn system
      continue;
    }

    // Attached - deal damage
    if (!hasComponent(world, Transform, attachedTo)) {
      // Target no longer exists
      BuzzDroidSwarm.attachedToEid[swarmEid] = -1;
      continue;
    }

    // Follow attached entity
    Transform.x[swarmEid] = Transform.x[attachedTo] ?? 0;
    Transform.y[swarmEid] = (Transform.y[attachedTo] ?? 0) + 2; // Slightly above
    Transform.z[swarmEid] = Transform.z[attachedTo] ?? 0;

    // Accumulate attach time
    const attachTime = (BuzzDroidSwarm.attachTime[swarmEid] ?? 0) + dt;
    BuzzDroidSwarm.attachTime[swarmEid] = attachTime;

    // Calculate and apply damage
    const baseDPS = BuzzDroidSwarm.damagePerSecond[swarmEid] ?? 15;
    const multiplier = 1 + Math.min(2, attachTime * 0.15);
    const damage = baseDPS * multiplier * dt;

    // Apply damage directly to hull (bypasses shields)
    if (hasComponent(world, Health, attachedTo)) {
      Health.hp[attachedTo] = (Health.hp[attachedTo] ?? 0) - damage;

      buzzDroidEvents.push({
        victimEid: attachedTo,
        damage,
        shakenOff: false
      });
    }

    // Check for barrel roll escape
    if (barrelRollInput && barrelRollCooldown.value <= 0) {
      const successChance = Math.max(0.35, 0.85 - attachTime * 0.1);

      // Deterministic escape check based on swarm entity and frame counter
      const escapeSeed = deriveSeed(BigInt(swarmEid), "buzz_escape", buzzDroidFrameCounter.toString());
      const escapeRng = createRng(escapeSeed);
      if (escapeRng.nextF01() < successChance) {
        // Success! Detach and destroy swarm
        BuzzDroidSwarm.attachedToEid[swarmEid] = -1;
        removeEntity(world, swarmEid);

        if (hasComponent(world, BuzzDroidVictim, attachedTo)) {
          BuzzDroidVictim.swarmEid[attachedTo] = -1;
        }

        buzzDroidEvents.push({
          victimEid: attachedTo,
          damage: 0,
          shakenOff: true
        });

        barrelRollCooldown.value = 3.0;
      } else {
        // Failed attempt
        barrelRollCooldown.value = 1.5;
      }
    }
  }
}

// ============================================================================
// SEPARATIST DROID AI SYSTEM
// ============================================================================

/**
 * Extended AI for Separatist droid fighters.
 * Vultures: Standard dogfight, swarm tactics
 * Tri-fighters: Aggressive pursuit, high maneuverability
 * Hyena bombers: Attack runs on capital ships
 */
export function droidAISystem(world: IWorld, dt: number, objectivePositions: {
  playerPos: Vector3 | null;
  capitalShips: Array<{ eid: number; pos: Vector3; team: number }>;
  boardingCraft: Vector3 | null;
}): void {
  const droids = droidQuery(world);

  for (const eid of droids) {
    const droidType = DroidBrain.droidType[eid] ?? 0;
    const targetPriority = DroidBrain.targetPriority[eid] ?? 0;

    // Select target based on priority and droid type
    let targetPos: Vector3 | null = null;
    let targetEid = FighterBrain.targetEid[eid] ?? -1;

    switch (targetPriority) {
      case 0: // Player
        targetPos = objectivePositions.playerPos;
        break;

      case 1: // Friendlies (boarding craft or wingmen)
        if (objectivePositions.boardingCraft) {
          targetPos = objectivePositions.boardingCraft;
        }
        break;

      case 2: // Capital ships (bombers)
        const friendlyShips = objectivePositions.capitalShips.filter(s => s.team === 0);
        if (friendlyShips.length > 0) {
          // Pick nearest
          const sx = Transform.x[eid] ?? 0;
          const sy = Transform.y[eid] ?? 0;
          const sz = Transform.z[eid] ?? 0;

          let nearest = friendlyShips[0]!;
          let nearestDist = Number.MAX_VALUE;

          for (const ship of friendlyShips) {
            const dx = ship.pos.x - sx;
            const dy = ship.pos.y - sy;
            const dz = ship.pos.z - sz;
            const dist = dx * dx + dy * dy + dz * dz;
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = ship;
            }
          }

          targetPos = nearest.pos;
        }
        break;
    }

    // Droid-type specific behavior modifiers
    if (droidType === 2) {
      // Hyena bomber - attack run behavior
      const runTimer = (DroidBrain.attackRunTimer[eid] ?? 0) + dt;
      DroidBrain.attackRunTimer[eid] = runTimer;

      // Bombers do strafing runs then pull away
      if (runTimer > 8) {
        DroidBrain.attackRunTimer[eid] = 0;
        // Temporarily switch to break-off state
        FighterBrain.state[eid] = 3; // BreakOff
        FighterBrain.stateTime[eid] = 0;
      }
    }

    // Update aggression based on droid type
    if (droidType === 1) {
      // Tri-fighters are very aggressive
      FighterBrain.aggression[eid] = 0.9;
    } else if (droidType === 2) {
      // Bombers are less aggressive in dogfights
      FighterBrain.aggression[eid] = 0.4;
    }
  }
}

// ============================================================================
// BOARDING CRAFT SYSTEM
// ============================================================================

export type BoardingCraftEvent = {
  type: "launched" | "docking" | "docked" | "destroyed";
  progress?: number;
};

const boardingCraftEvents: BoardingCraftEvent[] = [];

export function consumeBoardingCraftEvents(): BoardingCraftEvent[] {
  return boardingCraftEvents.splice(0, boardingCraftEvents.length);
}

/**
 * Boarding craft movement and docking progress.
 */
export function boardingCraftSystem(world: IWorld, dt: number): void {
  const crafts = boardingCraftQuery(world);

  for (const eid of crafts) {
    const hp = Health.hp[eid] ?? 0;

    if (hp <= 0) {
      boardingCraftEvents.push({ type: "destroyed" });
      continue;
    }

    const targetEid = BoardingCraft.targetShipEid[eid] ?? -1;
    if (targetEid < 0 || !hasComponent(world, Transform, targetEid)) continue;

    // Move toward target
    const cx = Transform.x[eid] ?? 0;
    const cy = Transform.y[eid] ?? 0;
    const cz = Transform.z[eid] ?? 0;

    const tx = Transform.x[targetEid] ?? 0;
    const ty = (Transform.y[targetEid] ?? 0) + 50; // Dock at hangar level
    const tz = (Transform.z[targetEid] ?? 0) + 150; // Approach from rear

    const dx = tx - cx;
    const dy = ty - cy;
    const dz = tz - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > 50) {
      // Move toward target
      const speed = 80; // Slower than fighters
      const move = Math.min(speed * dt, dist);
      const inv = move / dist;

      Transform.x[eid] = cx + dx * inv;
      Transform.y[eid] = cy + dy * inv;
      Transform.z[eid] = cz + dz * inv;

      // Face target
      const yaw = Math.atan2(dx, -dz);
      tmpQuat.setFromEuler(new Euler(0, yaw, 0));
      Transform.qx[eid] = tmpQuat.x;
      Transform.qy[eid] = tmpQuat.y;
      Transform.qz[eid] = tmpQuat.z;
      Transform.qw[eid] = tmpQuat.w;

    } else {
      // Docking
      const progress = (BoardingCraft.dockingProgress[eid] ?? 0) + dt * 0.1;
      BoardingCraft.dockingProgress[eid] = Math.min(1, progress);

      if (progress < 1) {
        boardingCraftEvents.push({ type: "docking", progress });
      } else {
        boardingCraftEvents.push({ type: "docked" });
      }
    }
  }
}

// ============================================================================
// TURBOLASER SYSTEM
// ============================================================================

/**
 * Capital ship turbolasers fire at nearby enemy fighters.
 */
export function turbolaserSystem(world: IWorld, dt: number, enemyEids: number[]): void {
  const turbolasers = turbolaserQuery(world);

  for (const eid of turbolasers) {
    const cdRem = (Turbolaser.cooldownRemaining[eid] ?? 0) - dt;
    Turbolaser.cooldownRemaining[eid] = Math.max(0, cdRem);

    if (cdRem > 0) continue;

    const range = Turbolaser.range[eid] ?? 800;
    const range2 = range * range;

    const tx = Transform.x[eid] ?? 0;
    const ty = Transform.y[eid] ?? 0;
    const tz = Transform.z[eid] ?? 0;

    // Find nearest enemy in range
    let nearestEid = -1;
    let nearestDist = Number.MAX_VALUE;

    for (const enemyEid of enemyEids) {
      if (!hasComponent(world, Transform, enemyEid)) continue;
      if (!hasComponent(world, Health, enemyEid)) continue;
      if ((Health.hp[enemyEid] ?? 0) <= 0) continue;

      const ex = Transform.x[enemyEid] ?? 0;
      const ey = Transform.y[enemyEid] ?? 0;
      const ez = Transform.z[enemyEid] ?? 0;

      const dx = ex - tx;
      const dy = ey - ty;
      const dz = ez - tz;
      const dist2 = dx * dx + dy * dy + dz * dz;

      if (dist2 < range2 && dist2 < nearestDist) {
        nearestDist = dist2;
        nearestEid = enemyEid;
      }
    }

    if (nearestEid >= 0) {
      // Fire!
      Turbolaser.cooldownRemaining[eid] = Turbolaser.cooldown[eid] ?? 2.0;
      Turbolaser.targetEid[eid] = nearestEid;

      // Apply damage directly (simplified - no projectile)
      const damage = Turbolaser.damage[eid] ?? 25;

      // Check shields first
      if (hasComponent(world, Shield, nearestEid)) {
        const sp = Shield.sp[nearestEid] ?? 0;
        if (sp > 0) {
          Shield.sp[nearestEid] = Math.max(0, sp - damage);
          Shield.lastHit[nearestEid] = 0;
        } else {
          Health.hp[nearestEid] = (Health.hp[nearestEid] ?? 0) - damage;
        }
      } else {
        Health.hp[nearestEid] = (Health.hp[nearestEid] ?? 0) - damage;
      }
    }
  }
}

// ============================================================================
// SPAWN HELPERS
// ============================================================================

export type CoruscantSpawnResult = {
  entityId: number;
  type: "vulture" | "tri_fighter" | "hyena" | "capital" | "weak_point" | "buzz_swarm" | "boarding_craft" | "wingman";
};

/**
 * Spawns a Separatist droid fighter.
 */
export function spawnSeparatistFighter(
  world: IWorld,
  type: "vulture" | "tri_fighter" | "hyena",
  position: [number, number, number],
  rotation: [number, number, number, number],
  velocity: [number, number, number],
  targetPriority: 0 | 1 | 2,
  aggression: number
): CoruscantSpawnResult {
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Ship, eid);
  addComponent(world, LaserWeapon, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, Shield, eid);
  addComponent(world, Targetable, eid);
  addComponent(world, AIControlled, eid);
  addComponent(world, FighterBrain, eid);
  addComponent(world, DroidBrain, eid);

  // Position & rotation
  Transform.x[eid] = position[0];
  Transform.y[eid] = position[1];
  Transform.z[eid] = position[2];
  Transform.qx[eid] = rotation[0];
  Transform.qy[eid] = rotation[1];
  Transform.qz[eid] = rotation[2];
  Transform.qw[eid] = rotation[3];

  // Velocity
  Velocity.vx[eid] = velocity[0];
  Velocity.vy[eid] = velocity[1];
  Velocity.vz[eid] = velocity[2];

  AngularVelocity.wx[eid] = 0;
  AngularVelocity.wy[eid] = 0;
  AngularVelocity.wz[eid] = 0;

  Team.id[eid] = 1; // Separatist

  // Type-specific stats
  const droidTypeId = type === "vulture" ? 0 : type === "tri_fighter" ? 1 : 2;
  DroidBrain.droidType[eid] = droidTypeId;
  DroidBrain.targetPriority[eid] = targetPriority;
  DroidBrain.attackRunTimer[eid] = 0;

  // Stats based on type
  switch (type) {
    case "vulture":
      Ship.maxSpeed[eid] = 290;
      Ship.accel[eid] = 160;
      Ship.turnRate[eid] = 1.7;
      Ship.throttle[eid] = 0.8;
      LaserWeapon.cooldown[eid] = 0.16;
      LaserWeapon.damage[eid] = 7;
      LaserWeapon.projectileSpeed[eid] = 880;
      LaserWeapon.cooldownRemaining[eid] = 0;
      Health.hp[eid] = 45;
      Health.maxHp[eid] = 45;
      HitRadius.r[eid] = 8;
      Shield.sp[eid] = 0;
      Shield.maxSp[eid] = 0;
      Shield.regenRate[eid] = 0;
      Shield.lastHit[eid] = 999;
      break;

    case "tri_fighter":
      Ship.maxSpeed[eid] = 310;
      Ship.accel[eid] = 180;
      Ship.turnRate[eid] = 1.9;
      Ship.throttle[eid] = 0.9;
      LaserWeapon.cooldown[eid] = 0.12;
      LaserWeapon.damage[eid] = 9;
      LaserWeapon.projectileSpeed[eid] = 920;
      LaserWeapon.cooldownRemaining[eid] = 0;
      Health.hp[eid] = 55;
      Health.maxHp[eid] = 55;
      HitRadius.r[eid] = 7;
      Shield.sp[eid] = 0;
      Shield.maxSp[eid] = 0;
      Shield.regenRate[eid] = 0;
      Shield.lastHit[eid] = 999;
      break;

    case "hyena":
      Ship.maxSpeed[eid] = 220;
      Ship.accel[eid] = 100;
      Ship.turnRate[eid] = 1.0;
      Ship.throttle[eid] = 0.7;
      LaserWeapon.cooldown[eid] = 0.4;
      LaserWeapon.damage[eid] = 35;
      LaserWeapon.projectileSpeed[eid] = 600;
      LaserWeapon.cooldownRemaining[eid] = 0;
      Health.hp[eid] = 120;
      Health.maxHp[eid] = 120;
      HitRadius.r[eid] = 12;
      Shield.sp[eid] = 30;
      Shield.maxSp[eid] = 30;
      Shield.regenRate[eid] = 3;
      Shield.lastHit[eid] = 999;
      break;
  }

  // AI brain
  FighterBrain.state[eid] = 0;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = aggression;
  FighterBrain.evadeBias[eid] = type === "tri_fighter" ? 0.5 : 0.3;
  FighterBrain.targetEid[eid] = -1;

  return { entityId: eid, type };
}

/**
 * Spawns a buzz droid swarm.
 */
export function spawnBuzzDroidSwarm(
  world: IWorld,
  position: [number, number, number],
  targetEid: number
): CoruscantSpawnResult {
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, BuzzDroidSwarm, eid);
  addComponent(world, Team, eid);

  Transform.x[eid] = position[0];
  Transform.y[eid] = position[1];
  Transform.z[eid] = position[2];
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  Team.id[eid] = 1;

  BuzzDroidSwarm.attachedToEid[eid] = targetEid;
  BuzzDroidSwarm.damagePerSecond[eid] = 15;
  BuzzDroidSwarm.attachTime[eid] = 0;
  BuzzDroidSwarm.droidCount[eid] = 8;

  // Mark victim
  if (hasComponent(world, Health, targetEid)) {
    addComponent(world, BuzzDroidVictim, targetEid);
    BuzzDroidVictim.swarmEid[targetEid] = eid;
    BuzzDroidVictim.totalDamageReceived[targetEid] = 0;
    BuzzDroidVictim.canBarrelRoll[targetEid] = 1;
  }

  return { entityId: eid, type: "buzz_swarm" };
}

/**
 * Spawns a capital ship with weak points.
 */
export function spawnCapitalShip(
  world: IWorld,
  shipType: "venator" | "providence" | "munificent" | "invisible_hand",
  team: 0 | 1,
  position: [number, number, number],
  rotation: [number, number, number, number],
  hp: number,
  isObjective: boolean,
  weakPoints: Array<{
    localPos: [number, number, number];
    radius: number;
    hp: number;
    type: "shield_generator" | "bridge" | "hangar" | "turbolaser_battery";
    isCritical: boolean;
  }>
): { shipEid: number; weakPointEids: number[] } {
  const shipEid = addEntity(world);

  addComponent(world, Transform, shipEid);
  addComponent(world, Velocity, shipEid);
  addComponent(world, Health, shipEid);
  addComponent(world, Team, shipEid);
  addComponent(world, CapitalShip, shipEid);

  Transform.x[shipEid] = position[0];
  Transform.y[shipEid] = position[1];
  Transform.z[shipEid] = position[2];
  Transform.qx[shipEid] = rotation[0];
  Transform.qy[shipEid] = rotation[1];
  Transform.qz[shipEid] = rotation[2];
  Transform.qw[shipEid] = rotation[3];

  Velocity.vx[shipEid] = team === 0 ? 5 : -5; // Slow drift
  Velocity.vy[shipEid] = 0;
  Velocity.vz[shipEid] = 0;

  Health.hp[shipEid] = hp;
  Health.maxHp[shipEid] = hp;

  Team.id[shipEid] = team;

  const typeId = shipType === "venator" ? 0 :
                 shipType === "providence" ? 1 :
                 shipType === "munificent" ? 2 : 3;
  CapitalShip.shipType[shipEid] = typeId;
  CapitalShip.team[shipEid] = team;
  CapitalShip.isObjective[shipEid] = isObjective ? 1 : 0;
  CapitalShip.weakPointCount[shipEid] = weakPoints.length;

  // Spawn weak points
  const weakPointEids: number[] = [];

  for (const wp of weakPoints) {
    const wpEid = addEntity(world);

    addComponent(world, Transform, wpEid);
    addComponent(world, Health, wpEid);
    addComponent(world, HitRadius, wpEid);
    addComponent(world, WeakPoint, wpEid);
    addComponent(world, Targetable, wpEid);
    addComponent(world, Team, wpEid);

    // Position relative to ship (simplified - should use quaternion transform)
    Transform.x[wpEid] = position[0] + wp.localPos[0];
    Transform.y[wpEid] = position[1] + wp.localPos[1];
    Transform.z[wpEid] = position[2] + wp.localPos[2];
    Transform.qx[wpEid] = 0;
    Transform.qy[wpEid] = 0;
    Transform.qz[wpEid] = 0;
    Transform.qw[wpEid] = 1;

    Health.hp[wpEid] = wp.hp;
    Health.maxHp[wpEid] = wp.hp;
    HitRadius.r[wpEid] = wp.radius;

    Team.id[wpEid] = team;

    const wpTypeId = wp.type === "shield_generator" ? 0 :
                     wp.type === "bridge" ? 1 :
                     wp.type === "hangar" ? 2 : 3;
    WeakPoint.parentShipEid[wpEid] = shipEid;
    WeakPoint.wpType[wpEid] = wpTypeId;
    WeakPoint.isCritical[wpEid] = wp.isCritical ? 1 : 0;
    WeakPoint.isDestroyed[wpEid] = 0;

    weakPointEids.push(wpEid);
  }

  return { shipEid, weakPointEids };
}

/**
 * Spawns the boarding craft.
 */
export function spawnBoardingCraft(
  world: IWorld,
  position: [number, number, number],
  targetShipEid: number,
  hp: number
): CoruscantSpawnResult {
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, Team, eid);
  addComponent(world, BoardingCraft, eid);
  addComponent(world, Targetable, eid);

  Transform.x[eid] = position[0];
  Transform.y[eid] = position[1];
  Transform.z[eid] = position[2];
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  Health.hp[eid] = hp;
  Health.maxHp[eid] = hp;
  HitRadius.r[eid] = 20;

  Team.id[eid] = 0; // Republic

  BoardingCraft.targetShipEid[eid] = targetShipEid;
  BoardingCraft.dockingProgress[eid] = 0;
  BoardingCraft.escortRequired[eid] = 1;

  return { entityId: eid, type: "boarding_craft" };
}
