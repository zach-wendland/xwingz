/**
 * GroundMode - Battlefront-style infantry combat
 */

import * as THREE from "three";
import { removeEntity, hasComponent } from "bitecs";
import {
  createGroundInput,
  groundMovementSystem,
  syncPlayerGroundInput,
  vehicleInteractionSystem,
  blasterSystem,
  commandPostSystem,
  groundAISystem,
  consumeGroundImpactEvents,
  spawnSoldier,
  spawnCommandPost,
  Transform,
  GroundInput,
  Health
} from "@xwingz/gameplay";
import {
  createPhysicsWorld,
  stepPhysics,
  createGroundPlane,
  type PhysicsWorld
} from "@xwingz/physics";
import type {
  ModeHandler,
  ModeContext,
  ModeTransitionData,
  GroundFromFlightData
} from "./types";
import { isGroundFromFlightTransition } from "./types";
import { disposeObject } from "../rendering/MeshManager";
import { ExplosionManager } from "../rendering/effects";

// ─────────────────────────────────────────────────────────────────────────────
// Ground Mode State
// ─────────────────────────────────────────────────────────────────────────────

export class GroundMode implements ModeHandler {
  // Physics
  private physicsWorld: PhysicsWorld | null = null;

  // Input
  private groundInput: ReturnType<typeof createGroundInput> | null = null;

  // Entity tracking
  private playerSoldierEid: number | null = null;
  private commandPostEids: number[] = [];
  private enemyEids: number[] = [];

  // Meshes
  private playerMesh: THREE.Object3D | null = null;
  private enemyMeshes = new Map<number, THREE.Object3D>();
  private commandPostMeshes: THREE.Object3D[] = [];
  private landedShipMesh: THREE.Object3D | null = null;

  // Effects
  private explosions: ExplosionManager | null = null;

  // Camera
  private camInit = false;
  private tmpCamOffset = new THREE.Vector3();

  // Transition state (for seamless space-ground)
  private transitionData: GroundFromFlightData | null = null;
  private canLaunch = false;
  private landedShipPosition = { x: 0, y: 0, z: 0 };
  private readonly LAUNCH_RADIUS = 8; // How close to ship to launch

