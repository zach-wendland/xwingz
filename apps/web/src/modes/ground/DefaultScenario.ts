/**
 * DefaultScenario - Standard ground combat (Battlefront-style command post capture)
 *
 * This extracts the scenario-specific logic from GroundMode.ts,
 * leaving GroundMode as a thin orchestrator.
 */

import * as THREE from "three";
import { removeEntity, hasComponent } from "bitecs";
import {
  spawnSoldier,
  spawnCommandPost,
  spawnSpeederBike,
  spawnATST,
  Transform,
  Health
} from "@xwingz/gameplay";
import { createGroundPlane } from "@xwingz/physics";
import type {
  GroundContext,
  GroundHudElements,
  GroundScenarioHandler
} from "./GroundScenarioTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Default Scenario Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class DefaultScenario implements GroundScenarioHandler {
  // Mission state
  private missionMessage = "CAPTURE COMMAND POSTS";

  enter(gctx: GroundContext): void {
    // Create physics ground plane
    createGroundPlane(gctx.physicsWorld, 0);

    // Build visual ground mesh
    this.buildDefaultTerrain(gctx);

    // Spawn player at origin
    this.spawnPlayer(gctx, 0, 1, 0);

    // Spawn command posts
    this.spawnCommandPosts(gctx);

    // Spawn enemies
    this.spawnEnemies(gctx);

    // Spawn vehicles
    this.spawnVehicles(gctx);
  }

  tick(gctx: GroundContext, _dt: number): boolean {
    // Sync enemy meshes (remove dead)
    this.syncEnemyMeshes(gctx);

    // Sync vehicle meshes (remove destroyed)
    this.syncVehicleMeshes(gctx);

    // Check victory/defeat (all command posts captured, etc.)
    // For default scenario, no automatic end - player can stay indefinitely

    return false; // Don't exit ground mode
  }

  updateHud(_gctx: GroundContext, els: GroundHudElements): void {
    els.mission.textContent = this.missionMessage;
  }

  getMissionMessage(): string {
    return this.missionMessage;
  }

  getMissionNumber(): number {
    return 0; // Default scenario has no mission number
  }

  canTransition(): "speeder" | "launch" | null {
    // Default scenario always allows launch (if near ship)
    return "launch";
  }

  exit(gctx: GroundContext): void {
    // Clean up ground mesh
    if (gctx.groundMesh) {
      gctx.ctx.scene.remove(gctx.groundMesh);
      gctx.groundMesh.geometry.dispose();
      if (gctx.groundMesh.material instanceof THREE.Material) {
        gctx.groundMesh.material.dispose();
      }
      gctx.groundMesh = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain Building
  // ─────────────────────────────────────────────────────────────────────────────

  private buildDefaultTerrain(gctx: GroundContext): void {
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x556644,
      roughness: 0.95
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    gctx.ctx.scene.add(ground);
    gctx.groundMesh = ground;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Entity Spawning
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnPlayer(gctx: GroundContext, x: number, y: number, z: number): void {
    gctx.playerEid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, x, y, z, 0, 0, false);
  }

  private spawnCommandPosts(gctx: GroundContext): void {
    const cpPositions = [
      { x: 0, z: -30, team: -1 },   // Neutral CP ahead
      { x: 30, z: 0, team: 0 },     // Friendly CP to right
      { x: -30, z: 0, team: 1 },    // Enemy CP to left
    ];

    for (const pos of cpPositions) {
      const cpEid = spawnCommandPost(gctx.ctx.world, pos.x, 0, pos.z, pos.team, 10, 0.15);
      gctx.commandPostEids.push(cpEid);
    }
  }

  private spawnEnemies(gctx: GroundContext): void {
    const enemyPositions = [
      { x: -25, z: -10 },
      { x: -28, z: 5 },
      { x: -20, z: 0 },
    ];

    for (const pos of enemyPositions) {
      const enemyEid = spawnSoldier(gctx.ctx.world, gctx.physicsWorld, pos.x, 1, pos.z, 1, 0, true);
      gctx.enemyEids.push(enemyEid);
    }
  }

  private spawnVehicles(gctx: GroundContext): void {
    // Speeder bike (friendly) near player
    const speederEid = spawnSpeederBike(gctx.ctx.world, 10, 0.5, 5, 0);
    gctx.vehicleEids.push(speederEid);

    // AT-ST (enemy) in the distance
    const atstEid = spawnATST(gctx.ctx.world, -40, 3, -20, 1);
    gctx.vehicleEids.push(atstEid);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Entity Syncing
  // ─────────────────────────────────────────────────────────────────────────────

  private syncEnemyMeshes(gctx: GroundContext): void {
    for (let i = gctx.enemyEids.length - 1; i >= 0; i--) {
      const eid = gctx.enemyEids[i]!;
      if (
        !hasComponent(gctx.ctx.world, Transform, eid) ||
        !hasComponent(gctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        // Enemy is dead - remove from tracking
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
      }
    }
  }

  private syncVehicleMeshes(gctx: GroundContext): void {
    for (let i = gctx.vehicleEids.length - 1; i >= 0; i--) {
      const eid = gctx.vehicleEids[i]!;
      if (
        !hasComponent(gctx.ctx.world, Transform, eid) ||
        !hasComponent(gctx.ctx.world, Health, eid) ||
        (Health.hp[eid] ?? 0) <= 0
      ) {
        // Vehicle destroyed
        const mesh = gctx.vehicleMeshes.get(eid);
        if (mesh) {
          gctx.explosions?.spawn(
            new THREE.Vector3(mesh.position.x, mesh.position.y + 2, mesh.position.z),
            0xff8844,
            0.6,
            8
          );
          gctx.ctx.scene.remove(mesh);
          gctx.vehicleMeshes.delete(eid);
        }
        removeEntity(gctx.ctx.world, eid);
        gctx.vehicleEids.splice(i, 1);
      }
    }
  }
}
