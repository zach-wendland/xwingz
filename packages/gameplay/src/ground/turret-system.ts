/**
 * Turret Emplacement Systems
 *
 * Dedicated systems for stationary turret behavior.
 * Isolated from main systems.ts to prevent god script bloat.
 */

import { defineQuery, hasComponent, addEntity, addComponent } from "bitecs";
import type { IWorld } from "bitecs";
import { Transform, Health, Team } from "../space/components";
import { TurretEmplacement, TURRET_TYPE, ATATWalker } from "./hoth-components";
import { GroundInput } from "./components";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

const turretQuery = defineQuery([TurretEmplacement, Transform, Team]);
const atatQuery = defineQuery([ATATWalker, Transform, Team]);

// ─────────────────────────────────────────────────────────────────────────────
// Turret Fire Events
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundTurretFireEvent {
  eid: number;
  type: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  damage: number;
}

const fireEvents: GroundTurretFireEvent[] = [];

export function consumeGroundTurretFireEvents(): GroundTurretFireEvent[] {
  const events = [...fireEvents];
  fireEvents.length = 0;
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Turret Operation System (Player/AI Control)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles turret operation when manned by a player or AI.
 * - Updates aim based on operator input
 * - Handles firing and cooldowns
 * - Manages heat for E-Web turrets
 */
export function turretEmplacementSystem(world: IWorld, dt: number): void {
  const entities = turretQuery(world);

  for (const eid of entities) {
    const manned = TurretEmplacement.manned[eid] ?? 0;
    if (!manned) continue;

    const operatorEid = TurretEmplacement.operatorEid[eid] ?? -1;
    if (operatorEid < 0) continue;

    // Get operator input
    if (!hasComponent(world, GroundInput, operatorEid)) continue;

    const aimYaw = GroundInput.aimYaw[operatorEid] ?? 0;
    const aimPitch = GroundInput.aimPitch[operatorEid] ?? 0;
    const firing = GroundInput.firePrimary[operatorEid] ?? 0;

    // Clamp aim within turret limits
    const yawMin = TurretEmplacement.yawMin[eid] ?? -Math.PI;
    const yawMax = TurretEmplacement.yawMax[eid] ?? Math.PI;
    const pitchMin = TurretEmplacement.pitchMin[eid] ?? -0.8;
    const pitchMax = TurretEmplacement.pitchMax[eid] ?? 0.8;

    TurretEmplacement.yaw[eid] = Math.max(yawMin, Math.min(yawMax, aimYaw));
    TurretEmplacement.pitch[eid] = Math.max(pitchMin, Math.min(pitchMax, aimPitch));

    // Update cooldown
    TurretEmplacement.cooldown[eid] = Math.max(0, (TurretEmplacement.cooldown[eid] ?? 0) - dt);

    // Handle heat for E-Web
    const type = TurretEmplacement.type[eid] ?? TURRET_TYPE.E_WEB;
    if (type === TURRET_TYPE.E_WEB) {
      const heat = TurretEmplacement.heat[eid] ?? 0;
      const heatMax = TurretEmplacement.heatMax[eid] ?? 100;
      const coolRate = TurretEmplacement.coolRate[eid] ?? 15;

      // Cool down when not firing
      if (!firing) {
        TurretEmplacement.heat[eid] = Math.max(0, heat - coolRate * dt);
      }

      // Can't fire if overheated
      if (heat >= heatMax) continue;
    }

    // Fire if requested and off cooldown
    if (firing && (TurretEmplacement.cooldown[eid] ?? 0) <= 0) {
      const fireRate = TurretEmplacement.fireRate[eid] ?? 5;
      const damage = TurretEmplacement.damage[eid] ?? 25;
      const heatPerShot = TurretEmplacement.heatPerShot[eid] ?? 8;

      // Reset cooldown
      TurretEmplacement.cooldown[eid] = 1 / fireRate;

      // Add heat
      if (type === TURRET_TYPE.E_WEB) {
        TurretEmplacement.heat[eid] = (TurretEmplacement.heat[eid] ?? 0) + heatPerShot;
      }

      // Emit fire event
      fireEvents.push({
        eid,
        type,
        x: Transform.x[eid] ?? 0,
        y: (Transform.y[eid] ?? 0) + 1.5, // Barrel height
        z: Transform.z[eid] ?? 0,
        yaw: TurretEmplacement.yaw[eid] ?? 0,
        pitch: TurretEmplacement.pitch[eid] ?? 0,
        damage
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Turret AI System (Auto-targeting when unmanned)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI targeting for unmanned turrets.
 * Prioritizes:
 * 1. AT-ATs (if DF.9)
 * 2. Infantry
 */
export function turretAISystem(world: IWorld, dt: number): void {
  const turrets = turretQuery(world);
  const atats = atatQuery(world);

  for (const eid of turrets) {
    const manned = TurretEmplacement.manned[eid] ?? 0;
    if (manned) continue; // Skip manned turrets

    const type = TurretEmplacement.type[eid] ?? TURRET_TYPE.E_WEB;
    const x = Transform.x[eid] ?? 0;
    const z = Transform.z[eid] ?? 0;
    const range = TurretEmplacement.range[eid] ?? 100;
    const teamId = Team.id[eid] ?? 0;

    // Find target
    let targetEid = -1;
    let targetDist = Infinity;

    // DF.9 prioritizes AT-ATs
    if (type === TURRET_TYPE.DF_9) {
      for (const atatEid of atats) {
        if ((Team.id[atatEid] ?? 0) === teamId) continue; // Same team

        const tx = Transform.x[atatEid] ?? 0;
        const tz = Transform.z[atatEid] ?? 0;
        const dist = Math.sqrt((tx - x) ** 2 + (tz - z) ** 2);

        if (dist < range && dist < targetDist) {
          targetEid = atatEid;
          targetDist = dist;
        }
      }
    }

    TurretEmplacement.targetEid[eid] = targetEid;

    // Aim at target
    if (targetEid >= 0) {
      const tx = Transform.x[targetEid] ?? 0;
      const ty = Transform.y[targetEid] ?? 0;
      const tz = Transform.z[targetEid] ?? 0;

      const dx = tx - x;
      const dy = ty - (Transform.y[eid] ?? 0);
      const dz = tz - z;
      const dxz = Math.sqrt(dx * dx + dz * dz);

      const targetYaw = Math.atan2(dx, dz);
      const targetPitch = Math.atan2(dy, dxz);

      // Smooth aim tracking
      const trackSpeed = 1.5; // rad/s
      const currentYaw = TurretEmplacement.yaw[eid] ?? 0;
      const currentPitch = TurretEmplacement.pitch[eid] ?? 0;

      const yawDiff = targetYaw - currentYaw;
      const pitchDiff = targetPitch - currentPitch;

      TurretEmplacement.yaw[eid] = currentYaw + Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), trackSpeed * dt);
      TurretEmplacement.pitch[eid] = currentPitch + Math.sign(pitchDiff) * Math.min(Math.abs(pitchDiff), trackSpeed * dt);

      // Auto-fire when aimed (within 0.1 rad)
      if (Math.abs(yawDiff) < 0.1 && Math.abs(pitchDiff) < 0.1) {
        // Update cooldown
        TurretEmplacement.cooldown[eid] = Math.max(0, (TurretEmplacement.cooldown[eid] ?? 0) - dt);

        if ((TurretEmplacement.cooldown[eid] ?? 0) <= 0) {
          const fireRate = TurretEmplacement.fireRate[eid] ?? 3;
          const damage = TurretEmplacement.damage[eid] ?? 25;

          TurretEmplacement.cooldown[eid] = 1 / fireRate;

          fireEvents.push({
            eid,
            type,
            x,
            y: (Transform.y[eid] ?? 0) + 1.5,
            z,
            yaw: TurretEmplacement.yaw[eid] ?? 0,
            pitch: TurretEmplacement.pitch[eid] ?? 0,
            damage
          });

          // Apply damage to target (simplified - raycast would be better)
          if (type === TURRET_TYPE.DF_9 && hasComponent(world, ATATWalker, targetEid)) {
            // DF.9 does minor damage to AT-AT legs
            ATATWalker.legHealthLeft[targetEid] = Math.max(0, (ATATWalker.legHealthLeft[targetEid] ?? 0) - damage * 0.5);
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Turret Spawner Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn a turret emplacement entity.
 */
export function spawnTurret(
  world: IWorld,
  x: number,
  y: number,
  z: number,
  type: number,
  teamId: number
): number {
  const eid = addEntity(world);

  // Core components
  addComponent(world, Transform, eid);
  addComponent(world, Health, eid);
  addComponent(world, Team, eid);
  addComponent(world, TurretEmplacement, eid);

  // Position
  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  // Health
  const baseHealth = type === TURRET_TYPE.DF_9 ? 500 : 200;
  Health.hp[eid] = baseHealth;
  Health.maxHp[eid] = baseHealth;

  // Team
  Team.id[eid] = teamId;

  // Turret config based on type
  TurretEmplacement.type[eid] = type;
  TurretEmplacement.yaw[eid] = 0;
  TurretEmplacement.pitch[eid] = 0;
  TurretEmplacement.yawMin[eid] = -Math.PI;
  TurretEmplacement.yawMax[eid] = Math.PI;
  TurretEmplacement.pitchMin[eid] = -0.5;
  TurretEmplacement.pitchMax[eid] = 0.7;
  TurretEmplacement.manned[eid] = 0;
  TurretEmplacement.operatorEid[eid] = -1;
  TurretEmplacement.targetEid[eid] = -1;

  if (type === TURRET_TYPE.E_WEB) {
    TurretEmplacement.damage[eid] = 20;
    TurretEmplacement.fireRate[eid] = 8;
    TurretEmplacement.range[eid] = 100;
    TurretEmplacement.spread[eid] = 0.02;
    TurretEmplacement.heat[eid] = 0;
    TurretEmplacement.heatMax[eid] = 100;
    TurretEmplacement.heatPerShot[eid] = 6;
    TurretEmplacement.coolRate[eid] = 20;
  } else if (type === TURRET_TYPE.DF_9) {
    TurretEmplacement.damage[eid] = 80;
    TurretEmplacement.fireRate[eid] = 1.5;
    TurretEmplacement.range[eid] = 300;
    TurretEmplacement.spread[eid] = 0.005;
    TurretEmplacement.heat[eid] = 0;
    TurretEmplacement.heatMax[eid] = 0; // DF.9 doesn't overheat
    TurretEmplacement.heatPerShot[eid] = 0;
    TurretEmplacement.coolRate[eid] = 0;
  }

  TurretEmplacement.cooldown[eid] = 0;

  return eid;
}