  enter(ctx: ModeContext, data?: ModeTransitionData): void {
    ctx.controls.enabled = false;
    this.camInit = false;

    // Check for seamless transition from flight mode
    if (isGroundFromFlightTransition(data)) {
      this.transitionData = data;
      this.landedShipPosition = { ...data.landingPosition };
    } else {
      this.transitionData = null;
      this.landedShipPosition = { x: 0, y: 0, z: 0 };
    }

    // Initialize explosion manager
    this.explosions = new ExplosionManager(ctx.scene);

    // Setup scene
    ctx.scene.clear();
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(100, 200, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    ctx.scene.add(sun);

    // Ground plane (visual)
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x556644,
      roughness: 0.95
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ctx.scene.add(ground);

    // Create physics world
    this.physicsWorld = createPhysicsWorld({ x: 0, y: -9.81, z: 0 });
    createGroundPlane(this.physicsWorld, 0);

    // Create input handler
    this.groundInput = createGroundInput(window);

    // Spawn player soldier - use transition position if available
    const spawnX = this.transitionData?.landingPosition.x ?? 0;
    const spawnY = 1;
    const spawnZ = (this.transitionData?.landingPosition.z ?? 0) + 5; // Offset from ship
    this.playerSoldierEid = spawnSoldier(ctx.world, this.physicsWorld, spawnX, spawnY, spawnZ, 0, 0, false);
    this.playerMesh = this.buildSoldierMesh(0);
    this.playerMesh.position.set(spawnX, 0, spawnZ);
    ctx.scene.add(this.playerMesh);

    // If transitioned from flight, spawn landed ship mesh
    if (this.transitionData) {
      this.landedShipMesh = this.buildLandedShipMesh();
      this.landedShipMesh.position.set(
        this.landedShipPosition.x,
        this.landedShipPosition.y,
        this.landedShipPosition.z
      );
      ctx.scene.add(this.landedShipMesh);
    }

    // Spawn command posts
    const cpPositions = [
      { x: 0, z: -30, team: -1 },   // Neutral CP ahead
      { x: 30, z: 0, team: 0 },     // Friendly CP to right
      { x: -30, z: 0, team: 1 },    // Enemy CP to left
    ];
    for (const pos of cpPositions) {
      const cpEid = spawnCommandPost(ctx.world, pos.x, 0, pos.z, pos.team, 10, 0.15);
      this.commandPostEids.push(cpEid);
      const cpMesh = this.buildCommandPostMesh(pos.team);
      cpMesh.position.set(pos.x, 0, pos.z);
      cpMesh.userData.cpEid = cpEid;
      ctx.scene.add(cpMesh);
      this.commandPostMeshes.push(cpMesh);
    }

    // Spawn enemy soldiers
    const enemyPositions = [
      { x: -25, z: -10 },
      { x: -28, z: 5 },
      { x: -20, z: 0 },
    ];
    for (const pos of enemyPositions) {
      const enemyEid = spawnSoldier(ctx.world, this.physicsWorld, pos.x, 1, pos.z, 1, 0, true);
      this.enemyEids.push(enemyEid);
      const enemyMesh = this.buildSoldierMesh(1);
      enemyMesh.position.set(pos.x, 0, pos.z);
      ctx.scene.add(enemyMesh);
      this.enemyMeshes.set(enemyEid, enemyMesh);
    }

    // Position camera
    ctx.camera.position.set(0, 5, 10);
    ctx.camera.lookAt(0, 1, 0);

    // Setup pointer lock on click
    ctx.canvas.addEventListener("click", this.handleCanvasClick);
  }

  tick(ctx: ModeContext, dt: number): void {
    if (!this.physicsWorld || !this.groundInput || this.playerSoldierEid === null) {
      ctx.renderer.render(ctx.scene, ctx.camera);
      return;
    }

    // Update input
    this.groundInput.update();

    // Check for mode exit
    if (this.groundInput.state.toggleMap) {
      ctx.requestModeChange("map", { type: "map" });
      return;
    }

    // Launch detection (only if landed from flight with valid system)
    if (this.transitionData?.system && this.playerSoldierEid !== null && hasComponent(ctx.world, Transform, this.playerSoldierEid)) {
      const px = Transform.x[this.playerSoldierEid] ?? 0;
      const pz = Transform.z[this.playerSoldierEid] ?? 0;
      const dx = px - this.landedShipPosition.x;
      const dz = pz - this.landedShipPosition.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      this.canLaunch = dist < this.LAUNCH_RADIUS;

      // Handle launch
      if (this.groundInput.state.launch && this.canLaunch) {
        ctx.requestModeChange("flight", {
          type: "flight",
          system: this.transitionData.system,
          scenario: "yavin_defense"
        });
        return;
      }
    } else {
      this.canLaunch = false;
    }

    // Sync input to player entity
    syncPlayerGroundInput(ctx.world, this.playerSoldierEid, this.groundInput.state);

    // Run ground systems
    groundMovementSystem(ctx.world, this.physicsWorld, dt);
    vehicleInteractionSystem(ctx.world);
    blasterSystem(ctx.world, this.physicsWorld, dt);
    commandPostSystem(ctx.world, dt);
    groundAISystem(ctx.world, dt);

    // Step physics
    stepPhysics(this.physicsWorld, dt);

    // Handle ground impact events (for VFX)
    const groundImpacts = consumeGroundImpactEvents();
    for (const hit of groundImpacts) {
      this.explosions?.spawn(
        new THREE.Vector3(hit.x, hit.y, hit.z),
        hit.shooterTeam === 0 ? 0x77ff88 : 0xff6666,
        hit.killed ? 0.4 : 0.12,
        hit.killed ? 6 : 1.5
      );
    }

    // Sync player mesh
    if (this.playerMesh && hasComponent(ctx.world, Transform, this.playerSoldierEid)) {
      this.playerMesh.position.set(
        Transform.x[this.playerSoldierEid],
        Transform.y[this.playerSoldierEid],
        Transform.z[this.playerSoldierEid]
      );
      const yaw = GroundInput.aimYaw[this.playerSoldierEid] ?? 0;
      this.playerMesh.rotation.y = yaw;
    }

    // Sync enemy meshes
    for (const [eid, mesh] of this.enemyMeshes) {
      if (hasComponent(ctx.world, Transform, eid) && hasComponent(ctx.world, Health, eid)) {
        const hp = Health.hp[eid] ?? 0;
        if (hp <= 0) {
          ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.enemyMeshes.delete(eid);
          removeEntity(ctx.world, eid);
          this.enemyEids = this.enemyEids.filter((e) => e !== eid);
        } else {
          mesh.position.set(Transform.x[eid], Transform.y[eid], Transform.z[eid]);
          const enemyYaw = GroundInput.aimYaw[eid] ?? 0;
          mesh.rotation.y = enemyYaw;
        }
      }
    }

    // Third-person camera follow
    if (this.playerMesh) {
      const yaw = this.groundInput.state.aimYaw;
      const pitch = this.groundInput.state.aimPitch;
      const camDist = 8;
      const camHeight = 3;

      const offsetX = Math.sin(yaw) * camDist * Math.cos(pitch);
      const offsetZ = Math.cos(yaw) * camDist * Math.cos(pitch);
      const offsetY = camHeight - Math.sin(pitch) * camDist * 0.5;

      const targetPos = this.playerMesh.position;
      const desiredCamPos = this.tmpCamOffset.set(
        targetPos.x + offsetX,
        targetPos.y + offsetY,
        targetPos.z + offsetZ
      );

      const k = 1 - Math.exp(-dt * 12);
      if (!this.camInit) {
        ctx.camera.position.copy(desiredCamPos);
        this.camInit = true;
      } else {
        ctx.camera.position.lerp(desiredCamPos, k);
      }
      ctx.camera.lookAt(targetPos.x, targetPos.y + 1.2, targetPos.z);
    }

    // Update explosions
    this.explosions?.update(dt);

    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  exit(ctx: ModeContext): void {
    ctx.canvas.removeEventListener("click", this.handleCanvasClick);

    // Remove player
    if (this.playerSoldierEid !== null) {
      removeEntity(ctx.world, this.playerSoldierEid);
      this.playerSoldierEid = null;
    }
    if (this.playerMesh) {
      ctx.scene.remove(this.playerMesh);
      disposeObject(this.playerMesh);
      this.playerMesh = null;
    }

    // Remove enemies
    for (const eid of this.enemyEids) {
      removeEntity(ctx.world, eid);
    }
    this.enemyEids = [];
    for (const mesh of this.enemyMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.enemyMeshes.clear();

    // Remove command posts
    for (const cpEid of this.commandPostEids) {
      removeEntity(ctx.world, cpEid);
    }
    this.commandPostEids = [];
    for (const mesh of this.commandPostMeshes) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.commandPostMeshes = [];

    // Dispose input
    if (this.groundInput) {
      this.groundInput.dispose();
      this.groundInput = null;
    }

    // Remove landed ship mesh
    if (this.landedShipMesh) {
      ctx.scene.remove(this.landedShipMesh);
      disposeObject(this.landedShipMesh);
      this.landedShipMesh = null;
    }

    // Dispose physics
    this.physicsWorld = null;

    // Dispose explosions
    this.explosions?.dispose();
    this.explosions = null;

    // Reset transition state
    this.transitionData = null;
    this.canLaunch = false;
  }

  private handleCanvasClick = (): void => {
    if (this.groundInput && !this.groundInput.isLocked()) {
      this.groundInput.requestPointerLock();
    }
  };

  private buildSoldierMesh(teamId: number): THREE.Object3D {
    const group = new THREE.Group();

    const bodyGeo = new THREE.CapsuleGeometry(0.35, 1.1, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: teamId === 0 ? 0x44aa44 : 0xaa4444,
      roughness: 0.7
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.2, 12, 8);
    const headMat = new THREE.MeshStandardMaterial({
      color: teamId === 0 ? 0x88cc88 : 0xcc8888,
      roughness: 0.6
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.65;
    head.castShadow = true;
    group.add(head);

    return group;
  }

  private buildLandedShipMesh(): THREE.Object3D {
    // Simple X-Wing representation when landed
    const group = new THREE.Group();

    // Fuselage
    const fuselageGeo = new THREE.BoxGeometry(2, 1.5, 8);
    const fuselageMat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, metalness: 0.3, roughness: 0.5 });
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    fuselage.position.y = 1.5;
    fuselage.castShadow = true;
    group.add(fuselage);

    // Wings (closed position when landed)
    const wingGeo = new THREE.BoxGeometry(10, 0.15, 2.5);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.2, roughness: 0.7 });
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.y = 1.5;
    wing.castShadow = true;
    group.add(wing);

    // Landing gear (simple cylinders)
    const gearGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8);
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
    const frontGear = new THREE.Mesh(gearGeo, gearMat);
    frontGear.position.set(0, 0.6, -2.5);
    group.add(frontGear);
    const leftGear = new THREE.Mesh(gearGeo, gearMat);
    leftGear.position.set(-2, 0.6, 2);
    group.add(leftGear);
    const rightGear = new THREE.Mesh(gearGeo, gearMat);
    rightGear.position.set(2, 0.6, 2);
    group.add(rightGear);

    // Cockpit
    const cockpitGeo = new THREE.SphereGeometry(0.8, 12, 12);
    const cockpitMat = new THREE.MeshStandardMaterial({
      color: 0x0c0f18,
      roughness: 0.1,
      transparent: true,
      opacity: 0.6
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 2.0, -1.5);
    cockpit.scale.set(1.2, 0.8, 1.5);
    group.add(cockpit);

    return group;
  }

  private buildCommandPostMesh(ownerTeam: number): THREE.Object3D {
    const group = new THREE.Group();

    const baseGeo = new THREE.CylinderGeometry(3, 3.5, 0.4, 12);
    const baseMat = new THREE.MeshStandardMaterial({
      color: ownerTeam === -1 ? 0x666666 : ownerTeam === 0 ? 0x225522 : 0x552222,
      roughness: 0.8
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.2;
    base.receiveShadow = true;
    group.add(base);

    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 2.4;
    pole.castShadow = true;
    group.add(pole);

    const flagGeo = new THREE.PlaneGeometry(1.5, 1);
    const flagMat = new THREE.MeshStandardMaterial({
      color: ownerTeam === -1 ? 0xaaaaaa : ownerTeam === 0 ? 0x44ff44 : 0xff4444,
      side: THREE.DoubleSide,
      roughness: 0.9
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.8, 3.9, 0);
    flag.castShadow = true;
    group.add(flag);

    return group;
  }
}
