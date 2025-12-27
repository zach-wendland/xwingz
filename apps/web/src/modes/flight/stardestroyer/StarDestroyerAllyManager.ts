/**
 * StarDestroyerAllyManager - Ally wingman management for Star Destroyer mission
 *
 * Handles:
 * - Wingman spawning in attack formation
 * - Mesh synchronization with ECS state
 * - Death detection and explosion effects
 * - Cleanup on exit
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent, type IWorld } from "bitecs";
import { getFighterArchetype } from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  FighterBrain,
  Health,
  HitRadius,
  LaserWeapon,
  Shield,
  Ship,
  Team,
  Transform,
  Velocity
} from "@xwingz/gameplay";
import { buildAllyMesh } from "../FlightShared";
import { disposeObject } from "../../../rendering/MeshManager";
import type { ExplosionManager } from "../../../rendering/effects";

export interface SDAllyManagerState {
  allyEids: number[];
  allyMeshes: Map<number, THREE.Object3D>;
}

/**
 * Initialize ally manager state
 */
export function createSDAllyManagerState(): SDAllyManagerState {
  return {
    allyEids: [],
    allyMeshes: new Map()
  };
}

/**
 * Spawn 5 wingmen in attack V-formation with the player
 */
export function spawnWingmenFormation(
  world: IWorld,
  scene: THREE.Scene,
  state: SDAllyManagerState,
  playerY: number,
  playerZ: number
): void {
  // V-formation offsets (x, z relative to player)
  const formationOffsets = [
    { x: -35, z: 25 },   // Left wing 1
    { x: 35, z: 25 },    // Right wing 1
    { x: -70, z: 50 },   // Left wing 2
    { x: 70, z: 50 },    // Right wing 2
    { x: 0, z: 60 }      // Tail
  ];

  for (let i = 0; i < formationOffsets.length; i++) {
    const offset = formationOffsets[i]!;
    spawnWingman(world, scene, state, i, offset.x, playerY - 10 + (i % 2) * 8, playerZ + offset.z);
  }
}

/**
 * Spawn a single wingman X-Wing
 */
function spawnWingman(
  world: IWorld,
  scene: THREE.Scene,
  state: SDAllyManagerState,
  slot: number,
  x: number,
  y: number,
  z: number
): void {
  const archetype = getFighterArchetype("xwing_player");
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
  addComponent(world, FighterBrain, eid);
  addComponent(world, AIControlled, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  // Face toward the destroyer (facing -Z)
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

  Team.id[eid] = 0; // Rebel team

  Ship.throttle[eid] = 0.55;
  Ship.maxSpeed[eid] = archetype.maxSpeed * 0.98;
  Ship.accel[eid] = archetype.accel * 0.95;
  Ship.turnRate[eid] = archetype.turnRate * 0.95;

  LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
  LaserWeapon.cooldownRemaining[eid] = 0;
  LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
  LaserWeapon.damage[eid] = archetype.damage;

  Health.hp[eid] = archetype.hp * 1.3;
  Health.maxHp[eid] = archetype.hp * 1.3;
  HitRadius.r[eid] = archetype.hitRadius;

  Shield.maxSp[eid] = 80;
  Shield.sp[eid] = 80;
  Shield.regenRate[eid] = 8;
  Shield.lastHit[eid] = 999;

  FighterBrain.state[eid] = 0;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = 0.85;
  FighterBrain.evadeBias[eid] = 0.35;
  FighterBrain.targetEid[eid] = -1;

  const mesh = buildAllyMesh(slot);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(2.45);
  scene.add(mesh);
  state.allyMeshes.set(eid, mesh);
  state.allyEids.push(eid);
}

/**
 * Sync ally mesh positions and handle deaths
 */
export function syncSDAllies(
  world: IWorld,
  scene: THREE.Scene,
  state: SDAllyManagerState,
  explosions: ExplosionManager | null
): void {
  const tmpExplosionPos = new THREE.Vector3();

  for (let i = state.allyEids.length - 1; i >= 0; i--) {
    const eid = state.allyEids[i]!;

    // Check if ally is dead or removed
    if (
      !hasComponent(world, Transform, eid) ||
      !hasComponent(world, Health, eid) ||
      (Health.hp[eid] ?? 0) <= 0
    ) {
      const mesh = state.allyMeshes.get(eid);
      if (mesh) {
        explosions?.spawn(tmpExplosionPos.copy(mesh.position), 0x66aaff);
        scene.remove(mesh);
        disposeObject(mesh);
        state.allyMeshes.delete(eid);
      }
      state.allyEids.splice(i, 1);
      continue;
    }

    // Update mesh position
    const mesh = state.allyMeshes.get(eid);
    if (!mesh) continue;
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
    mesh.quaternion.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
  }
}

/**
 * Clear all allies from the world and scene
 */
export function clearSDAllies(
  world: IWorld,
  scene: THREE.Scene,
  state: SDAllyManagerState
): void {
  for (const eid of state.allyEids) {
    if (hasComponent(world, Transform, eid)) {
      removeEntity(world, eid);
    }
  }
  state.allyEids = [];

  for (const mesh of state.allyMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  state.allyMeshes.clear();
}

/**
 * Get the current ally count
 */
export function getSDAllyCount(state: SDAllyManagerState): number {
  return state.allyEids.length;
}
