/**
 * HothSpeederScenario - T-47 Snowspeeder Tow Cable Runs (Mission 5 Phase 2)
 *
 * "Use your harpoons and tow cables. Go for the legs. It might be
 * our only chance of stopping them." - Luke Skywalker
 *
 * Low-altitude flight over Hoth ice plains with tow cable mechanics
 * to take down AT-AT walkers.
 */

import * as THREE from "three";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";
import { type SystemDef } from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  FighterBrain,
  Health,
  HitRadius,
  LaserWeapon,
  Ship,
  Targetable,
  Team,
  Transform,
  Velocity
} from "@xwingz/gameplay";
import { ATATWalker, ATAT_STATE, CABLE_STATE } from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import { disposeObject } from "../../rendering/MeshManager";
import type { ExplosionManager } from "../../rendering/effects";
import type { FlightHudElements } from "./FlightScenarioTypes";
import { updatePlayerHudValues, clearTargetBracket } from "./FlightShared";

// ─────────────────────────────────────────────────────────────────────────────
// Hoth Speeder Context
// ─────────────────────────────────────────────────────────────────────────────

export interface HothSpeederContext {
  ctx: ModeContext;
  currentSystem: SystemDef | null;
  shipEid: number | null;
  targetEids: number[];
  targetMeshes: Map<number, THREE.Object3D>;
  projectileMeshes: Map<number, THREE.Mesh>;
  explosions: ExplosionManager | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission State
// ─────────────────────────────────────────────────────────────────────────────

interface HothSpeederState {
  phase: "approach" | "engage" | "wrapping" | "success" | "fail";
  atatCount: number;
  atatTripped: number;
  message: string;
  messageTimer: number;
  rewardCredits: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hoth Speeder Scenario Handler
// ─────────────────────────────────────────────────────────────────────────────

export class HothSpeederScenario {
  // Terrain
  private groundMesh: THREE.Mesh | null = null;
  private rockMeshes: THREE.Object3D[] = [];

  // AT-AT tracking
  private atatEids: number[] = [];
  private atatMeshes = new Map<number, THREE.Object3D>();

  // Tow cable state
  private cableState: (typeof CABLE_STATE)[keyof typeof CABLE_STATE] = CABLE_STATE.READY;
  private cableTargetEid = -1;
  private cableWraps = 0;
  private cableStrength = 100;
  private orbitAngle = 0;
  private readonly WRAPS_NEEDED = 3;
  private readonly MIN_WRAP_SPEED = 80; // m/s - below this cable breaks

  // Tow cable visual
  private cableLine: THREE.Line | null = null;
  private cableMaterial: THREE.LineBasicMaterial | null = null;

  // Wingmen
  private allyEids: number[] = [];
  private allyMeshes = new Map<number, THREE.Object3D>();

  // Mission state
  private state: HothSpeederState = {
    phase: "approach",
    atatCount: 2,
    atatTripped: 0,
    message: "APPROACH THE AT-AT WALKERS",
    messageTimer: 5,
    rewardCredits: 1500
  };

  // Temp vectors
  private tmpVec = new THREE.Vector3();

  enter(hctx: HothSpeederContext): void {

    // Build Hoth terrain for flight
    this.buildHothFlightTerrain(hctx);

    // Spawn AT-ATs
    this.spawnATATs(hctx);

    // Spawn wingmen
    this.spawnWingmen(hctx);

    // Initialize cable material
    this.cableMaterial = new THREE.LineBasicMaterial({
      color: 0xcccccc,
      linewidth: 2
    });

    // Position player snowspeeder
    if (hctx.shipEid !== null) {
      Transform.x[hctx.shipEid] = 0;
      Transform.y[hctx.shipEid] = 30; // Low altitude
      Transform.z[hctx.shipEid] = 200;
      Velocity.vx[hctx.shipEid] = 0;
      Velocity.vy[hctx.shipEid] = 0;
      Velocity.vz[hctx.shipEid] = -50;
      Ship.throttle[hctx.shipEid] = 0.7;
    }

    this.state.phase = "approach";
    this.state.message = "APPROACH THE AT-AT WALKERS - TARGET THEIR LEGS";
    this.state.messageTimer = 5;
  }

