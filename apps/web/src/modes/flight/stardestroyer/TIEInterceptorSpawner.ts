/**
 * TIEInterceptorSpawner - TIE Interceptor wave spawning for Star Destroyer mission
 *
 * Handles:
 * - Initial TIE Fighter screen (12 fighters)
 * - TIE Interceptor reinforcement waves
 */

import * as THREE from "three";
import { addComponent, addEntity, type IWorld } from "bitecs";
import { createRng, deriveSeed, getFighterArchetype } from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  FighterBrain,
  Health,
  HitRadius,
  LaserWeapon,
  Shield,
  Ship,
  Targetable,
  Team,
  Transform,
  Velocity
} from "@xwingz/gameplay";
import { buildEnemyMesh } from "../FlightShared";

export interface TIESpawnResult {
  eids: number[];
  meshes: Map<number, THREE.Object3D>;
  enemyTypes: Map<number, string>;
}

/**
 * Spawn the initial TIE Fighter screen (12 fighters in 3 groups of 4)
 */
export function spawnTIEFighterScreen(
  world: IWorld,
  scene: THREE.Scene,
  seed: bigint,
  starDestroyerZ: number
): TIESpawnResult {
  const rng = createRng(deriveSeed(seed, "sd_ties"));
  const result: TIESpawnResult = {
    eids: [],
    meshes: new Map(),
    enemyTypes: new Map()
  };

  // Spawn 12 TIEs in 3 groups of 4 around the Star Destroyer
  const groupOffsets = [
    { baseX: -400, baseZ: starDestroyerZ + 600 },  // Left group
    { baseX: 0, baseZ: starDestroyerZ + 800 },     // Center group
    { baseX: 400, baseZ: starDestroyerZ + 600 }    // Right group
  ];

  let tieIndex = 0;
  for (const group of groupOffsets) {
    for (let i = 0; i < 4; i++) {
      const angle = rng.range(-0.4, 0.4);
      const xOffset = ((i % 2) - 0.5) * 80;
      const zOffset = Math.floor(i / 2) * 60;
      const x = group.baseX + xOffset + rng.range(-20, 20);
      const z = group.baseZ + zOffset + rng.range(-30, 30);
      const y = 40 + rng.range(0, 120);

      const eid = spawnTIEFighter(world, x, y, z, angle, rng);
      result.eids.push(eid);
      result.enemyTypes.set(eid, "tie_fighter");

      const mesh = buildEnemyMesh("tie_ln");
      mesh.position.set(x, y, z);
      scene.add(mesh);
      result.meshes.set(eid, mesh);

      tieIndex++;
    }
  }

  return result;
}

/**
 * Spawn TIE Interceptor reinforcement wave (4 interceptors)
 */
export function spawnTIEInterceptorWave(
  world: IWorld,
  scene: THREE.Scene,
  seed: bigint,
  waveNumber: number,
  starDestroyerZ: number
): TIESpawnResult {
  const rng = createRng(deriveSeed(seed, `sd_interceptors_${waveNumber}`));
  const result: TIESpawnResult = {
    eids: [],
    meshes: new Map(),
    enemyTypes: new Map()
  };

  // Spawn 4 interceptors in a tight formation
  for (let i = 0; i < 4; i++) {
    const angle = rng.range(-0.3, 0.3);
    const xOffset = ((i % 2) - 0.5) * 60;
    const zOffset = Math.floor(i / 2) * 45;
    const x = rng.range(-200, 200) + xOffset;
    const z = starDestroyerZ + 1000 + zOffset;
    const y = 60 + rng.range(0, 80);

    const eid = spawnTIEInterceptor(world, x, y, z, angle, rng);
    result.eids.push(eid);
    result.enemyTypes.set(eid, "tie_interceptor");

    const mesh = buildEnemyMesh("tie_ln");
    mesh.scale.setScalar(2.1); // Slightly smaller for interceptor
    mesh.position.set(x, y, z);
    scene.add(mesh);
    result.meshes.set(eid, mesh);
  }

  return result;
}

