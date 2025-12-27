/**
 * CapitalShipController - Manages capital ship entities and rendering
 * Handles Star Destroyer spawning, turrets, subsystems, and mesh syncing
 */

import * as THREE from "three";
import { hasComponent } from "bitecs";
import {
  Transform,
  CapitalShipV2,
  Turret,
  Subsystem,
  spawnCapitalShipV2,
  removeCapitalShipV2,
  consumeTurretFireEvents,
  consumeSubsystemDestroyedEvents
} from "@xwingz/gameplay";
import { AssetLoader, KENNEY_ASSETS, createProceduralShip } from "@xwingz/render";
import { createLogger } from "@xwingz/core";
import { disposeObject } from "../../rendering/MeshManager";
import type { ModeContext } from "../types";
import type { ExplosionManager } from "../../rendering/effects";

const log = createLogger("CapitalShipController");

// Local copies of const enums
const SubsystemType = {
  Bridge: 0,
  ShieldGen: 1,
  Engines: 2,
  Targeting: 3,
  Power: 4,
  Hangar: 5
} as const;

const TurretType = {
  PointDefense: 0,
  Medium: 1,
  Heavy: 2,
  Ion: 3
} as const;

export class CapitalShipController {
  private capitalShipEids: number[] = [];
  private capitalShipMeshes = new Map<number, THREE.Object3D>();
  private turretMeshes = new Map<number, THREE.Object3D>();
  private subsystemMeshes = new Map<number, THREE.Object3D>();
  private turretProjectileMeshes = new Map<number, THREE.Mesh>();

  // Asset loading
  private assetLoader = new AssetLoader({ basePath: '/assets/models/' });
  private assetsReady = false;

  // Temp vectors
  private tmpExplosionPos = new THREE.Vector3();

  /**
   * Preload turret assets
   */
  async preloadAssets(): Promise<void> {
    try {
      await this.assetLoader.preload([
        KENNEY_ASSETS.TURRET_SINGLE,
        KENNEY_ASSETS.TURRET_DOUBLE,
      ]);
      this.assetsReady = true;
      log.info("Turret assets loaded");
    } catch (err) {
      log.warn("Failed to load turret assets, using procedural:", err);
    }
  }

  /**
   * Spawn a Star Destroyer at the given position
   */
  spawnStarDestroyer(
    ctx: ModeContext,
    x: number,
    y: number,
    z: number,
    team: number
  ): { shipEid: number; turretEids: number[]; subsystemEids: number[] } {
    const result = spawnCapitalShipV2(ctx.world, {
      shipClass: 3, // ShipClass.Destroyer
      team,
      x,
      y,
      z
    });

    // Create mesh using centralized ship model system
    const mesh = createProceduralShip({ type: "star_destroyer", scale: 5.0, enableShadows: true });
    mesh.position.set(x, y, z);
    // FIX: Disable frustum culling for capital ships (they're so large they get incorrectly culled)
    mesh.frustumCulled = false;
    mesh.traverse((child) => {
      child.frustumCulled = false;
    });
    ctx.scene.add(mesh);
    this.capitalShipMeshes.set(result.shipEid, mesh);
    this.capitalShipEids.push(result.shipEid);

    // Create turret meshes
    for (const tid of result.turretEids) {
      const turretType = Turret.turretType[tid] ?? 0;
      const turretMesh = this.buildTurretMesh(turretType);
      turretMesh.position.set(
        Transform.x[tid] ?? 0,
        Transform.y[tid] ?? 0,
        Transform.z[tid] ?? 0
      );
      ctx.scene.add(turretMesh);
      this.turretMeshes.set(tid, turretMesh);
    }

    // Create subsystem indicator meshes
    for (const sid of result.subsystemEids) {
      const type = Subsystem.subsystemType[sid] ?? 0;
      const subMesh = this.buildSubsystemMesh(type);
      subMesh.position.set(
        Transform.x[sid] ?? 0,
        Transform.y[sid] ?? 0,
        Transform.z[sid] ?? 0
      );
      ctx.scene.add(subMesh);
      this.subsystemMeshes.set(sid, subMesh);
    }

    return result;
  }