  tick(hctx: HothSpeederContext, dt: number): boolean {
    // Update message timer
    if (this.state.messageTimer > 0) {
      this.state.messageTimer -= dt;
    }

    // Run AT-AT systems (imported from ground)
    // Note: In a full implementation, these would be space-domain AT-ATs
    this.updateATATs(hctx, dt);

    // Update tow cable mechanics
    this.updateTowCable(hctx, dt);

    // Update cable visual
    this.updateCableVisual(hctx);

    // Sync AT-AT meshes
    this.syncATATMeshes(hctx);

    // Sync ally meshes
    this.syncAllyMeshes(hctx);

    // Check altitude limits (low-altitude flight)
    this.clampAltitude(hctx);

    // Check victory/defeat
    this.updatePhase(hctx);

    return false;
  }

  handleHyperspace(_hctx: HothSpeederContext): boolean {
    // Can't hyperspace during Hoth battle
    if (this.state.phase !== "success" && this.state.phase !== "fail") {
      this.state.message = "CANNOT RETREAT - COMPLETE THE MISSION";
      this.state.messageTimer = 2;
      return false;
    }
    return true;
  }

  updateHud(hctx: HothSpeederContext, els: FlightHudElements, _dt: number): void {
    updatePlayerHudValues(els, hctx.shipEid, hctx.ctx);

    // Mission info
    if (this.state.messageTimer > 0) {
      els.mission.textContent = this.state.message;
    } else {
      els.mission.textContent = this.getPhaseMessage();
    }

    // Tow cable status in system slot
    if (this.cableState === CABLE_STATE.WRAPPING) {
      els.system.textContent = `CABLE: ${Math.round(this.cableStrength)}% | WRAPS: ${this.cableWraps}/${this.WRAPS_NEEDED}`;
    } else if (this.cableState === CABLE_STATE.READY) {
      els.system.textContent = "CABLE: READY (F to fire)";
    } else if (this.cableState === CABLE_STATE.ATTACHED) {
      els.system.textContent = "CABLE ATTACHED - CIRCLE THE LEGS!";
    }

    // AT-AT count
    els.credits.textContent = `AT-ATs: ${this.state.atatCount - this.state.atatTripped}/${this.state.atatCount}`;

    // Clear target bracket for now (simplified)
    clearTargetBracket(els);
  }

  getMissionMessage(_hctx: HothSpeederContext): string {
    if (this.state.messageTimer > 0) return this.state.message;
    return this.getPhaseMessage();
  }

  canLand(_hctx: HothSpeederContext): boolean {
    // Can land after mission complete
    return this.state.phase === "success" || this.state.phase === "fail";
  }

  exit(hctx: HothSpeederContext): void {
    // Clean up terrain
    if (this.groundMesh) {
      hctx.ctx.scene.remove(this.groundMesh);
      disposeObject(this.groundMesh);
      this.groundMesh = null;
    }
    for (const mesh of this.rockMeshes) {
      hctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.rockMeshes = [];

    // Clean up AT-ATs
    for (const eid of this.atatEids) {
      removeEntity(hctx.ctx.world, eid);
    }
    this.atatEids = [];
    for (const mesh of this.atatMeshes.values()) {
      hctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.atatMeshes.clear();

    // Clean up allies
    for (const eid of this.allyEids) {
      removeEntity(hctx.ctx.world, eid);
    }
    this.allyEids = [];
    for (const mesh of this.allyMeshes.values()) {
      hctx.ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.allyMeshes.clear();

    // Clean up cable
    if (this.cableLine) {
      hctx.ctx.scene.remove(this.cableLine);
      this.cableLine.geometry.dispose();
      this.cableLine = null;
    }
    if (this.cableMaterial) {
      this.cableMaterial.dispose();
      this.cableMaterial = null;
    }

    // Reset fog
    hctx.ctx.scene.fog = null;
    hctx.ctx.scene.background = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildHothFlightTerrain(hctx: HothSpeederContext): void {
    // White fog for Hoth atmosphere
    hctx.ctx.scene.fog = new THREE.Fog(0xc8d8e8, 200, 2000);
    hctx.ctx.scene.background = new THREE.Color(0xddeeff);

    // Large snow terrain
    const size = 4000;
    const segments = 80;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);

    // Add height variation
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      const height = Math.sin(x * 0.005) * Math.cos(z * 0.005) * 8 +
                     Math.sin(x * 0.02) * 2;
      pos.setZ(i, height);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4ff,
      roughness: 0.95
    });

    this.groundMesh = new THREE.Mesh(geo, snowMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    hctx.ctx.scene.add(this.groundMesh);

    // Add ice formations
    this.addIceFormations(hctx);
  }

  private addIceFormations(hctx: HothSpeederContext): void {
    const rockGeo = new THREE.DodecahedronGeometry(15, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xaaccff,
      roughness: 0.5
    });

    const positions = [
      { x: 200, z: -100, scale: 1.5 },
      { x: -300, z: 50, scale: 2.0 },
      { x: 150, z: 200, scale: 1.2 },
      { x: -200, z: -200, scale: 1.8 },
      { x: 400, z: 100, scale: 2.5 },
    ];

    for (const p of positions) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(p.x, p.scale * 8, p.z);
      rock.scale.setScalar(p.scale);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      rock.castShadow = true;
      rock.receiveShadow = true;
      hctx.ctx.scene.add(rock);
      this.rockMeshes.push(rock);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AT-AT Spawning and Management
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnATATs(hctx: HothSpeederContext): void {
    // Spawn 2 AT-ATs
    const positions = [
      { x: -80, z: -100 },
      { x: 80, z: -150 },
    ];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]!;
      const eid = this.createFlightATAT(hctx, pos.x, pos.z, i);
      this.atatEids.push(eid);

      // Build mesh
      const mesh = this.buildATATMesh();
      mesh.position.set(pos.x, 22, pos.z);
      hctx.ctx.scene.add(mesh);
      this.atatMeshes.set(eid, mesh);
    }
  }

