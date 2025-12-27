/**
 * YavinWaveSpawner - Enemy wave spawning for Yavin Defense mission
 *
 * Handles:
 * - Wave 1: Initial TIE Fighter raid
 * - Wave 2: TIE Bombers targeting the temple
 * - Wave 3: Final mixed assault (TIE Fighters + Interceptors)
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

export interface WaveSpawnResult {
  eids: number[];
  meshes: Map<number, THREE.Object3D>;
  enemyTypes: Map<number, string>;
}

/**
 * Spawn Wave 1 - Initial TIE Fighter raid
 */
export function spawnWave1TieRaid(
  world: IWorld,
  scene: THREE.Scene,
  seed: bigint,
  count: number,
  baseTargetEid: number | null
): WaveSpawnResult {
  const rng = createRng(deriveSeed(seed, "yavin_defense", "ties_v0"));
  const result: WaveSpawnResult = {
    eids: [],
    meshes: new Map(),
    enemyTypes: new Map()
  };

  for (let i = 0; i < count; i++) {
    const archetype = getFighterArchetype("tie_ln");
    const angle = rng.range(-0.4, 0.4);
    const x = rng.range(-600, 600);
    const z = -2400 + rng.range(-400, 300);
    const y = 220 + rng.range(0, 260);

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

    Ship.throttle[eid] = rng.range(0.7, 0.95);
    Ship.maxSpeed[eid] = archetype.maxSpeed;
    Ship.accel[eid] = archetype.accel;
    Ship.turnRate[eid] = archetype.turnRate;

    LaserWeapon.cooldown[eid] = archetype.weaponCooldown * 1.3;
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
    FighterBrain.aggression[eid] = 0.55;
    FighterBrain.evadeBias[eid] = 0.45;
    // FIX: Reduced from 25% to 15% of enemies targeting base initially (gives player more time)
    FighterBrain.targetEid[eid] =
      baseTargetEid !== null && i < Math.ceil(count * 0.15) ? baseTargetEid : -1;

    result.eids.push(eid);
    result.enemyTypes.set(eid, "tie_fighter");

    const mesh = buildEnemyMesh("tie_ln");
    mesh.position.set(x, y, z);
    scene.add(mesh);
    result.meshes.set(eid, mesh);
  }

  return result;
}

/**
 * Spawn Wave 2 - TIE Bombers
 */
export function spawnWave2Bombers(
  world: IWorld,
  scene: THREE.Scene,
  seed: bigint,
  baseTargetEid: number | null
): WaveSpawnResult {
  const rng = createRng(deriveSeed(seed, "yavin_wave2"));
  const result: WaveSpawnResult = {
    eids: [],
    meshes: new Map(),
    enemyTypes: new Map()
  };

  for (let i = 0; i < 3; i++) {
    const archetype = getFighterArchetype("tie_ln"); // Use TIE stats as base
    const angle = rng.range(-0.3, 0.3);
    const x = rng.range(-400, 400);
    const z = -2200 + rng.range(-200, 200);
    const y = 140 + rng.range(0, 60); // Lower altitude for bombers

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

    Team.id[eid] = 1;

    // Bombers are slower but tougher
    Ship.throttle[eid] = 0.5;
    Ship.maxSpeed[eid] = archetype.maxSpeed * 0.6;
    Ship.accel[eid] = archetype.accel * 0.7;
    Ship.turnRate[eid] = archetype.turnRate * 0.7;

    LaserWeapon.cooldown[eid] = archetype.weaponCooldown * 2;
    LaserWeapon.cooldownRemaining[eid] = 0;
    LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
    LaserWeapon.damage[eid] = 10; // FIX: Reduced from 15 to 10 (base was losing health too fast)

    Health.hp[eid] = 80; // Tougher
    Health.maxHp[eid] = 80;
    HitRadius.r[eid] = archetype.hitRadius * 1.3; // Bigger target

    Shield.maxSp[eid] = 15;
    Shield.sp[eid] = 15;
    Shield.regenRate[eid] = 3;
    Shield.lastHit[eid] = 999;

    // Target the base
    FighterBrain.state[eid] = 0;
    FighterBrain.stateTime[eid] = 0;
    FighterBrain.aggression[eid] = 0.9;
    FighterBrain.evadeBias[eid] = 0.2;
    FighterBrain.targetEid[eid] = baseTargetEid ?? -1;

    result.eids.push(eid);
    result.enemyTypes.set(eid, "tie_bomber");

    // Build bomber mesh (visually distinct)
    const mesh = buildEnemyMesh("tie_ln");
    mesh.scale.setScalar(2.8); // Slightly larger
    mesh.position.set(x, y, z);
    scene.add(mesh);
    result.meshes.set(eid, mesh);
  }

  return result;
}

/**
 * Spawn Wave 3 - Final mixed assault
 */
export function spawnWave3FinalAssault(
  world: IWorld,
  scene: THREE.Scene,
  seed: bigint
): WaveSpawnResult {
  const rng = createRng(deriveSeed(seed, "yavin_wave3"));
  const result: WaveSpawnResult = {
    eids: [],
    meshes: new Map(),
    enemyTypes: new Map()
  };

  // 4 TIE Fighters + 2 TIE Interceptors (represented as faster TIEs)
  for (let i = 0; i < 6; i++) {
    const isInterceptor = i >= 4;
    const archetype = getFighterArchetype("tie_ln");
    const angle = rng.range(-0.5, 0.5);
    const x = rng.range(-800, 800);
    const z = -2400 + rng.range(-300, 300);
    const y = 180 + rng.range(0, 200);

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

    Team.id[eid] = 1;

    // Interceptors are faster and more agile
    const speedMult = isInterceptor ? 1.15 : 1.0;
    const turnMult = isInterceptor ? 1.2 : 1.0;

    Ship.throttle[eid] = rng.range(0.8, 1.0);
    Ship.maxSpeed[eid] = archetype.maxSpeed * speedMult;
    Ship.accel[eid] = archetype.accel * speedMult;
    Ship.turnRate[eid] = archetype.turnRate * turnMult;

    LaserWeapon.cooldown[eid] = archetype.weaponCooldown * (isInterceptor ? 0.9 : 1.1);
    LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
    LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
    LaserWeapon.damage[eid] = 6;

    Health.hp[eid] = isInterceptor ? 40 : 50;
    Health.maxHp[eid] = isInterceptor ? 40 : 50;
    HitRadius.r[eid] = archetype.hitRadius;

    Shield.maxSp[eid] = 8;
    Shield.sp[eid] = 8;
    Shield.regenRate[eid] = 2;
    Shield.lastHit[eid] = 999;

    // More aggressive in final wave
    FighterBrain.state[eid] = 0;
    FighterBrain.stateTime[eid] = 0;
    FighterBrain.aggression[eid] = 0.75;
    FighterBrain.evadeBias[eid] = 0.35;
    FighterBrain.targetEid[eid] = -1;

    result.eids.push(eid);
    result.enemyTypes.set(eid, isInterceptor ? "tie_interceptor" : "tie_fighter");

    const mesh = buildEnemyMesh("tie_ln");
    if (isInterceptor) {
      mesh.scale.setScalar(2.3); // Slightly smaller for interceptor
    }
    mesh.position.set(x, y, z);
    scene.add(mesh);
    result.meshes.set(eid, mesh);
  }

  return result;
}
