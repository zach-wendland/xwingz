/**
 * YavinDefenseScenario - Defend the Great Temple on Yavin 4
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";
import { createRng, deriveSeed, getFighterArchetype, type SystemDef } from "@xwingz/procgen";
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
  Velocity,
  Targeting
} from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import { disposeObject } from "../../rendering/MeshManager";
import type { ExplosionManager } from "../../rendering/effects";
import {
  type FlightHudElements,
  type YavinDefenseState,
  type TerrainParams,
  type TargetBracketState
} from "./FlightScenarioTypes";
import {
  buildEnemyMesh,
  buildAllyMesh,
  syncTargets,
  updatePlayerHudValues,
  updateSystemInfo,
  updateTargetBracket,
  clearTargetBracket
} from "./FlightShared";

// ─────────────────────────────────────────────────────────────────────────────
// Yavin Context
// ─────────────────────────────────────────────────────────────────────────────

export interface YavinContext {
  ctx: ModeContext;
  currentSystem: SystemDef;
  shipEid: number | null;
  targetEids: number[];
  targetMeshes: Map<number, THREE.Object3D>;
  projectileMeshes: Map<number, THREE.Mesh>;
  explosions: ExplosionManager | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Yavin Defense Scenario Handler
// ─────────────────────────────────────────────────────────────────────────────

export class YavinDefenseScenario {
  // Terrain
  private terrainParams: TerrainParams | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private treeTrunks: THREE.InstancedMesh | null = null;
  private treeCanopies: THREE.InstancedMesh | null = null;

  // Base
  private baseEid: number | null = null;
  private baseMesh: THREE.Object3D | null = null;

  // Allies (wingmen)
  private allyEids: number[] = [];
  private allyMeshes = new Map<number, THREE.Object3D>();

  // Mission state
  private yavin: YavinDefenseState | null = null;

  // Landing
  private canLandNow = false;
  private readonly LANDING_ALTITUDE = 150;

  // Targeting state
  private lockState: TargetBracketState = { lockValue: 0, lockTargetEid: -1 };

  // Temp matrix
  private tmpMat = new THREE.Matrix4();
  private tmpExplosionPos = new THREE.Vector3();

  enter(yctx: YavinContext): void {
    this.lockState = { lockValue: 0, lockTargetEid: -1 };

    // Build terrain
    this.buildYavinPlanet(yctx);

    // Start defense mission
    this.startYavinDefense(yctx);
  }

  tick(yctx: YavinContext, dt: number): boolean {
    if (!this.yavin) return false;

    // Sync targets
    const syncResult = syncTargets(
      yctx.ctx,
      yctx.ctx.scene,
      yctx.targetMeshes,
      yctx.explosions
    );

    // Handle kills
    if (syncResult.killedCount > 0 && yctx.shipEid !== null && this.yavin.phase === "combat") {
      this.yavin.enemiesKilled += syncResult.killedCount;
      yctx.ctx.profile.credits += syncResult.killedCount * 10;

      if (this.yavin.enemiesKilled >= this.yavin.enemiesTotal && syncResult.targetEids.length === 0) {
        this.yavin.phase = "success";
        yctx.ctx.profile.credits += this.yavin.rewardCredits;
        this.yavin.message = `VICTORY  +${this.yavin.rewardCredits} CR`;
        this.yavin.messageTimer = 6;
        yctx.ctx.profile.missionTier += 1;
      }
      yctx.ctx.scheduleSave();
    }

    // Update array in place to preserve FlightMode's reference
    yctx.targetEids.length = 0;
    yctx.targetEids.push(...syncResult.targetEids);

    // Sync allies
    this.syncAllies(yctx);

    // Check base destruction
    if (this.yavin.phase === "combat") {
      const baseAlive =
        this.baseEid !== null &&
        hasComponent(yctx.ctx.world, Health, this.baseEid) &&
        (Health.hp[this.baseEid] ?? 0) > 0;

      if (!baseAlive) {
        this.yavin.phase = "fail";
        this.yavin.message = "MISSION FAILED - GREAT TEMPLE DESTROYED";
        this.yavin.messageTimer = 8;
        if (this.baseMesh) {
          yctx.explosions?.spawn(
            this.tmpExplosionPos.set(
              this.baseMesh.position.x,
              this.baseMesh.position.y + 45,
              this.baseMesh.position.z
            ),
            0xff4444
          );
          yctx.ctx.scene.remove(this.baseMesh);
          disposeObject(this.baseMesh);
          this.baseMesh = null;
        }
        yctx.ctx.scheduleSave();
      }
    }

    // Terrain clamping
    if (yctx.shipEid !== null) {
      this.clampEntityAboveTerrain(yctx.ctx, yctx.shipEid, 6);
    }
    for (const eid of this.allyEids) {
      this.clampEntityAboveTerrain(yctx.ctx, eid, 6);
    }
    for (const eid of yctx.targetEids) {
      this.clampEntityAboveTerrain(yctx.ctx, eid, 6);
    }

    // Update message timer
    if (this.yavin.messageTimer > 0) {
      this.yavin.messageTimer = Math.max(0, this.yavin.messageTimer - dt);
    }

    // Landing detection
    if (yctx.shipEid !== null) {
      const altitude = (Transform.y[yctx.shipEid] ?? 0) - this.terrainHeight(
        Transform.x[yctx.shipEid] ?? 0,
        Transform.z[yctx.shipEid] ?? 0
      );
      this.canLandNow = altitude < this.LANDING_ALTITUDE;
    }

    return false;
  }

  handleHyperspace(_yctx: YavinContext): boolean {
    if (!this.yavin) return true; // Allow default handling

    // Allow restart on success/fail
    if (this.yavin.phase === "success" || this.yavin.phase === "fail") {
      return true; // Let FlightMode handle restart
    }

    // Block during combat
    if (this.yavin.phase === "combat") {
      this.yavin.message = "HYPERSPACE DISABLED - COMPLETE OBJECTIVE";
      this.yavin.messageTimer = 2;
    }

    return false; // Block hyperspace
  }

  updateHud(yctx: YavinContext, els: FlightHudElements, dt: number): void {
    updatePlayerHudValues(els, yctx.shipEid, yctx.ctx);
    updateSystemInfo(els, yctx.currentSystem, yctx.ctx.profile.credits);

    const baseHp =
      this.baseEid !== null && hasComponent(yctx.ctx.world, Health, this.baseEid)
        ? Health.hp[this.baseEid] ?? 0
        : 0;

    // Mission message
    if (this.yavin) {
      if (this.yavin.messageTimer > 0) {
        els.mission.textContent = this.yavin.message;
      } else if (this.yavin.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (this.yavin.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        els.mission.textContent = `DEFEND GREAT TEMPLE: ${this.yavin.enemiesKilled}/${this.yavin.enemiesTotal}  BASE ${Math.max(0, baseHp).toFixed(0)}/${this.yavin.baseHpMax}`;
      }
    }

    // Target bracket
    if (yctx.shipEid !== null) {
      const teid = Targeting.targetEid[yctx.shipEid] ?? -1;
      if (teid >= 0 && Transform.x[teid] !== undefined) {
        this.lockState = updateTargetBracket(yctx.ctx, els, yctx.shipEid, teid, this.lockState, dt);
      } else {
        clearTargetBracket(els);
        this.lockState = { lockValue: 0, lockTargetEid: -1 };
      }
    }

    // Landing prompt
    els.landPrompt.classList.toggle("hidden", !this.canLandNow);
  }

  getMissionMessage(_yctx: YavinContext): string {
    if (!this.yavin) return "";
    if (this.yavin.messageTimer > 0) return this.yavin.message;
    if (this.yavin.phase === "success") return "VICTORY";
    if (this.yavin.phase === "fail") return "MISSION FAILED";
    return `DEFEND: ${this.yavin.enemiesKilled}/${this.yavin.enemiesTotal}`;
  }

  canLand(_yctx: YavinContext): boolean {
    return this.canLandNow;
  }

  exit(yctx: YavinContext): void {
    this.clearPlanetaryScene(yctx);
    this.clearAllies(yctx);
    this.yavin = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Accessors
  // ─────────────────────────────────────────────────────────────────────────────

  getYavinState(): YavinDefenseState | null {
    return this.yavin;
  }

  getAllyCount(): number {
    return this.allyEids.length;
  }

  getBaseEid(): number | null {
    return this.baseEid;
  }

  getTerrainHeight(x: number, z: number): number {
    return this.terrainHeight(x, z);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildYavinPlanet(yctx: YavinContext): void {
    const seed = yctx.currentSystem.seed;
    const rng = createRng(deriveSeed(seed, "yavin_terrain"));

    this.terrainParams = {
      a1: 34,
      f1: 0.0012 + rng.range(0, 0.0006),
      p1: rng.range(0, Math.PI * 2),
      a2: 18,
      f2: 0.0021 + rng.range(0, 0.001),
      p2: rng.range(0, Math.PI * 2),
      yOffset: -12
    };

    // Daytime jungle atmosphere - hazy green-blue sky
    yctx.ctx.scene.fog = new THREE.Fog(0x8aac9e, 400, 6000);
    yctx.ctx.scene.background = new THREE.Color(0xa8c4b8);

    // Ground mesh
    const size = 9000;
    const seg = 140;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      pos.setZ(i, this.terrainHeight(x, z) - (this.terrainParams?.yOffset ?? 0));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 1.0 });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = this.terrainParams.yOffset;
    this.groundMesh.receiveShadow = true;
    yctx.ctx.scene.add(this.groundMesh);

    // Trees
    const treeCount = 260;
    const trunkGeo = new THREE.CylinderGeometry(0.9, 1.3, 14, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1.0 });
    this.treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    this.treeTrunks.castShadow = true;
    this.treeTrunks.receiveShadow = true;

    const canopyGeo = new THREE.ConeGeometry(6.5, 18, 8);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1b5a34, roughness: 1.0 });
    this.treeCanopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    this.treeCanopies.castShadow = true;
    this.treeCanopies.receiveShadow = true;

    for (let i = 0; i < treeCount; i++) {
      let x = rng.range(-1800, 1800);
      let z = rng.range(-1800, 1800);
      if (Math.abs(x) < 260 && z > -200 && z < 520) {
        x += rng.range(260, 520) * Math.sign(x || 1);
        z += rng.range(120, 260);
      }

      const y = this.terrainHeight(x, z);
      const trunkY = y + 7;
      const canopyY = y + 20;
      const s = rng.range(0.85, 1.35);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));

      this.tmpMat.compose(new THREE.Vector3(x, trunkY, z), rot, new THREE.Vector3(s, s * rng.range(0.9, 1.25), s));
      this.treeTrunks.setMatrixAt(i, this.tmpMat);
      this.tmpMat.compose(new THREE.Vector3(x, canopyY, z), rot, new THREE.Vector3(s, s, s));
      this.treeCanopies.setMatrixAt(i, this.tmpMat);
    }

    this.treeTrunks.instanceMatrix.needsUpdate = true;
    this.treeCanopies.instanceMatrix.needsUpdate = true;
    yctx.ctx.scene.add(this.treeTrunks);
    yctx.ctx.scene.add(this.treeCanopies);

    // Great Temple
    this.baseMesh = this.buildGreatTemple();
    this.baseMesh.position.y = this.terrainHeight(0, 0);
    this.baseMesh.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    yctx.ctx.scene.add(this.baseMesh);
  }

  private buildGreatTemple(): THREE.Group {
    const group = new THREE.Group();

    const stone = new THREE.MeshStandardMaterial({ color: 0x5f646e, metalness: 0.0, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0f1015, roughness: 1.0 });

    const step1 = new THREE.Mesh(new THREE.BoxGeometry(320, 34, 260), stone);
    step1.position.y = 17;
    const step2 = new THREE.Mesh(new THREE.BoxGeometry(260, 30, 210), stone);
    step2.position.y = 34 + 15;
    const step3 = new THREE.Mesh(new THREE.BoxGeometry(200, 28, 160), stone);
    step3.position.y = 34 + 30 + 14;
    const top = new THREE.Mesh(new THREE.BoxGeometry(150, 24, 110), stone);
    top.position.y = 34 + 30 + 28 + 12;

    const hangar = new THREE.Mesh(new THREE.BoxGeometry(140, 50, 26), dark);
    hangar.position.set(0, 22, 130);

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(160, 3, 220),
      new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.8 })
    );
    pad.position.set(0, 1.5, 250);

    group.add(step1, step2, step3, top, hangar, pad);
    return group;
  }

  private clearPlanetaryScene(yctx: YavinContext): void {
    if (this.groundMesh) {
      yctx.ctx.scene.remove(this.groundMesh);
      disposeObject(this.groundMesh);
      this.groundMesh = null;
    }
    if (this.treeTrunks) {
      yctx.ctx.scene.remove(this.treeTrunks);
      disposeObject(this.treeTrunks);
      this.treeTrunks = null;
    }
    if (this.treeCanopies) {
      yctx.ctx.scene.remove(this.treeCanopies);
      disposeObject(this.treeCanopies);
      this.treeCanopies = null;
    }
    if (this.baseMesh) {
      yctx.ctx.scene.remove(this.baseMesh);
      disposeObject(this.baseMesh);
      this.baseMesh = null;
    }
    if (this.baseEid !== null) {
      removeEntity(yctx.ctx.world, this.baseEid);
      this.baseEid = null;
    }
    this.terrainParams = null;
    yctx.ctx.scene.fog = null;
    yctx.ctx.scene.background = null;
  }

  private terrainHeight(x: number, z: number): number {
    const p = this.terrainParams;
    if (!p) return 0;
    const h1 = Math.sin(x * p.f1 + p.p1) * Math.cos(z * p.f1 + p.p1) * p.a1;
    const h2 = Math.sin(x * p.f2 + p.p2) * Math.sin(z * p.f2 + p.p2) * p.a2;
    return h1 + h2 + p.yOffset;
  }

  private clampEntityAboveTerrain(ctx: ModeContext, eid: number, clearance: number): void {
    if (!this.terrainParams) return;
    if (!hasComponent(ctx.world, Transform, eid)) return;

    const x = Transform.x[eid] ?? 0;
    const z = Transform.z[eid] ?? 0;
    const minY = this.terrainHeight(x, z) + clearance;
    const y0 = Transform.y[eid] ?? 0;
    if (y0 >= minY) return;

    Transform.y[eid] = minY;
    if (hasComponent(ctx.world, Velocity, eid) && (Velocity.vy[eid] ?? 0) < 0) {
      Velocity.vy[eid] = 0;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mission Setup
  // ─────────────────────────────────────────────────────────────────────────────

  private startYavinDefense(yctx: YavinContext): void {
    this.yavin = {
      phase: "launch",
      baseHpMax: 2000,
      enemiesTotal: 6,
      enemiesKilled: 0,
      rewardCredits: 1000,
      message: "RED SQUADRON: LAUNCH! DEFEND THE GREAT TEMPLE.",
      messageTimer: 6
    };

    this.clearAllies(yctx);

    // Clear existing targets
    for (const eid of yctx.targetEids) removeEntity(yctx.ctx.world, eid);
    yctx.targetEids = [];
    for (const mesh of yctx.targetMeshes.values()) {
      yctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    yctx.targetMeshes.clear();

    // Base entity
    if (this.baseMesh) {
      const eid = addEntity(yctx.ctx.world);
      addComponent(yctx.ctx.world, Transform, eid);
      addComponent(yctx.ctx.world, Team, eid);
      addComponent(yctx.ctx.world, Health, eid);
      addComponent(yctx.ctx.world, HitRadius, eid);

      this.baseEid = eid;
      Team.id[eid] = 0;
      Health.hp[eid] = this.yavin.baseHpMax;
      Health.maxHp[eid] = this.yavin.baseHpMax;
      HitRadius.r[eid] = 140;

      Transform.x[eid] = this.baseMesh.position.x;
      Transform.y[eid] = this.baseMesh.position.y + 55;
      Transform.z[eid] = this.baseMesh.position.z + 30;
      Transform.qx[eid] = 0;
      Transform.qy[eid] = 0;
      Transform.qz[eid] = 0;
      Transform.qw[eid] = 1;
    }

    // Position player
    if (yctx.shipEid !== null && this.terrainParams) {
      const x = 0;
      const z = 340;
      const y = this.terrainHeight(x, z) + 7;
      Transform.x[yctx.shipEid] = x;
      Transform.y[yctx.shipEid] = y;
      Transform.z[yctx.shipEid] = z;
      Transform.qx[yctx.shipEid] = 0;
      Transform.qy[yctx.shipEid] = 1;
      Transform.qz[yctx.shipEid] = 0;
      Transform.qw[yctx.shipEid] = 0;
      Velocity.vx[yctx.shipEid] = 0;
      Velocity.vy[yctx.shipEid] = 0;
      Velocity.vz[yctx.shipEid] = 0;
      Ship.throttle[yctx.shipEid] = 0.35;
    }

    // Wingmen
    this.spawnWingman(yctx, 0, -22, 320);
    this.spawnWingman(yctx, 1, 22, 320);
    this.spawnWingman(yctx, 2, 0, 300);
    this.spawnWingman(yctx, 3, -40, 290);
    this.spawnWingman(yctx, 4, 40, 290);

    // TIE raid
    this.spawnYavinTieRaid(yctx, yctx.currentSystem.seed, this.yavin.enemiesTotal);

    this.yavin.phase = "combat";
    yctx.ctx.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Ally Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnWingman(yctx: YavinContext, slot: number, x: number, z: number): void {
    if (!this.terrainParams) return;

    const archetype = getFighterArchetype("xwing_player");
    const eid = addEntity(yctx.ctx.world);
    addComponent(yctx.ctx.world, Transform, eid);
    addComponent(yctx.ctx.world, Velocity, eid);
    addComponent(yctx.ctx.world, AngularVelocity, eid);
    addComponent(yctx.ctx.world, Team, eid);
    addComponent(yctx.ctx.world, Ship, eid);
    addComponent(yctx.ctx.world, LaserWeapon, eid);
    addComponent(yctx.ctx.world, Health, eid);
    addComponent(yctx.ctx.world, HitRadius, eid);
    addComponent(yctx.ctx.world, Shield, eid);
    addComponent(yctx.ctx.world, FighterBrain, eid);
    addComponent(yctx.ctx.world, AIControlled, eid);

    const y = this.terrainHeight(x, z) + 7;
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
    yctx.ctx.scene.add(mesh);
    this.allyMeshes.set(eid, mesh);
    this.allyEids.push(eid);
  }

  private spawnYavinTieRaid(yctx: YavinContext, seed: bigint, count: number): void {
    const rng = createRng(deriveSeed(seed, "yavin_defense", "ties_v0"));
    const baseTarget = this.baseEid;

    for (let i = 0; i < count; i++) {
      const archetype = getFighterArchetype("tie_ln");
      const angle = rng.range(-0.4, 0.4);
      const x = rng.range(-600, 600);
      const z = -2400 + rng.range(-400, 300);
      const y = 220 + rng.range(0, 260);

      const eid = addEntity(yctx.ctx.world);
      addComponent(yctx.ctx.world, Transform, eid);
      addComponent(yctx.ctx.world, Velocity, eid);
      addComponent(yctx.ctx.world, AngularVelocity, eid);
      addComponent(yctx.ctx.world, Team, eid);
      addComponent(yctx.ctx.world, Ship, eid);
      addComponent(yctx.ctx.world, LaserWeapon, eid);
      addComponent(yctx.ctx.world, Targetable, eid);
      addComponent(yctx.ctx.world, Health, eid);
      addComponent(yctx.ctx.world, HitRadius, eid);
      addComponent(yctx.ctx.world, Shield, eid);
      addComponent(yctx.ctx.world, FighterBrain, eid);
      addComponent(yctx.ctx.world, AIControlled, eid);

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
      FighterBrain.targetEid[eid] = baseTarget !== null && i < Math.ceil(count * 0.25) ? baseTarget : -1;

      const mesh = buildEnemyMesh("tie_ln");
      mesh.position.set(x, y, z);
      yctx.ctx.scene.add(mesh);
      yctx.targetMeshes.set(eid, mesh);
      yctx.targetEids.push(eid);
    }
  }

  private syncAllies(yctx: YavinContext): void {
    for (let i = this.allyEids.length - 1; i >= 0; i--) {
      const eid = this.allyEids[i]!;
      if (
        !hasComponent(yctx.ctx.world, Transform, eid) ||
        !hasComponent(yctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        const mesh = this.allyMeshes.get(eid);
        if (mesh) {
          yctx.explosions?.spawn(this.tmpExplosionPos.copy(mesh.position), 0x66aaff);
          yctx.ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.allyMeshes.delete(eid);
        }
        this.allyEids.splice(i, 1);
        continue;
      }

      const mesh = this.allyMeshes.get(eid);
      if (!mesh) continue;
      mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
      mesh.quaternion.set(Transform.qx[eid] ?? 0, Transform.qy[eid] ?? 0, Transform.qz[eid] ?? 0, Transform.qw[eid] ?? 1);
    }
  }

  private clearAllies(yctx: YavinContext): void {
    for (const eid of this.allyEids) {
      if (hasComponent(yctx.ctx.world, Transform, eid)) removeEntity(yctx.ctx.world, eid);
    }
    this.allyEids = [];
    for (const mesh of this.allyMeshes.values()) {
      yctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.allyMeshes.clear();
  }
}