  private createFlightATAT(hctx: HothSpeederContext, x: number, z: number, _index: number): number {
    const eid = addEntity(hctx.ctx.world);

    addComponent(hctx.ctx.world, Transform, eid);
    addComponent(hctx.ctx.world, Health, eid);
    addComponent(hctx.ctx.world, Team, eid);
    addComponent(hctx.ctx.world, Targetable, eid);
    addComponent(hctx.ctx.world, HitRadius, eid);
    addComponent(hctx.ctx.world, ATATWalker, eid);

    Transform.x[eid] = x;
    Transform.y[eid] = 22;
    Transform.z[eid] = z;
    Transform.qx[eid] = 0;
    Transform.qy[eid] = 0;
    Transform.qz[eid] = 0;
    Transform.qw[eid] = 1;

    Health.hp[eid] = 5000;
    Health.maxHp[eid] = 5000;
    HitRadius.r[eid] = 15;

    Team.id[eid] = 1; // Empire

    // AT-AT specific
    ATATWalker.state[eid] = ATAT_STATE.ADVANCING;
    ATATWalker.walkSpeed[eid] = 5;
    ATATWalker.cableWraps[eid] = 0;
    ATATWalker.cableAttached[eid] = 0;
    ATATWalker.legPhase[eid] = 0;
    ATATWalker.targetX[eid] = 0;
    ATATWalker.targetZ[eid] = -500; // Walking toward Echo Base

    return eid;
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

    // Body
    const bodyGeo = new THREE.BoxGeometry(8, 6, 15);
    const body = new THREE.Mesh(bodyGeo, armorMat);
    group.add(body);

    // Head
    const headGeo = new THREE.BoxGeometry(4, 3, 5);
    const head = new THREE.Mesh(headGeo, armorMat);
    head.position.set(0, 1, -10);
    group.add(head);

    // Legs
    const legGeo = new THREE.BoxGeometry(1, 18, 1);
    const legPos = [
      { x: -3, z: -4 },
      { x: 3, z: -4 },
      { x: -3, z: 4 },
      { x: 3, z: 4 },
    ];
    for (const p of legPos) {
      const leg = new THREE.Mesh(legGeo, armorMat);
      leg.position.set(p.x, -12, p.z);
      group.add(leg);

      const footGeo = new THREE.BoxGeometry(2, 1, 3);
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.position.set(p.x, -21.5, p.z);
      group.add(foot);
    }

    group.traverse(c => {
      c.castShadow = true;
      c.receiveShadow = true;
    });

    return group;
  }