  /**
   * Sync capital ship, turret, and subsystem mesh positions
   */
  sync(ctx: ModeContext, explosions: ExplosionManager | null): void {
    // Sync capital ship hulls
    for (let i = this.capitalShipEids.length - 1; i >= 0; i--) {
      const eid = this.capitalShipEids[i]!;

      // Check if destroyed
      if (!hasComponent(ctx.world, CapitalShipV2, eid)) {
        const mesh = this.capitalShipMeshes.get(eid);
        if (mesh) {
          // Big explosion for capital ship destruction
          explosions?.spawn(
            this.tmpExplosionPos.copy(mesh.position),
            0xff8844,
            2.0,
            30
          );
          ctx.scene.remove(mesh);
          disposeObject(mesh);
          this.capitalShipMeshes.delete(eid);
        }
        this.capitalShipEids.splice(i, 1);
        continue;
      }

      const mesh = this.capitalShipMeshes.get(eid);
      if (mesh) {
        mesh.position.set(
          Transform.x[eid] ?? 0,
          Transform.y[eid] ?? 0,
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

    // Sync turrets
    for (const [tid, mesh] of this.turretMeshes) {
      if (!hasComponent(ctx.world, Turret, tid)) {
        ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.turretMeshes.delete(tid);
        continue;
      }

      mesh.position.set(
        Transform.x[tid] ?? 0,
        Transform.y[tid] ?? 0,
        Transform.z[tid] ?? 0
      );
      // Turret rotation (combine parent rotation with local yaw/pitch)
      const yaw = Turret.yaw[tid] ?? 0;
      const pitch = Turret.pitch[tid] ?? 0;
      mesh.rotation.set(pitch, yaw, 0, "YXZ");
    }

    // Sync subsystems
    for (const [sid, mesh] of this.subsystemMeshes) {
      if (!hasComponent(ctx.world, Subsystem, sid)) {
        ctx.scene.remove(mesh);
        disposeObject(mesh);
        this.subsystemMeshes.delete(sid);
        continue;
      }

      mesh.position.set(
        Transform.x[sid] ?? 0,
        Transform.y[sid] ?? 0,
        Transform.z[sid] ?? 0
      );

      // Rotate the indicator ring
      const ring = mesh.children[1];
      if (ring) {
        ring.rotation.z += 0.02;
      }

      // Hide disabled subsystems
      const disabled = Subsystem.disabled[sid] === 1;
      mesh.visible = !disabled;
    }
  }

  /**
   * Sync turret projectile meshes and consume fire/destruction events
   */
  syncTurretProjectiles(explosions: ExplosionManager | null): void {
    // Consume fire events and spawn projectile meshes
    const fireEvents = consumeTurretFireEvents();
    for (const evt of fireEvents) {
      // Muzzle flash effect
      explosions?.spawn(
        this.tmpExplosionPos.set(evt.x, evt.y, evt.z),
        evt.team === 0 ? 0xff6666 : 0x44ff44,
        0.08,
        1.5
      );
    }

    // Consume subsystem destroyed events
    const destroyedEvents = consumeSubsystemDestroyedEvents();
    for (const evt of destroyedEvents) {
      explosions?.spawn(
        this.tmpExplosionPos.set(evt.x, evt.y, evt.z),
        0xff8844,
        0.6,
        8
      );
    }
  }

  /**
   * Clear all capital ship meshes
   */
  clear(ctx: ModeContext): void {
    for (const eid of this.capitalShipEids) {
      removeCapitalShipV2(ctx.world, eid);
    }
    this.capitalShipEids = [];

    for (const mesh of this.capitalShipMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.capitalShipMeshes.clear();

    for (const mesh of this.turretMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretMeshes.clear();

    for (const mesh of this.subsystemMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.subsystemMeshes.clear();

    for (const mesh of this.turretProjectileMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.turretProjectileMeshes.clear();
  }

  /**
   * Get capital ship entity IDs (for HUD)
   */
  getCapitalShipEids(): number[] {
    return this.capitalShipEids;
  }

  /**
   * Get subsystem meshes (for HUD)
   */
  getSubsystemMeshes(): Map<number, THREE.Object3D> {
    return this.subsystemMeshes;
  }

  /**
   * Build a turret mesh (GLB or procedural fallback)
   */
  private buildTurretMesh(turretType: number): THREE.Group {
    // Scale based on turret type
    const scale = turretType === TurretType.Heavy ? 1.5 :
                  turretType === TurretType.Medium ? 1.0 : 0.6;

    // Use double turret for Medium/Heavy, single for PointDefense/Light
    const useDoubleTurret = turretType === TurretType.Medium || turretType === TurretType.Heavy;
    const assetKey = useDoubleTurret ? KENNEY_ASSETS.TURRET_DOUBLE : KENNEY_ASSETS.TURRET_SINGLE;

    // Try to use loaded GLB model
    if (this.assetsReady && this.assetLoader.isCached(assetKey)) {
      const model = this.assetLoader.clone(assetKey);
      model.scale.setScalar(scale * 2.5);
      model.rotation.x = -Math.PI / 2;
      return model;
    }

    // Fallback to procedural geometry
    return this.buildProceduralTurretMesh(turretType, scale);
  }

  /**
   * Procedural turret mesh (fallback when GLB not loaded)
   */
  private buildProceduralTurretMesh(turretType: number, scale: number): THREE.Group {
    const group = new THREE.Group();

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4a4f5c,
      metalness: 0.4,
      roughness: 0.6
    });
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x2a2d36,
      metalness: 0.5,
      roughness: 0.5
    });

    // Turret base
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5 * scale, 2 * scale, 1 * scale, 8),
      baseMat
    );
    base.castShadow = true;
    group.add(base);

    // Barrel(s)
    const barrelGeo = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 4 * scale, 6);
    const barrelCount = turretType === TurretType.PointDefense ? 2 :
                        turretType === TurretType.Medium ? 2 : 1;

    for (let i = 0; i < barrelCount; i++) {
      const barrel = new THREE.Mesh(barrelGeo, barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set((i - (barrelCount - 1) / 2) * 0.8 * scale, 0.5 * scale, -2 * scale);
      barrel.castShadow = true;
      group.add(barrel);
    }

    return group;
  }

  /**
   * Build subsystem indicator mesh (glowing target point)
   */
  private buildSubsystemMesh(type: number): THREE.Group {
    const group = new THREE.Group();

    const colors: Record<number, number> = {
      [SubsystemType.Bridge]: 0xff3344,
      [SubsystemType.ShieldGen]: 0x44aaff,
      [SubsystemType.Engines]: 0xff8833,
      [SubsystemType.Targeting]: 0xffff44,
      [SubsystemType.Power]: 0x44ff44,
      [SubsystemType.Hangar]: 0xaa44ff
    };

    const color = colors[type] ?? 0xffffff;

    // Glowing indicator sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.7
      })
    );
    group.add(sphere);

    // Rotating ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.5, 0.15, 8, 16),
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8
      })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    return group;
  }
}
