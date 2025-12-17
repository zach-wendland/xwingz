/**
 * AT-AT Walker Systems
 *
 * Dedicated systems for AT-AT walker behavior.
 * Isolated from main systems.ts to prevent god script bloat.
 */

import { defineQuery, hasComponent } from "bitecs";
import type { IWorld } from "bitecs";
import { SeededRNG } from "@xwingz/core";
import { Transform, Health, Team } from "../space/components";
import { ATATWalker, ATAT_STATE, ShieldGenerator } from "./hoth-components";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

const atatQuery = defineQuery([ATATWalker, Transform, Health, Team]);
const shieldGenQuery = defineQuery([ShieldGenerator, Transform]);

// ─────────────────────────────────────────────────────────────────────────────
// AT-AT Movement System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moves AT-ATs toward their target position (usually the shield generator).
 * AT-ATs advance slowly but inexorably unless tripped.
 */
export function atatWalkerSystem(world: IWorld, dt: number): void {
  const entities = atatQuery(world);

  for (const eid of entities) {
    const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;

    // Only move when advancing
    if (state !== ATAT_STATE.ADVANCING) continue;

    const x = Transform.x[eid] ?? 0;
    const z = Transform.z[eid] ?? 0;
    const targetX = ATATWalker.targetX[eid] ?? 0;
    const targetZ = ATATWalker.targetZ[eid] ?? 0;
    const speed = ATATWalker.walkSpeed[eid] ?? 8;

    // Direction to target
    const dx = targetX - x;
    const dz = targetZ - z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > 5) { // Stop when close to target
      const nx = dx / dist;
      const nz = dz / dist;

      // Move toward target
      Transform.x[eid] = x + nx * speed * dt;
      Transform.z[eid] = z + nz * speed * dt;

      // Face direction of movement
      Transform.qy[eid] = Math.sin(Math.atan2(nx, nz) / 2);
      Transform.qw[eid] = Math.cos(Math.atan2(nx, nz) / 2);

      // Update leg animation phase
      ATATWalker.legPhase[eid] = ((ATATWalker.legPhase[eid] ?? 0) + dt * 2) % (Math.PI * 2);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AT-AT Targeting System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AT-AT targeting prioritization:
 * 1. Shield generator (primary objective)
 * 2. Turret emplacements
 * 3. Vehicles (snowspeeders, transports)
 * 4. Infantry (only chin guns, low priority)
 */
export function atatTargetingSystem(world: IWorld, _dt: number): void {
  const atats = atatQuery(world);
  const shieldGens = shieldGenQuery(world);

  for (const eid of atats) {
    // Always target shield generator if it exists
    if (shieldGens.length > 0) {
      const sgEid = shieldGens[0]!;
      ATATWalker.targetX[eid] = Transform.x[sgEid] ?? 0;
      ATATWalker.targetZ[eid] = Transform.z[sgEid] ?? 0;

      // Aim head at shield generator
      const dx = (Transform.x[sgEid] ?? 0) - (Transform.x[eid] ?? 0);
      const dz = (Transform.z[sgEid] ?? 0) - (Transform.z[eid] ?? 0);
      ATATWalker.headYaw[eid] = Math.atan2(dx, dz);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AT-AT Weapon System
// ─────────────────────────────────────────────────────────────────────────────

// Events for rendering
export interface ATATFireEvent {
  eid: number;
  weaponType: "chin" | "temple";
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

const fireEvents: ATATFireEvent[] = [];

export function consumeATATFireEvents(): ATATFireEvent[] {
  const events = [...fireEvents];
  fireEvents.length = 0;
  return events;
}

/**
 * AT-AT weapon firing.
 * - Chin lasers: High damage, slow rate, used against structures
 * - Temple blasters: Lower damage, faster rate, used against vehicles/infantry
 */
export function atatWeaponSystem(world: IWorld, dt: number): void {
  const entities = atatQuery(world);
  const shieldGens = shieldGenQuery(world);

  for (const eid of entities) {
    const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;

    // Can only fire when advancing or firing state
    if (state !== ATAT_STATE.ADVANCING && state !== ATAT_STATE.FIRING) continue;

    // Update cooldowns
    ATATWalker.chinLaserCooldown[eid] = Math.max(0, (ATATWalker.chinLaserCooldown[eid] ?? 0) - dt);
    ATATWalker.templeLaserCooldown[eid] = Math.max(0, (ATATWalker.templeLaserCooldown[eid] ?? 0) - dt);

    const x = Transform.x[eid] ?? 0;
    const y = Transform.y[eid] ?? 0;
    const z = Transform.z[eid] ?? 0;

    // Fire chin lasers at shield generator
    if (shieldGens.length > 0 && (ATATWalker.chinLaserCooldown[eid] ?? 0) <= 0) {
      const sgEid = shieldGens[0]!;
      const sgX = Transform.x[sgEid] ?? 0;
      const sgY = (Transform.y[sgEid] ?? 0) + 5; // Aim at center
      const sgZ = Transform.z[sgEid] ?? 0;

      // Check range (chin lasers have long range)
      const dx = sgX - x;
      const dz = sgZ - z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 500) { // 500m range
        const damage = ATATWalker.chinLaserDamage[eid] ?? 50;

        // Apply damage to shield generator
        if (hasComponent(world, ShieldGenerator, sgEid)) {
          ShieldGenerator.health[sgEid] = Math.max(0, (ShieldGenerator.health[sgEid] ?? 0) - damage);
        }

        // Emit fire event for rendering
        fireEvents.push({
          eid,
          weaponType: "chin",
          x: x,
          y: y + 20, // Chin position on 22m walker
          z: z - 10, // Front of walker
          targetX: sgX,
          targetY: sgY,
          targetZ: sgZ
        });

        // Reset cooldown (2 second between chin shots)
        ATATWalker.chinLaserCooldown[eid] = 2.0;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AT-AT Trip System (Tow Cable Mechanics)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles AT-AT state transitions when hit by tow cables.
 *
 * State flow:
 * ADVANCING -> (cable wraps == 3) -> STUMBLING -> FALLING -> DOWN -> (head destroyed) -> DESTROYED
 */
export function atatTripSystem(world: IWorld, dt: number): void {
  const entities = atatQuery(world);

  for (const eid of entities) {
    const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;
    const timer = ATATWalker.stateTimer[eid] ?? 0;
    const wraps = ATATWalker.cableWraps[eid] ?? 0;

    switch (state) {
      case ATAT_STATE.ADVANCING:
        // Check if enough cable wraps to trip
        if (wraps >= 3) {
          ATATWalker.state[eid] = ATAT_STATE.STUMBLING;
          ATATWalker.stateTimer[eid] = 1.5; // Stumble for 1.5 seconds
        }
        break;

      case ATAT_STATE.STUMBLING:
        ATATWalker.stateTimer[eid] = timer - dt;
        if (timer - dt <= 0) {
          ATATWalker.state[eid] = ATAT_STATE.FALLING;
          ATATWalker.stateTimer[eid] = 3.0; // Fall animation takes 3 seconds
        }
        break;

      case ATAT_STATE.FALLING:
        ATATWalker.stateTimer[eid] = timer - dt;

        // Rotate the walker as it falls
        const fallProgress = 1 - (timer - dt) / 3.0;
        Transform.qx[eid] = Math.sin((fallProgress * Math.PI / 2) / 2);
        Transform.qw[eid] = Math.cos((fallProgress * Math.PI / 2) / 2);

        // Lower Y position
        Transform.y[eid] = Math.max(0, 22 * (1 - fallProgress));

        if (timer - dt <= 0) {
          ATATWalker.state[eid] = ATAT_STATE.DOWN;
          ATATWalker.stateTimer[eid] = 999; // Stays down until destroyed
          Transform.y[eid] = 0;
        }
        break;

      case ATAT_STATE.DOWN:
        // Check if head destroyed
        const headHealth = ATATWalker.headHealth[eid] ?? 0;
        if (headHealth <= 0) {
          ATATWalker.state[eid] = ATAT_STATE.DESTROYED;
          ATATWalker.stateTimer[eid] = 5.0; // Explosion duration
        }
        break;

      case ATAT_STATE.DESTROYED:
        // Cleanup will be handled by the scenario
        break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AT-AT Spawner Helper
// ─────────────────────────────────────────────────────────────────────────────

import { addEntity, addComponent } from "bitecs";

/**
 * Spawn an AT-AT walker entity.
 */
export function spawnATATWalker(
  world: IWorld,
  x: number,
  z: number,
  targetX: number,
  targetZ: number,
  seed: number = 0
): number {
  const rng = new SeededRNG(seed);
  const eid = addEntity(world);

  // Core components
  addComponent(world, Transform, eid);
  addComponent(world, Health, eid);
  addComponent(world, Team, eid);
  addComponent(world, ATATWalker, eid);

  // Position (22m tall walker)
  Transform.x[eid] = x;
  Transform.y[eid] = 22;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  // Health
  Health.hp[eid] = 10000; // Very tough
  Health.maxHp[eid] = 10000;

  // Team (Empire)
  Team.id[eid] = 1;

  // AT-AT specific
  ATATWalker.headHealth[eid] = 500;
  ATATWalker.bodyHealth[eid] = 5000;
  ATATWalker.legHealthLeft[eid] = 2000;
  ATATWalker.legHealthRight[eid] = 2000;
  ATATWalker.cableWraps[eid] = 0;
  ATATWalker.cableAttached[eid] = 0;
  ATATWalker.cableAttacherEid[eid] = -1;
  ATATWalker.state[eid] = ATAT_STATE.ADVANCING;
  ATATWalker.stateTimer[eid] = 0;
  ATATWalker.walkSpeed[eid] = 8 + rng.range(-1, 1); // 7-9 m/s
  ATATWalker.targetX[eid] = targetX;
  ATATWalker.targetZ[eid] = targetZ;
  ATATWalker.chinLaserCooldown[eid] = rng.range(0, 2);
  ATATWalker.templeLaserCooldown[eid] = rng.range(0, 0.5);
  ATATWalker.chinLaserDamage[eid] = 50;
  ATATWalker.templeLaserDamage[eid] = 15;
  ATATWalker.legPhase[eid] = rng.range(0, Math.PI * 2);
  ATATWalker.headYaw[eid] = 0;
  ATATWalker.headPitch[eid] = 0;

  return eid;
}