  private updateATATs(hctx: HothSpeederContext, dt: number): void {
    for (const eid of this.atatEids) {
      if (!hasComponent(hctx.ctx.world, ATATWalker, eid)) continue;

      const state = ATATWalker.state[eid] ?? ATAT_STATE.ADVANCING;

      if (state === ATAT_STATE.ADVANCING) {
        // Walk toward target
        const z = Transform.z[eid] ?? 0;
        const speed = ATATWalker.walkSpeed[eid] ?? 5;

        Transform.z[eid] = z - speed * dt;

        // Update leg animation
        ATATWalker.legPhase[eid] = ((ATATWalker.legPhase[eid] ?? 0) + dt * 2) % (Math.PI * 2);

        // Check cable wraps
        const wraps = ATATWalker.cableWraps[eid] ?? 0;
        if (wraps >= this.WRAPS_NEEDED) {
          ATATWalker.state[eid] = ATAT_STATE.FALLING;
          ATATWalker.stateTimer[eid] = 3.0;
          this.state.message = "AT-AT GOING DOWN!";
          this.state.messageTimer = 3;
        }
      } else if (state === ATAT_STATE.FALLING) {
        const timer = ATATWalker.stateTimer[eid] ?? 0;
        ATATWalker.stateTimer[eid] = timer - dt;

        // Fall animation
        const progress = 1 - (timer - dt) / 3.0;
        Transform.qx[eid] = Math.sin((progress * Math.PI / 2) / 2);
        Transform.qw[eid] = Math.cos((progress * Math.PI / 2) / 2);
        Transform.y[eid] = Math.max(5, 22 * (1 - progress));

        if (timer - dt <= 0) {
          ATATWalker.state[eid] = ATAT_STATE.DOWN;
          this.state.atatTripped++;

          // Explosion
          const mesh = this.atatMeshes.get(eid);
          if (mesh) {
            hctx.explosions?.spawn(
              this.tmpVec.copy(mesh.position),
              0xff8844,
              1.0,
              20
            );
          }
        }
      }
    }
  }

