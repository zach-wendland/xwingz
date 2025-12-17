/**
 * HothDefenseScenario - Battle of Hoth Ground Phase (Mission 5)
 *
 * "The single worst battlefield defeat suffered by the Rebel Alliance
 * during the Galactic Civil War" - yet their courage bought time for
 * the evacuation that would lead to ultimate victory at Endor.
 *
 * Three phases:
 * 1. "First Contact" - Defend trenches against Snowtrooper waves
 * 2. "Broken Lines" - AT-ATs breach, board snowspeeder for tow cable runs
 * 3. "Evacuation" - Fighting retreat to transport hangar
 */

import * as THREE from "three";
import { addEntity, removeEntity, hasComponent, addComponent } from "bitecs";
import { SeededRNG } from "@xwingz/core";
import {
  spawnSoldier,
  Transform,
  Health,
  Team
} from "@xwingz/gameplay";
import {
  ATATWalker,
  ATAT_STATE,
  ShieldGenerator,
  TURRET_TYPE
} from "@xwingz/gameplay";
import {
  spawnATATWalker,
  atatWalkerSystem,
  atatTargetingSystem,
  atatWeaponSystem,
  atatTripSystem,
  consumeATATFireEvents
} from "@xwingz/gameplay";
import {
  spawnTurret,
  turretEmplacementSystem,
  turretAISystem,
  consumeGroundTurretFireEvents
} from "@xwingz/gameplay";
import { createGroundPlane } from "@xwingz/physics";
import type {
  GroundContext,
  GroundHudElements,
  GroundScenarioHandler,
  HothDefenseState
} from "./GroundScenarioTypes";
import { disposeObject } from "../../rendering/MeshManager";

