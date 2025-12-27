/**
 * YavinTerrainBuilder - Procedural terrain generation for Yavin 4
 *
 * Handles:
 * - Jungle terrain mesh with height variation
 * - Tree placement (trunks and canopies)
 * - Great Temple construction
 * - Fog and atmosphere setup
 */

import * as THREE from "three";
import { createRng, deriveSeed } from "@xwingz/procgen";
import type { TerrainParams } from "../FlightScenarioTypes";

export interface YavinTerrainResult {
  groundMesh: THREE.Mesh;
  treeTrunks: THREE.InstancedMesh;
  treeCanopies: THREE.InstancedMesh;
  baseMesh: THREE.Group;
  terrainParams: TerrainParams;
}

/**
 * Build the Yavin 4 planetary terrain
 */
export function buildYavinTerrain(
  scene: THREE.Scene,
  seed: bigint
): YavinTerrainResult {
  const rng = createRng(deriveSeed(seed, "yavin_terrain"));

  const terrainParams: TerrainParams = {
    a1: 34,
    f1: 0.0012 + rng.range(0, 0.0006),
    p1: rng.range(0, Math.PI * 2),
    a2: 18,
    f2: 0.0021 + rng.range(0, 0.001),
    p2: rng.range(0, Math.PI * 2),
    yOffset: -12
  };

  // Daytime jungle atmosphere - hazy green-blue sky
  scene.fog = new THREE.Fog(0x8aac9e, 400, 6000);
  scene.background = new THREE.Color(0xa8c4b8);

  // Ground mesh
  const groundMesh = buildGroundMesh(terrainParams);
  scene.add(groundMesh);

  // Trees
  const { treeTrunks, treeCanopies } = buildTrees(rng, terrainParams);
  scene.add(treeTrunks);
  scene.add(treeCanopies);

  // Great Temple
  const baseMesh = buildGreatTemple();
  baseMesh.position.y = getTerrainHeight(0, 0, terrainParams);
  baseMesh.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  scene.add(baseMesh);

  return {
    groundMesh,
    treeTrunks,
    treeCanopies,
    baseMesh,
    terrainParams
  };
}

/**
 * Build the ground mesh with height variation
 */
function buildGroundMesh(params: TerrainParams): THREE.Mesh {
  const size = 9000;
  const seg = 140;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i);
    pos.setZ(i, getTerrainHeight(x, z, params) - params.yOffset);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 1.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = params.yOffset;
  mesh.receiveShadow = true;

  return mesh;
}

/**
 * Build instanced tree meshes (trunks and canopies)
 */
function buildTrees(
  rng: ReturnType<typeof createRng>,
  params: TerrainParams
): { treeTrunks: THREE.InstancedMesh; treeCanopies: THREE.InstancedMesh } {
  const treeCount = 260;
  const tmpMat = new THREE.Matrix4();

  // Trunks
  const trunkGeo = new THREE.CylinderGeometry(0.9, 1.3, 14, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1.0 });
  const treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  treeTrunks.castShadow = true;
  treeTrunks.receiveShadow = true;

  // Canopies
  const canopyGeo = new THREE.ConeGeometry(6.5, 18, 8);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1b5a34, roughness: 1.0 });
  const treeCanopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  treeCanopies.castShadow = true;
  treeCanopies.receiveShadow = true;

  for (let i = 0; i < treeCount; i++) {
    let x = rng.range(-1800, 1800);
    let z = rng.range(-1800, 1800);

    // Avoid temple area
    if (Math.abs(x) < 260 && z > -200 && z < 520) {
      x += rng.range(260, 520) * Math.sign(x || 1);
      z += rng.range(120, 260);
    }

    const y = getTerrainHeight(x, z, params);
    const trunkY = y + 7;
    const canopyY = y + 20;
    const s = rng.range(0.85, 1.35);
    const rot = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, rng.range(0, Math.PI * 2), 0)
    );

    tmpMat.compose(
      new THREE.Vector3(x, trunkY, z),
      rot,
      new THREE.Vector3(s, s * rng.range(0.9, 1.25), s)
    );
    treeTrunks.setMatrixAt(i, tmpMat);

    tmpMat.compose(
      new THREE.Vector3(x, canopyY, z),
      rot,
      new THREE.Vector3(s, s, s)
    );
    treeCanopies.setMatrixAt(i, tmpMat);
  }

  treeTrunks.instanceMatrix.needsUpdate = true;
  treeCanopies.instanceMatrix.needsUpdate = true;

  return { treeTrunks, treeCanopies };
}

/**
 * Build the Great Temple of Yavin 4
 */
function buildGreatTemple(): THREE.Group {
  const group = new THREE.Group();

  const stone = new THREE.MeshStandardMaterial({
    color: 0x5f646e,
    metalness: 0.0,
    roughness: 0.9
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0f1015, roughness: 1.0 });

  // Stepped pyramid base
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(320, 34, 260), stone);
  step1.position.y = 17;

  const step2 = new THREE.Mesh(new THREE.BoxGeometry(260, 30, 210), stone);
  step2.position.y = 34 + 15;

  const step3 = new THREE.Mesh(new THREE.BoxGeometry(200, 28, 160), stone);
  step3.position.y = 34 + 30 + 14;

  const top = new THREE.Mesh(new THREE.BoxGeometry(150, 24, 110), stone);
  top.position.y = 34 + 30 + 28 + 12;

  // Hangar opening
  const hangar = new THREE.Mesh(new THREE.BoxGeometry(140, 50, 26), dark);
  hangar.position.set(0, 22, 130);

  // Landing pad
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(160, 3, 220),
    new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.8 })
  );
  pad.position.set(0, 1.5, 250);

  group.add(step1, step2, step3, top, hangar, pad);
  return group;
}

/**
 * Calculate terrain height at a given x,z position
 */
export function getTerrainHeight(x: number, z: number, params: TerrainParams | null): number {
  if (!params) return 0;
  const h1 = Math.sin(x * params.f1 + params.p1) * Math.cos(z * params.f1 + params.p1) * params.a1;
  const h2 = Math.sin(x * params.f2 + params.p2) * Math.sin(z * params.f2 + params.p2) * params.a2;
  return h1 + h2 + params.yOffset;
}

/**
 * Clear the fog and background from the scene
 */
export function clearYavinAtmosphere(scene: THREE.Scene): void {
  scene.fog = null;
  scene.background = null;
}