/**
 * Spawn a single TIE Fighter
 */
function spawnTIEFighter(
  world: IWorld,
  x: number,
  y: number,
  z: number,
  angle: number,
  rng: ReturnType<typeof createRng>
): number {
  const archetype = getFighterArchetype("tie_ln");
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Ship, eid);
  addComponent(world, LaserWeapon, eid);
  addComponent(world, Targetable, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, Shield, eid);
  addComponent(world, FighterBrain, eid);
  addComponent(world, AIControlled, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + angle, 0));
  Transform.qx[eid] = q.x;
  Transform.qy[eid] = q.y;
  Transform.qz[eid] = q.z;
  Transform.qw[eid] = q.w;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  AngularVelocity.wx[eid] = 0;
  AngularVelocity.wy[eid] = 0;
  AngularVelocity.wz[eid] = 0;

  Team.id[eid] = 1;

  Ship.throttle[eid] = rng.range(0.65, 0.85);
  Ship.maxSpeed[eid] = archetype.maxSpeed;
  Ship.accel[eid] = archetype.accel;
  Ship.turnRate[eid] = archetype.turnRate;

  LaserWeapon.cooldown[eid] = archetype.weaponCooldown * 1.2;
  LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
  LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
  LaserWeapon.damage[eid] = 5;

  Health.hp[eid] = 50;
  Health.maxHp[eid] = 50;
  HitRadius.r[eid] = archetype.hitRadius;

  Shield.maxSp[eid] = 8;
  Shield.sp[eid] = 8;
  Shield.regenRate[eid] = 2;
  Shield.lastHit[eid] = 999;

  FighterBrain.state[eid] = 0;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = 0.6;
  FighterBrain.evadeBias[eid] = 0.45;
  FighterBrain.targetEid[eid] = -1;

  return eid;
}

/**
 * Spawn a single TIE Interceptor (faster, more agile, less HP)
 */
function spawnTIEInterceptor(
  world: IWorld,
  x: number,
  y: number,
  z: number,
  angle: number,
  rng: ReturnType<typeof createRng>
): number {
  const archetype = getFighterArchetype("tie_ln");
  const eid = addEntity(world);

  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Ship, eid);
  addComponent(world, LaserWeapon, eid);
  addComponent(world, Targetable, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, Shield, eid);
  addComponent(world, FighterBrain, eid);
  addComponent(world, AIControlled, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + angle, 0));
  Transform.qx[eid] = q.x;
  Transform.qy[eid] = q.y;
  Transform.qz[eid] = q.z;
  Transform.qw[eid] = q.w;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  AngularVelocity.wx[eid] = 0;
  AngularVelocity.wy[eid] = 0;
  AngularVelocity.wz[eid] = 0;

  Team.id[eid] = 1;

  // Interceptors are faster and more agile
  Ship.throttle[eid] = rng.range(0.8, 1.0);
  Ship.maxSpeed[eid] = archetype.maxSpeed * 1.15;
  Ship.accel[eid] = archetype.accel * 1.1;
  Ship.turnRate[eid] = archetype.turnRate * 1.2;

  // Faster fire rate
  LaserWeapon.cooldown[eid] = archetype.weaponCooldown * 0.85;
  LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
  LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed * 1.05;
  LaserWeapon.damage[eid] = 6;

  // Less HP than standard TIE
  Health.hp[eid] = 35;
  Health.maxHp[eid] = 35;
  HitRadius.r[eid] = archetype.hitRadius * 0.9;

  Shield.maxSp[eid] = 5;
  Shield.sp[eid] = 5;
  Shield.regenRate[eid] = 1.5;
  Shield.lastHit[eid] = 999;

  // More aggressive behavior
  FighterBrain.state[eid] = 0;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = 0.8;
  FighterBrain.evadeBias[eid] = 0.55;
  FighterBrain.targetEid[eid] = -1;

  return eid;
}