// ─────────────────────────────────────────────────────────────────────────────
// Hoth Defense Scenario Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class HothDefenseScenario implements GroundScenarioHandler {
  // Mission state
  private state: HothDefenseState = {
    phase: "trenches",
    transportsEvacuated: 0,
    transportsTotal: 17, // Film canon
    baseIntegrity: 2000,
    baseIntegrityMax: 2000,
    waveNumber: 0,
    enemiesKilledThisWave: 0,
    atatCount: 0,
    atatTripped: 0,
    message: "DEFEND ECHO BASE",
    messageTimer: 5,
    rewardCredits: 2000
  };

  // Terrain
  private snowTerrain: THREE.Mesh | null = null;
  private skyDome: THREE.Mesh | null = null;

  // Structures
  private echoBaseMesh: THREE.Object3D | null = null;
  private shieldGenMesh: THREE.Object3D | null = null;
  private shieldGenEid: number | null = null;
  private trenchMeshes: THREE.Object3D[] = [];

  // AT-AT tracking
  private atatEids: number[] = [];
  private atatMeshes = new Map<number, THREE.Object3D>();

  // Turret tracking
  private turretEids: number[] = [];
  private turretMeshes = new Map<number, THREE.Object3D>();

  // Snowspeeder for transition
  private snowspeederMesh: THREE.Object3D | null = null;
  private nearSpeeder = false;

  // Wave timing
  private waveTimer = 0;
  private readonly WAVE_INTERVAL = 45; // Seconds between waves

  // Ion cannon cinematic
  private ionCannonTimer = 0;
  private ionCannonFired = false;

  // RNG
  private rng: SeededRNG;

  constructor() {
    this.rng = new SeededRNG(Date.now());
  }

  enter(gctx: GroundContext): void {
    // Create physics ground plane
    createGroundPlane(gctx.physicsWorld, 0);

    // Build Hoth terrain
    this.buildHothTerrain(gctx);

    // Build Echo Base structures
    this.buildEchoBase(gctx);

    // Build trench network
    this.buildTrenches(gctx);

    // Spawn shield generator entity
    this.spawnShieldGenerator(gctx);

    // Spawn defensive turrets
    this.spawnTurrets(gctx);

    // Spawn player in trenches
    this.spawnPlayer(gctx, 0, 1, 30);

    // Spawn initial Snowtrooper wave
    this.spawnWave(gctx, 1);

    // Spawn snowspeeder for phase 2 transition
    this.buildSpeeder(gctx);

    // Set initial message
    this.state.message = "DEFEND THE SHIELD GENERATOR";
    this.state.messageTimer = 5;

    // Schedule ion cannon cinematic
    this.ionCannonTimer = 20; // Fire after 20 seconds
  }

  tick(gctx: GroundContext, dt: number): boolean {
    // Update mission state timers
    this.state.messageTimer = Math.max(0, this.state.messageTimer - dt);
    this.waveTimer += dt;

    // Run Hoth-specific systems
    atatWalkerSystem(gctx.ctx.world, dt);
    atatTargetingSystem(gctx.ctx.world, dt);
    atatWeaponSystem(gctx.ctx.world, dt);
    atatTripSystem(gctx.ctx.world, dt);
    turretEmplacementSystem(gctx.ctx.world, dt);
    turretAISystem(gctx.ctx.world, dt);

    // Process AT-AT fire events
    const atatFires = consumeATATFireEvents();
    for (const fire of atatFires) {
      // Create laser beam effect (handled by rendering)
      this.spawnATATLaserEffect(gctx, fire);
    }

    // Process turret fire events
    const turretFires = consumeGroundTurretFireEvents();
    for (const fire of turretFires) {
      this.spawnTurretLaserEffect(gctx, fire);
    }

    // Sync AT-AT meshes
    this.syncATATMeshes(gctx);

    // Sync enemy meshes
    this.syncEnemyMeshes(gctx);

    // Check shield generator status
    this.checkShieldGenerator(gctx);

    // Ion cannon cinematic
    this.updateIonCannon(gctx, dt);

    // Wave spawning
    if (this.waveTimer >= this.WAVE_INTERVAL && this.state.phase === "trenches") {
      this.state.waveNumber++;
      this.spawnWave(gctx, this.state.waveNumber + 1);
      this.waveTimer = 0;

      // Spawn AT-AT at wave 3
      if (this.state.waveNumber >= 2 && this.atatEids.length === 0) {
        this.spawnATAT(gctx);
        this.state.message = "AT-AT WALKER DETECTED! GET TO THE SNOWSPEEDER!";
        this.state.messageTimer = 5;
        this.state.phase = "breach";
      }
    }

    // Check player proximity to snowspeeder
    this.checkSpeederProximity(gctx);

    // Phase transitions
    this.updatePhase(gctx);

    return false; // Don't exit ground mode automatically
  }

  updateHud(_gctx: GroundContext, els: GroundHudElements): void {
    // Mission message
    if (this.state.messageTimer > 0) {
      els.mission.textContent = this.state.message;
    } else {
      els.mission.textContent = this.getPhaseMessage();
    }

    // Objective
    els.objective.textContent = `TRANSPORTS: ${this.state.transportsEvacuated}/${this.state.transportsTotal}`;

    // Base integrity (if elements exist)
    if (els.baseIntegrity) {
      const pct = Math.round((this.state.baseIntegrity / this.state.baseIntegrityMax) * 100);
      els.baseIntegrity.textContent = `SHIELD GEN: ${pct}%`;
    }

    // AT-AT count
    if (els.atatCount) {
      els.atatCount.textContent = `AT-ATs: ${this.atatEids.length} (${this.state.atatTripped} TRIPPED)`;
    }
  }

  getMissionMessage(): string {
    if (this.state.messageTimer > 0) return this.state.message;
    return this.getPhaseMessage();
  }

  getMissionNumber(): number {
    return 5; // Battle of Hoth is Mission 5
  }

  canTransition(): "speeder" | "launch" | null {
    // Can board speeder during breach phase
    if (this.state.phase === "breach" && this.nearSpeeder) {
      return "speeder";
    }
    return null;
  }

  handleSpeederTransition?(gctx: GroundContext): void {
    // Remove player from ground, transition to HothSpeederScenario
    gctx.ctx.requestModeChange("flight", {
      type: "flight",
      system: null as any, // Will be populated by mode manager
      scenario: "hoth_speeder"
    });
  }

  exit(gctx: GroundContext): void {
    // Clean up terrain
    if (this.snowTerrain) {
      gctx.ctx.scene.remove(this.snowTerrain);
      disposeObject(this.snowTerrain);
      this.snowTerrain = null;
    }
    if (this.skyDome) {
      gctx.ctx.scene.remove(this.skyDome);
      disposeObject(this.skyDome);
      this.skyDome = null;
    }

    // Clean up structures
    if (this.echoBaseMesh) {
      gctx.ctx.scene.remove(this.echoBaseMesh);
      disposeObject(this.echoBaseMesh);
      this.echoBaseMesh = null;
    }
    if (this.shieldGenMesh) {
      gctx.ctx.scene.remove(this.shieldGenMesh);
      disposeObject(this.shieldGenMesh);
      this.shieldGenMesh = null;
    }
    for (const mesh of this.trenchMeshes) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.trenchMeshes = [];

    // Clean up AT-ATs
    for (const eid of this.atatEids) {
      removeEntity(gctx.ctx.world, eid);
    }
    this.atatEids = [];
    for (const mesh of this.atatMeshes.values()) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.atatMeshes.clear();

    // Clean up turrets
    for (const eid of this.turretEids) {
      removeEntity(gctx.ctx.world, eid);
    }
    this.turretEids = [];
    for (const mesh of this.turretMeshes.values()) {
      gctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretMeshes.clear();

    // Clean up speeder
    if (this.snowspeederMesh) {
      gctx.ctx.scene.remove(this.snowspeederMesh);
      disposeObject(this.snowspeederMesh);
      this.snowspeederMesh = null;
    }

    // Reset fog
    gctx.ctx.scene.fog = null;
    gctx.ctx.scene.background = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildHothTerrain(gctx: GroundContext): void {
    // White fog/atmosphere - Hoth blizzard conditions
    gctx.ctx.scene.fog = new THREE.Fog(0xc8d8e8, 100, 800);
    gctx.ctx.scene.background = new THREE.Color(0xddeeff);

    // Snow ground plane
    const size = 2000;
    const segments = 100;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);

    // Add subtle height variation for snow drifts
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      const height = Math.sin(x * 0.01) * Math.cos(z * 0.01) * 2 +
                     Math.sin(x * 0.03 + 1.5) * 1;
      pos.setZ(i, height);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4ff,
      roughness: 0.95,
      metalness: 0
    });

    this.snowTerrain = new THREE.Mesh(geo, snowMat);
    this.snowTerrain.rotation.x = -Math.PI / 2;
    this.snowTerrain.receiveShadow = true;
    gctx.ctx.scene.add(this.snowTerrain);

    // Add some ice rock formations
    this.addIceRocks(gctx);
  }

  private addIceRocks(gctx: GroundContext): void {
    const rockGeo = new THREE.DodecahedronGeometry(4, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xaaccff,
      roughness: 0.6
    });

    const rockPositions = [
      { x: 50, z: -20, scale: 1.5 },
      { x: -60, z: -40, scale: 2.0 },
      { x: 80, z: 50, scale: 1.2 },
      { x: -70, z: 80, scale: 1.8 },
      { x: 100, z: -60, scale: 2.2 },
    ];

    for (const pos of rockPositions) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(pos.x, pos.scale * 2, pos.z);
      rock.scale.setScalar(pos.scale);
      rock.rotation.set(
        this.rng.range(0, Math.PI),
        this.rng.range(0, Math.PI),
        this.rng.range(0, Math.PI)
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      gctx.ctx.scene.add(rock);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Structure Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildEchoBase(gctx: GroundContext): void {
    const group = new THREE.Group();

    // Main hangar entrance (carved into mountain)
    const entranceGeo = new THREE.BoxGeometry(80, 40, 30);
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0x889999,
      roughness: 0.4
    });
    const entrance = new THREE.Mesh(entranceGeo, iceMat);
    entrance.position.set(0, 20, -80);
    entrance.castShadow = true;
    entrance.receiveShadow = true;
    group.add(entrance);

    // Hangar door (dark)
    const doorGeo = new THREE.BoxGeometry(60, 30, 2);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x111115,
      roughness: 0.8
    });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 15, -65);
    group.add(door);

    // Mountain backdrop
    const mountainGeo = new THREE.ConeGeometry(150, 200, 6);
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0xddeeff,
      roughness: 0.9
    });
    const mountain = new THREE.Mesh(mountainGeo, mountainMat);
    mountain.position.set(0, 60, -150);
    mountain.receiveShadow = true;
    group.add(mountain);

    this.echoBaseMesh = group;
    gctx.ctx.scene.add(group);
  }

  private buildTrenches(gctx: GroundContext): void {
    const trenchMat = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      roughness: 0.7
    });

    // Trench wall segments
    const wallGeo = new THREE.BoxGeometry(2, 1.5, 30);

    const trenchPositions = [
      { x: -30, z: 20 },
      { x: -10, z: 20 },
      { x: 10, z: 20 },
      { x: 30, z: 20 },
    ];

    for (const pos of trenchPositions) {
      const wall = new THREE.Mesh(wallGeo, trenchMat);
      wall.position.set(pos.x, 0.75, pos.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      gctx.ctx.scene.add(wall);
      this.trenchMeshes.push(wall);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Entity Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnPlayer(gctx: GroundContext, x: number, y: number, z: number): void {
    gctx.playerEid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, x, y, z, 0, 0, false);
  }

  private spawnShieldGenerator(gctx: GroundContext): void {
    // Create shield generator entity
    const eid = addEntity(gctx.ctx.world);
    addComponent(gctx.ctx.world, Transform, eid);
    addComponent(gctx.ctx.world, ShieldGenerator, eid);
    addComponent(gctx.ctx.world, Team, eid);

    Transform.x[eid] = -50;
    Transform.y[eid] = 0;
    Transform.z[eid] = -60;

    ShieldGenerator.health[eid] = this.state.baseIntegrityMax;
    ShieldGenerator.maxHealth[eid] = this.state.baseIntegrityMax;
    ShieldGenerator.shieldRadius[eid] = 500;
    ShieldGenerator.active[eid] = 1;

    Team.id[eid] = 0;

    this.shieldGenEid = eid;

    // Build mesh
    const group = new THREE.Group();

    // Main dish
    const dishGeo = new THREE.SphereGeometry(8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0x556677,
      roughness: 0.3,
      metalness: 0.7
    });
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.rotation.x = Math.PI;
    dish.position.y = 15;
    group.add(dish);

    // Support tower
    const towerGeo = new THREE.CylinderGeometry(2, 3, 15, 8);
    const tower = new THREE.Mesh(towerGeo, dishMat);
    tower.position.y = 7.5;
    group.add(tower);

    // Base
    const baseGeo = new THREE.CylinderGeometry(6, 6, 2, 12);
    const base = new THREE.Mesh(baseGeo, dishMat);
    base.position.y = 1;
    group.add(base);

    group.position.set(-50, 0, -60);
    group.traverse(c => {
      c.castShadow = true;
      c.receiveShadow = true;
    });

    this.shieldGenMesh = group;
    gctx.ctx.scene.add(group);
  }

  private spawnTurrets(gctx: GroundContext): void {
    const turretPositions = [
      { x: -40, z: 10, type: TURRET_TYPE.DF_9 },
      { x: 40, z: 10, type: TURRET_TYPE.DF_9 },
      { x: -20, z: 25, type: TURRET_TYPE.E_WEB },
      { x: 20, z: 25, type: TURRET_TYPE.E_WEB },
    ];

    for (const pos of turretPositions) {
      const eid = spawnTurret(gctx.ctx.world, pos.x, 0, pos.z, pos.type, 0);
      this.turretEids.push(eid);

      // Build mesh
      const mesh = this.buildTurretMesh(pos.type);
      mesh.position.set(pos.x, 0, pos.z);
      gctx.ctx.scene.add(mesh);
      this.turretMeshes.set(eid, mesh);
    }
  }

  private buildTurretMesh(type: number): THREE.Object3D {
    const group = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x444455,
      roughness: 0.4,
      metalness: 0.6
    });

    if (type === TURRET_TYPE.DF_9) {
      // Large anti-vehicle turret
      const baseGeo = new THREE.CylinderGeometry(1.5, 2, 1, 8);
      const base = new THREE.Mesh(baseGeo, metalMat);
      base.position.y = 0.5;
      group.add(base);

      const turretGeo = new THREE.BoxGeometry(1.5, 1, 2.5);
      const turret = new THREE.Mesh(turretGeo, metalMat);
      turret.position.y = 1.5;
      group.add(turret);

      const barrelGeo = new THREE.CylinderGeometry(0.15, 0.15, 2, 8);
      const barrel = new THREE.Mesh(barrelGeo, metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 1.5, -2);
      group.add(barrel);
    } else {
      // E-Web repeating blaster
      const tripodGeo = new THREE.ConeGeometry(0.8, 1, 3);
      const tripod = new THREE.Mesh(tripodGeo, metalMat);
      tripod.rotation.x = Math.PI;
      tripod.position.y = 0.5;
      group.add(tripod);

      const gunGeo = new THREE.BoxGeometry(0.4, 0.3, 1.2);
      const gun = new THREE.Mesh(gunGeo, metalMat);
      gun.position.set(0, 1, -0.3);
      group.add(gun);

      const barrelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6);
      const barrel1 = new THREE.Mesh(barrelGeo, metalMat);
      barrel1.rotation.x = Math.PI / 2;
      barrel1.position.set(-0.1, 1, -1);
      group.add(barrel1);

      const barrel2 = new THREE.Mesh(barrelGeo, metalMat);
      barrel2.rotation.x = Math.PI / 2;
      barrel2.position.set(0.1, 1, -1);
      group.add(barrel2);
    }

    group.traverse(c => {
      c.castShadow = true;
    });

    return group;
  }

  private spawnWave(gctx: GroundContext, waveNum: number): void {
    const count = 3 + waveNum * 2; // 5, 7, 9, ...
    const spawnZ = 150 + waveNum * 30; // Spawn further back each wave

    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-60, 60);
      const z = spawnZ + this.rng.range(-20, 20);
      const eid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, x, 1, z, 1, 0, true);
      gctx.enemyEids.push(eid);
    }

    this.state.message = `WAVE ${waveNum} INCOMING!`;
    this.state.messageTimer = 3;
  }

  private spawnATAT(gctx: GroundContext): void {
    const eid = spawnATATWalker(
      gctx.ctx.world,
      0,           // x
      300,         // z (spawn far away)
      -50,         // target x (shield generator)
      -60,         // target z
      Date.now()   // seed
    );
    this.atatEids.push(eid);
    this.state.atatCount++;

    // Build AT-AT mesh
    const mesh = this.buildATATMesh();
    mesh.position.set(0, 22, 300);
    gctx.ctx.scene.add(mesh);
    this.atatMeshes.set(eid, mesh);
  }

  private buildATATMesh(): THREE.Object3D {
    const group = new THREE.Group();
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x888899,
      roughness: 0.4,
      metalness: 0.3
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x333344,
      roughness: 0.6
    });

    // Body (main transport section)
    const bodyGeo = new THREE.BoxGeometry(8, 6, 15);
    const body = new THREE.Mesh(bodyGeo, armorMat);
    body.position.y = 0;
    group.add(body);

    // Head (wedge-shaped cockpit)
    const headGeo = new THREE.BoxGeometry(4, 3, 5);
    const head = new THREE.Mesh(headGeo, armorMat);
    head.position.set(0, 1, -10);
    group.add(head);

    // Viewport
    const viewportGeo = new THREE.BoxGeometry(2.5, 0.5, 0.2);
    const viewport = new THREE.Mesh(viewportGeo, darkMat);
    viewport.position.set(0, 1.5, -12.6);
    group.add(viewport);

    // Chin lasers
    const laserGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
    const laserL = new THREE.Mesh(laserGeo, darkMat);
    laserL.rotation.x = Math.PI / 2;
    laserL.position.set(-1, 0, -13);
    group.add(laserL);

    const laserR = new THREE.Mesh(laserGeo, darkMat);
    laserR.rotation.x = Math.PI / 2;
    laserR.position.set(1, 0, -13);
    group.add(laserR);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(1.5, 1.5, 3, 8);
    const neck = new THREE.Mesh(neckGeo, armorMat);
    neck.position.set(0, 0, -7);
    neck.rotation.x = Math.PI / 4;
    group.add(neck);

    // Legs (simplified - 4 legs)
    const legGeo = new THREE.BoxGeometry(1, 18, 1);
    const legPositions = [
      { x: -3, z: -4 },
      { x: 3, z: -4 },
      { x: -3, z: 4 },
      { x: 3, z: 4 },
    ];

    for (const pos of legPositions) {
      const leg = new THREE.Mesh(legGeo, armorMat);
      leg.position.set(pos.x, -12, pos.z);
      group.add(leg);

      // Foot
      const footGeo = new THREE.BoxGeometry(2, 1, 3);
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.position.set(pos.x, -21.5, pos.z);
      group.add(foot);
    }

    group.traverse(c => {
      c.castShadow = true;
      c.receiveShadow = true;
    });

    return group;
  }

  private buildSpeeder(gctx: GroundContext): void {
    const group = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.3
    });
    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xff6644,
      roughness: 0.4
    });

    // Main hull
    const hullGeo = new THREE.BoxGeometry(2, 0.8, 5);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    group.add(hull);

    // Cockpit
    const cockpitGeo = new THREE.BoxGeometry(1.2, 0.6, 2);
    const cockpit = new THREE.Mesh(cockpitGeo, orangeMat);
    cockpit.position.set(0, 0.5, -1);
    group.add(cockpit);

    // Engines
    const engineGeo = new THREE.CylinderGeometry(0.5, 0.4, 2, 8);
    const engineL = new THREE.Mesh(engineGeo, hullMat);
    engineL.rotation.x = Math.PI / 2;
    engineL.position.set(-1.2, 0, 2);
    group.add(engineL);

    const engineR = new THREE.Mesh(engineGeo, hullMat);
    engineR.rotation.x = Math.PI / 2;
    engineR.position.set(1.2, 0, 2);
    group.add(engineR);

    group.position.set(25, 1, 20);
    group.traverse(c => {
      c.castShadow = true;
    });

    this.snowspeederMesh = group;
    gctx.ctx.scene.add(group);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Update Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private syncATATMeshes(gctx: GroundContext): void {
    for (const eid of this.atatEids) {
      const mesh = this.atatMeshes.get(eid);
      if (!mesh) continue;

      if (!hasComponent(gctx.ctx.world, ATATWalker, eid)) {
        // AT-AT destroyed
        gctx.ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.atatMeshes.delete(eid);
        continue;
      }

      // Sync position
      mesh.position.set(
        Transform.x[eid] ?? 0,
        Transform.y[eid] ?? 22,
        Transform.z[eid] ?? 0
      );

      // Sync rotation
      mesh.quaternion.set(
        Transform.qx[eid] ?? 0,
        Transform.qy[eid] ?? 0,
        Transform.qz[eid] ?? 0,
        Transform.qw[eid] ?? 1
      );

      // Check if tripped
      const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;
      if (state === ATAT_STATE.DOWN && !this.state.atatTripped) {
        this.state.atatTripped++;
        this.state.message = "AT-AT DOWN! FINISH IT OFF!";
        this.state.messageTimer = 3;
      }
    }
  }

  private syncEnemyMeshes(gctx: GroundContext): void {
    for (let i = gctx.enemyEids.length - 1; i >= 0; i--) {
      const eid = gctx.enemyEids[i]!;
      if (
        !hasComponent(gctx.ctx.world, Transform, eid) ||
        !hasComponent(gctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        const mesh = gctx.enemyMeshes.get(eid);
        if (mesh) {
          gctx.explosions?.spawn(
            new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
            0xff6666
          );
          gctx.ctx.scene.remove(mesh);
          gctx.enemyMeshes.delete(eid);
        }
        removeEntity(gctx.ctx.world, eid);
        gctx.enemyEids.splice(i, 1);
        this.state.enemiesKilledThisWave++;
      }
    }
  }

  private checkShieldGenerator(gctx: GroundContext): void {
    if (!this.shieldGenEid) return;
    if (!hasComponent(gctx.ctx.world, ShieldGenerator, this.shieldGenEid)) return;

    const health = ShieldGenerator.health[this.shieldGenEid] ?? 0;
    this.state.baseIntegrity = health;

    if (health <= 0 && this.state.phase !== "evacuation" && this.state.phase !== "fail") {
      this.state.phase = "evacuation";
      this.state.message = "SHIELD GENERATOR DESTROYED! EVACUATE!";
      this.state.messageTimer = 5;

      // Explosion effect
      if (this.shieldGenMesh) {
        gctx.explosions?.spawn(
          new THREE.Vector3(
            this.shieldGenMesh.position.x,
            this.shieldGenMesh.position.y + 10,
            this.shieldGenMesh.position.z
          ),
          0xff8844,
          1.0,
          15
        );
      }
    }
  }

  private updateIonCannon(gctx: GroundContext, dt: number): void {
    if (this.ionCannonFired) return;

    this.ionCannonTimer -= dt;
    if (this.ionCannonTimer <= 0) {
      this.ionCannonFired = true;
      this.state.message = "ION CANNON FIRING! FIRST TRANSPORT IS AWAY!";
      this.state.messageTimer = 4;
      this.state.transportsEvacuated++;

      // Visual effect - bright flash
      const flash = new THREE.PointLight(0x4488ff, 50, 500);
      flash.position.set(-50, 50, -60);
      gctx.ctx.scene.add(flash);

      // Remove flash after short time
      setTimeout(() => {
        gctx.ctx.scene.remove(flash);
        flash.dispose();
      }, 500);
    }
  }

  private checkSpeederProximity(gctx: GroundContext): void {
    if (!gctx.playerEid || !this.snowspeederMesh) {
      this.nearSpeeder = false;
      return;
    }

    const px = Transform.x[gctx.playerEid] ?? 0;
    const pz = Transform.z[gctx.playerEid] ?? 0;
    const sx = this.snowspeederMesh.position.x;
    const sz = this.snowspeederMesh.position.z;

    const dist = Math.sqrt((px - sx) ** 2 + (pz - sz) ** 2);
    this.nearSpeeder = dist < 5;
  }

  private updatePhase(_gctx: GroundContext): void {
    // Phase transitions handled by specific events
    // Success: All AT-ATs destroyed
    if (this.state.phase === "breach" && this.atatEids.length === 0 && this.state.atatCount > 0) {
      this.state.phase = "success";
      this.state.message = "VICTORY! ECHO BASE DEFENDED!";
      this.state.messageTimer = 10;
    }
  }

  private getPhaseMessage(): string {
    switch (this.state.phase) {
      case "trenches":
        return `WAVE ${this.state.waveNumber + 1} - HOLD THE LINE`;
      case "breach":
        return "GET TO THE SNOWSPEEDER! (Press E near speeder)";
      case "evacuation":
        return "EVACUATE TO TRANSPORT HANGAR!";
      case "success":
        return "VICTORY! ECHO BASE DEFENDED!";
      case "fail":
        return "ECHO BASE LOST";
      default:
        return "DEFEND ECHO BASE";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Effect Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnATATLaserEffect(gctx: GroundContext, _fire: any): void {
    // Create green laser beam (Empire color)
    // This would be expanded with proper beam rendering
    gctx.explosions?.spawn(
      new THREE.Vector3(_fire.targetX, _fire.targetY, _fire.targetZ),
      0x44ff44,
      0.3,
      4
    );
  }

  private spawnTurretLaserEffect(gctx: GroundContext, fire: any): void {
    // Red laser for Rebel turrets
    const dir = new THREE.Vector3(
      Math.sin(fire.yaw) * Math.cos(fire.pitch),
      Math.sin(fire.pitch),
      -Math.cos(fire.yaw) * Math.cos(fire.pitch)
    );
    const endPos = new THREE.Vector3(fire.x, fire.y, fire.z).add(dir.multiplyScalar(50));

    gctx.explosions?.spawn(endPos, 0xff4444, 0.1, 1.5);
  }
}