  private syncATATMeshes(_hctx: HothSpeederContext): void {
    for (const eid of this.atatEids) {
      const mesh = this.atatMeshes.get(eid);
      if (!mesh) continue;

      mesh.position.set(
        Transform.x[eid] ?? 0,
        Transform.y[eid] ?? 22,
        Transform.z[eid] ?? 0
      );
      mesh.quaternion.set(
        Transform.qx[eid] ?? 0,
        Transform.qy[eid] ?? 0,
        Transform.qz[eid] ?? 0,
        Transform.qw[eid] ?? 1
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tow Cable Mechanics
  // ─────────────────────────────────────────────────────────────────────────────

  private updateTowCable(hctx: HothSpeederContext, dt: number): void {
    if (hctx.shipEid === null) return;

    const px = Transform.x[hctx.shipEid] ?? 0;
    const pz = Transform.z[hctx.shipEid] ?? 0;
    const speed = Math.sqrt(
      (Velocity.vx[hctx.shipEid] ?? 0) ** 2 +
      (Velocity.vz[hctx.shipEid] ?? 0) ** 2
    );

    switch (this.cableState) {
      case CABLE_STATE.READY:
        // Check for cable fire input (simplified - would use actual input)
        // For now, auto-attach when close to AT-AT and not already attached
        for (const eid of this.atatEids) {
          if ((ATATWalker.state[eid] ?? 0) !== ATAT_STATE.ADVANCING) continue;

          const ax = Transform.x[eid] ?? 0;
          const az = Transform.z[eid] ?? 0;
          const dist = Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);

          if (dist < 60 && dist > 30) {
            this.cableState = CABLE_STATE.ATTACHED;
            this.cableTargetEid = eid;
            this.cableWraps = 0;
            this.cableStrength = 100;
            this.orbitAngle = Math.atan2(px - ax, pz - az);
            ATATWalker.cableAttached[eid] = 1;
            this.state.message = "CABLE ATTACHED! MAINTAIN SPEED AND CIRCLE!";
            this.state.messageTimer = 3;
          }
        }
        break;

      case CABLE_STATE.ATTACHED:
        // Transition to wrapping
        this.cableState = CABLE_STATE.WRAPPING;
        break;

      case CABLE_STATE.WRAPPING:
        if (this.cableTargetEid < 0) {
          this.cableState = CABLE_STATE.READY;
          break;
        }

        const ax = Transform.x[this.cableTargetEid] ?? 0;
        const az = Transform.z[this.cableTargetEid] ?? 0;

        // Check speed - cable breaks if too slow
        if (speed < this.MIN_WRAP_SPEED) {
          this.cableStrength -= dt * 30; // Lose 30% per second at low speed
          if (this.cableStrength <= 0) {
            this.cableState = CABLE_STATE.BROKEN;
            ATATWalker.cableAttached[this.cableTargetEid] = 0;
            this.state.message = "CABLE SNAPPED! SPEED UP!";
            this.state.messageTimer = 2;
            break;
          }
        } else {
          // Recover strength at high speed
          this.cableStrength = Math.min(100, this.cableStrength + dt * 10);
        }

        // Calculate orbit progress
        const newAngle = Math.atan2(px - ax, pz - az);
        let angleDiff = newAngle - this.orbitAngle;

        // Handle angle wrapping
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Accumulate wraps (full circle = 2*PI)
        if (Math.abs(angleDiff) > 0.1) {
          const wrapProgress = Math.abs(angleDiff) / (Math.PI * 2);
          if (wrapProgress > 0.9 && this.cableWraps < this.WRAPS_NEEDED) {
            this.cableWraps++;
            ATATWalker.cableWraps[this.cableTargetEid] = this.cableWraps;

            if (this.cableWraps >= this.WRAPS_NEEDED) {
              this.cableState = CABLE_STATE.RELEASED;
              ATATWalker.cableAttached[this.cableTargetEid] = 0;
              this.state.message = `WRAP COMPLETE! AT-AT TRIPPED!`;
              this.state.messageTimer = 3;
            } else {
              this.state.message = `WRAP ${this.cableWraps}/${this.WRAPS_NEEDED} COMPLETE!`;
              this.state.messageTimer = 1;
            }
          }
        }
        this.orbitAngle = newAngle;
        break;

      case CABLE_STATE.BROKEN:
        // Cooldown before can fire again
        setTimeout(() => {
          this.cableState = CABLE_STATE.READY;
          this.cableTargetEid = -1;
        }, 3000);
        this.cableState = CABLE_STATE.READY; // Reset immediately for simplicity
        this.cableTargetEid = -1;
        break;

      case CABLE_STATE.RELEASED:
        this.cableState = CABLE_STATE.READY;
        this.cableTargetEid = -1;
        break;
    }
  }

  private updateCableVisual(hctx: HothSpeederContext): void {
    if (this.cableState !== CABLE_STATE.WRAPPING || hctx.shipEid === null || this.cableTargetEid < 0) {
      // Remove cable visual
      if (this.cableLine) {
        hctx.ctx.scene.remove(this.cableLine);
        this.cableLine.geometry.dispose();
        this.cableLine = null;
      }
      return;
    }

    // Create or update cable
    const px = Transform.x[hctx.shipEid] ?? 0;
    const py = (Transform.y[hctx.shipEid] ?? 30) - 1;
    const pz = Transform.z[hctx.shipEid] ?? 0;

    const ax = Transform.x[this.cableTargetEid] ?? 0;
    const ay = 5; // Cable attaches low on AT-AT legs
    const az = Transform.z[this.cableTargetEid] ?? 0;

    const points = [
      new THREE.Vector3(px, py, pz),
      new THREE.Vector3(ax, ay, az)
    ];

    if (this.cableLine) {
      this.cableLine.geometry.dispose();
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.cableLine = new THREE.Line(geometry, this.cableMaterial!);
    hctx.ctx.scene.add(this.cableLine);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Wingmen
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnWingmen(hctx: HothSpeederContext): void {
    // Spawn 2 wingmen
    const positions = [
      { x: -20, z: 180 },
      { x: 20, z: 180 },
    ];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]!;
      const eid = this.createWingman(hctx, pos.x, pos.z, i);
      this.allyEids.push(eid);

      const mesh = this.buildSpeederMesh();
      mesh.position.set(pos.x, 30, pos.z);
      mesh.scale.setScalar(2);
      hctx.ctx.scene.add(mesh);
      this.allyMeshes.set(eid, mesh);
    }
  }

  private createWingman(hctx: HothSpeederContext, x: number, z: number, _index: number): number {
    const eid = addEntity(hctx.ctx.world);

    addComponent(hctx.ctx.world, Transform, eid);
    addComponent(hctx.ctx.world, Velocity, eid);
    addComponent(hctx.ctx.world, AngularVelocity, eid);
    addComponent(hctx.ctx.world, Team, eid);
    addComponent(hctx.ctx.world, Ship, eid);
    addComponent(hctx.ctx.world, Health, eid);
    addComponent(hctx.ctx.world, LaserWeapon, eid);
    addComponent(hctx.ctx.world, FighterBrain, eid);
    addComponent(hctx.ctx.world, AIControlled, eid);

    Transform.x[eid] = x;
    Transform.y[eid] = 30;
    Transform.z[eid] = z;

    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;
    Velocity.vz[eid] = -40;

    Team.id[eid] = 0;
    Ship.throttle[eid] = 0.6;
    Ship.maxSpeed[eid] = 150;

    Health.hp[eid] = 100;
    Health.maxHp[eid] = 100;

    return eid;
  }

  private buildSpeederMesh(): THREE.Object3D {
    const group = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3 });
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff6644, roughness: 0.4 });

