/**
 * SceneBuilder - Manages scene construction for flight mode
 * Handles starfield, Yavin terrain, trees, and Great Temple
 */

import * as THREE from "three";
import { createRng, deriveSeed } from "@xwingz/procgen";
import { buildStarfield } from "../../rendering/effects";
import { disposeObject } from "../../rendering/MeshManager";
import type { ModeContext } from "../types";
import type { TerrainParams } from "./types";

export class SceneBuilder {
  private starfield: THREE.Points | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private treeTrunks: THREE.InstancedMesh | null = null;
  private treeCanopies: THREE.InstancedMesh | null = null;
  private terrainParams: TerrainParams | null = null;
  private baseMesh: THREE.Object3D | null = null;

  // Temp matrix for tree placement
  private tmpMat = new THREE.Matrix4();

  /**
   * Build a local starfield for space combat
   */
  buildLocalStarfield(ctx: ModeContext, seed: bigint): void {
    this.clearStarfield(ctx);
    this.starfield = buildStarfield(seed);
    ctx.scene.add(this.starfield);
  }

  /**
   * Build Yavin 4 planet surface with terrain, trees, and Great Temple
   */
  buildYavinPlanet(ctx: ModeContext, seed: bigint): void {
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

    ctx.scene.fog = new THREE.Fog(0x05060b, 220, 5200);

    // Build terrain mesh
    this.buildTerrainMesh(ctx);

    // Build trees
    this.buildTrees(ctx, rng);

    // Build Great Temple
    this.baseMesh = this.buildGreatTemple();
    this.baseMesh.position.y = this.yavinTerrainHeight(0, 0);
    this.baseMesh.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    ctx.scene.add(this.baseMesh);
  }

  /**
   * Get the Great Temple mesh (for entity positioning)
   */
  getBaseMesh(): THREE.Object3D | null {
    return this.baseMesh;
  }

  /**
   * Calculate terrain height at given XZ coordinates
   */
  yavinTerrainHeight(x: number, z: number): number {
    const p = this.terrainParams;
    if (!p) return 0;
    const h1 = Math.sin(x * p.f1 + p.p1) * Math.cos(z * p.f1 + p.p1) * p.a1;
    const h2 = Math.sin(x * p.f2 + p.p2) * Math.sin(z * p.f2 + p.p2) * p.a2;
    return h1 + h2 + p.yOffset;
  }

  /**
   * Get terrain parameters (for entity clamping)
   */
  getTerrainParams(): TerrainParams | null {
    return this.terrainParams;
  }

  /**
   * Clear all planetary scene objects
   */
  clearPlanetaryScene(ctx: ModeContext): void {
    if (this.groundMesh) {
      ctx.scene.remove(this.groundMesh);
      disposeObject(this.groundMesh);
      this.groundMesh = null;
    }
    if (this.treeTrunks) {
      ctx.scene.remove(this.treeTrunks);
      disposeObject(this.treeTrunks);
      this.treeTrunks = null;
    }
    if (this.treeCanopies) {
      ctx.scene.remove(this.treeCanopies);
      disposeObject(this.treeCanopies);
      this.treeCanopies = null;
    }
    if (this.baseMesh) {
      ctx.scene.remove(this.baseMesh);
      disposeObject(this.baseMesh);
      this.baseMesh = null;
    }
    this.terrainParams = null;
    ctx.scene.fog = null;
  }

  /**
   * Clear starfield
   */
  clearStarfield(ctx: ModeContext): void {
    if (this.starfield) {
      ctx.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
      this.starfield = null;
    }
  }

  /**
   * Build terrain mesh using heightmap
   */
  private buildTerrainMesh(ctx: ModeContext): void {
    const size = 9000;
    const seg = 140;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      pos.setZ(i, this.yavinTerrainHeight(x, z) - (this.terrainParams?.yOffset ?? 0));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 1.0 });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = this.terrainParams?.yOffset ?? 0;
    this.groundMesh.receiveShadow = true;
    ctx.scene.add(this.groundMesh);
  }

  /**
   * Build instanced tree meshes
   */
  private buildTrees(ctx: ModeContext, rng: ReturnType<typeof createRng>): void {
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

      // Avoid placing trees on Great Temple landing pad
      if (Math.abs(x) < 260 && z > -200 && z < 520) {
        x += rng.range(260, 520) * Math.sign(x || 1);
        z += rng.range(120, 260);
      }

      const y = this.yavinTerrainHeight(x, z);
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
    ctx.scene.add(this.treeTrunks);
    ctx.scene.add(this.treeCanopies);
  }

  /**
   * Build the Great Temple structure
   */
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
}
