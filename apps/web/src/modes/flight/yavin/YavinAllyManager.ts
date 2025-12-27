/**
 * YavinAllyManager - Ally wingman management for Yavin Defense mission
 *
 * Handles:
 * - Wingman spawning in formation
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
import { getTerrainHeight } from "./YavinTerrainBuilder";
import type { TerrainParams } from "../FlightScenarioTypes";

export interface AllyManagerState {
  allyEids: number[];
  allyMeshes: Map<number, THREE.Object3D>;
}

/**
 * Initialize ally manager state
 */
export function createAllyManagerState(): AllyManagerState {
  return {
    allyEids: [],
    allyMeshes: new Map()
  };
}

/**
 * Spawn a wingman at the given position
 */
export function spawnWingman(
  world: IWorld,
  scene: THREE.Scene,
  state: AllyManagerState,
  slot: number,
  x: number,
  z: number,
  terrainParams: TerrainParams | null
): void {
  if (!terrainParams) return;

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

  const y = getTerrainHeight(x, z, terrainParams) + 7;

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 1;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 0;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  AngularVelocity.wx[eid] = 0;
  AngularVelocity.wy[eid] = 0;
  AngularVelocity.wz[eid] = 0;

  Team.id[eid] = 0;

  Ship.throttle[eid] = 0.45;
  Ship.maxSpeed[eid] = archetype.maxSpeed * 0.98;
  Ship.accel[eid] = archetype.accel * 0.95;
  Ship.turnRate[eid] = archetype.turnRate * 0.95;

  LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
  LaserWeapon.cooldownRemaining[eid] = 0;
  LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
  LaserWeapon.damage[eid] = archetype.damage;

  Health.hp[eid] = archetype.hp * 1.2;
  Health.maxHp[eid] = archetype.hp * 1.2;
  HitRadius.r[eid] = archetype.hitRadius;

  Shield.maxSp[eid] = 60;
  Shield.sp[eid] = 60;
  Shield.regenRate[eid] = 7;
  Shield.lastHit[eid] = 999;

  FighterBrain.state[eid] = 0;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = 0.85;
  FighterBrain.evadeBias[eid] = 0.4;
  FighterBrain.targetEid[eid] = -1;

  const mesh = buildAllyMesh(slot);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(2.45);
  scene.add(mesh);

  state.allyMeshes.set(eid, mesh);
  state.allyEids.push(eid);
}

/**
 * Spawn the full wingman squadron
 */
export function spawnWingmanSquadron(
  world: IWorld,
  scene: THREE.Scene,
  state: AllyManagerState,
  terrainParams: TerrainParams | null
): void {
  spawnWingman(world, scene, state, 0, -22, 320, terrainParams);
  spawnWingman(world, scene, state, 1, 22, 320, terrainParams);
  spawnWingman(world, scene, state, 2, 0, 300, terrainParams);
  spawnWingman(world, scene, state, 3, -40, 290, terrainParams);
  spawnWingman(world, scene, state, 4, 40, 290, terrainParams);
}

/**
 * Sync ally mesh positions and handle deaths
 */
export function syncAllies(
  world: IWorld,
  scene: THREE.Scene,
  state: AllyManagerState,
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
export function clearAllies(
  world: IWorld,
  scene: THREE.Scene,
  state: AllyManagerState
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
export function getAllyCount(state: AllyManagerState): number {
  return state.allyEids.length;
}