    const hullGeo = new THREE.BoxGeometry(1, 0.4, 2.5);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    group.add(hull);

    const cockpitGeo = new THREE.BoxGeometry(0.6, 0.3, 1);
    const cockpit = new THREE.Mesh(cockpitGeo, orangeMat);
    cockpit.position.set(0, 0.25, -0.5);
    group.add(cockpit);

    const engineGeo = new THREE.CylinderGeometry(0.25, 0.2, 1, 8);
    const engineL = new THREE.Mesh(engineGeo, hullMat);
    engineL.rotation.x = Math.PI / 2;
    engineL.position.set(-0.6, 0, 1);
    group.add(engineL);

    const engineR = new THREE.Mesh(engineGeo, hullMat);
    engineR.rotation.x = Math.PI / 2;
    engineR.position.set(0.6, 0, 1);
    group.add(engineR);

    return group;
  }

  private syncAllyMeshes(hctx: HothSpeederContext): void {
    for (let i = this.allyEids.length - 1; i >= 0; i--) {
      const eid = this.allyEids[i]!;

      if (!hasComponent(hctx.ctx.world, Health, eid) || (Health.hp[eid] ?? 0) <= 0) {
        const mesh = this.allyMeshes.get(eid);
        if (mesh) {
          hctx.explosions?.spawn(this.tmpVec.copy(mesh.position), 0x66aaff);
          hctx.ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.allyMeshes.delete(eid);
        }
        this.allyEids.splice(i, 1);
        continue;
      }

      const mesh = this.allyMeshes.get(eid);
      if (mesh) {
        mesh.position.set(
          Transform.x[eid] ?? 0,
          Transform.y[eid] ?? 30,
          Transform.z[eid] ?? 0
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private clampAltitude(hctx: HothSpeederContext): void {
    if (hctx.shipEid === null) return;

    const y = Transform.y[hctx.shipEid] ?? 30;
    const minAlt = 10;
    const maxAlt = 60;

    if (y < minAlt) {
      Transform.y[hctx.shipEid] = minAlt;
      if ((Velocity.vy[hctx.shipEid] ?? 0) < 0) {
        Velocity.vy[hctx.shipEid] = 0;
      }
    }
    if (y > maxAlt) {
      Transform.y[hctx.shipEid] = maxAlt;
      if ((Velocity.vy[hctx.shipEid] ?? 0) > 0) {
        Velocity.vy[hctx.shipEid] = 0;
      }
    }
  }

  private updatePhase(_hctx: HothSpeederContext): void {
    // Check victory
    if (this.state.atatTripped >= this.state.atatCount && this.state.phase !== "success") {
      this.state.phase = "success";
      this.state.message = "ALL AT-ATs DESTROYED! VICTORY!";
      this.state.messageTimer = 10;
    }

    // Update phase based on progress
    if (this.state.phase === "approach" && this.cableState !== CABLE_STATE.READY) {
      this.state.phase = "engage";
    }
  }

  private getPhaseMessage(): string {
    switch (this.state.phase) {
      case "approach":
        return "APPROACH AT-ATs - GET WITHIN CABLE RANGE";
      case "engage":
        return `WRAPPING: ${this.cableWraps}/${this.WRAPS_NEEDED} | STRENGTH: ${Math.round(this.cableStrength)}%`;
      case "success":
        return "VICTORY! PRESS M FOR MAP";
      case "fail":
        return "MISSION FAILED";
      default:
        return "ENGAGE AT-AT WALKERS";
    }
  }
}
