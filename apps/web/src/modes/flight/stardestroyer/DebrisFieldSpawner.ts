/**
 * DebrisFieldSpawner - Debris field generation for Star Destroyer mission
 *
 * Handles:
 * - Backdrop asteroids (behind Star Destroyer)
 * - Flanking debris (defines combat arena)
 * - Close debris (near destroyer)
 * - Procedural fallback asteroids
 */

import * as THREE from "three";
import { createRng, deriveSeed } from "@xwingz/procgen";
import { AssetLoader, KENNEY_ASSETS } from "@xwingz/render";
import { disposeObject } from "../../../rendering/MeshManager";

/**
 * Spawn the debris field around the Star Destroyer
 */
export async function spawnDebrisField(
  scene: THREE.Scene,
  assetLoader: AssetLoader,
  seed: bigint
): Promise<THREE.Object3D[]> {
  const rng = createRng(deriveSeed(seed, "sd_debris"));
  const debris: THREE.Object3D[] = [];

  // Preload Kenney debris assets
  const debrisAssets = [
    KENNEY_ASSETS.METEOR_DETAILED,
    KENNEY_ASSETS.METEOR,
    KENNEY_ASSETS.METEOR_HALF,
    KENNEY_ASSETS.ROCK_LARGE_A,
    KENNEY_ASSETS.ROCK_LARGE_B,
    KENNEY_ASSETS.ROCK
  ];

  try {
    await assetLoader.preload(debrisAssets);
  } catch {
    // Assets not available, use procedural fallbacks
    return spawnProceduralDebris(scene, rng);
  }

  // DISTANT BACKDROP (z = -2000 to -4000, behind the Star Destroyer)
  // Silhouettes the destroyer, establishes scale
  const backdropDebris = [
    { asset: KENNEY_ASSETS.METEOR_DETAILED, x: -1800, y: 400, z: -2800, scale: 12 },
    { asset: KENNEY_ASSETS.METEOR_DETAILED, x: 2200, y: -300, z: -3200, scale: 10 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 800, y: 600, z: -2500, scale: 14 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -1200, y: -500, z: -3500, scale: 11 },
    { asset: KENNEY_ASSETS.METEOR_DETAILED, x: 0, y: 800, z: -4000, scale: 15 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: -2500, y: 200, z: -3000, scale: 13 },
    { asset: KENNEY_ASSETS.METEOR_DETAILED, x: 1500, y: -600, z: -2600, scale: 9 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -800, y: 700, z: -3800, scale: 12 }
  ];

  // FLANKING DEBRIS (combat periphery on either side)
  // Defines combat arena boundaries
  const leftFlankDebris = [
    { asset: KENNEY_ASSETS.METEOR, x: -2000, y: 100, z: 1500, scale: 5 },
    { asset: KENNEY_ASSETS.METEOR_HALF, x: -1800, y: -200, z: 800, scale: 4 },
    { asset: KENNEY_ASSETS.ROCK, x: -2200, y: 300, z: 2200, scale: 3.5 },
    { asset: KENNEY_ASSETS.METEOR, x: -1600, y: -100, z: -500, scale: 4.5 },
    { asset: KENNEY_ASSETS.ROCK, x: -2400, y: 200, z: 500, scale: 3 }
  ];

  const rightFlankDebris = [
    { asset: KENNEY_ASSETS.METEOR, x: 1900, y: -150, z: 1200, scale: 5 },
    { asset: KENNEY_ASSETS.METEOR_HALF, x: 2100, y: 250, z: 2500, scale: 4 },
    { asset: KENNEY_ASSETS.ROCK, x: 1700, y: 0, z: 600, scale: 3.5 },
    { asset: KENNEY_ASSETS.METEOR, x: 2300, y: -50, z: -200, scale: 4 },
    { asset: KENNEY_ASSETS.ROCK, x: 1500, y: 350, z: 3000, scale: 3 }
  ];

  // CLOSE DEBRIS (near Star Destroyer - recent battle damage)
  const closeDebris = [
    { asset: KENNEY_ASSETS.METEOR_HALF, x: 300, y: 80, z: -400, scale: 2 },
    { asset: KENNEY_ASSETS.METEOR_HALF, x: -250, y: -60, z: -200, scale: 1.5 },
    { asset: KENNEY_ASSETS.ROCK, x: 150, y: 120, z: -600, scale: 1.8 },
    { asset: KENNEY_ASSETS.METEOR_HALF, x: -400, y: 40, z: -100, scale: 1.2 }
  ];

  const allDebris = [...backdropDebris, ...leftFlankDebris, ...rightFlankDebris, ...closeDebris];

  // Spawn all debris
  for (const d of allDebris) {
    try {
      const mesh = assetLoader.clone(d.asset);
      mesh.position.set(d.x, d.y, d.z);
      mesh.scale.setScalar(d.scale);
      // Random rotation for variety
      mesh.rotation.set(
        rng.range(0, Math.PI * 2),
        rng.range(0, Math.PI * 2),
        rng.range(0, Math.PI * 2)
      );
      // Darken to match cold space aesthetic
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.color) mat.color.setHex(0x3a3a3a);
          mat.roughness = 0.95;
        }
      });
      scene.add(mesh);
      debris.push(mesh);
    } catch {
      // Individual asset failed, continue
    }
  }

  return debris;
}

/**
 * Fallback procedural debris when Kenney assets aren't available
 */
function spawnProceduralDebris(
  scene: THREE.Scene,
  rng: ReturnType<typeof createRng>
): THREE.Object3D[] {
  const debris: THREE.Object3D[] = [];
  const asteroidGeo = new THREE.DodecahedronGeometry(1, 1);
  const asteroidMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 });

  const debrisPositions = [
    // Backdrop
    { x: -1800, y: 400, z: -2800, scale: 80 },
    { x: 2200, y: -300, z: -3200, scale: 70 },
    { x: 800, y: 600, z: -2500, scale: 90 },
    { x: 0, y: 800, z: -4000, scale: 100 },
    // Flanks
    { x: -2000, y: 100, z: 1500, scale: 35 },
    { x: 1900, y: -150, z: 1200, scale: 35 },
    { x: -1800, y: -200, z: 800, scale: 28 },
    { x: 2100, y: 250, z: 2500, scale: 28 }
  ];

  for (const pos of debrisPositions) {
    const asteroid = new THREE.Mesh(asteroidGeo, asteroidMat);
    asteroid.position.set(pos.x, pos.y, pos.z);
    asteroid.scale.set(
      pos.scale * rng.range(0.7, 1.3),
      pos.scale * rng.range(0.5, 1.0),
      pos.scale * rng.range(0.7, 1.3)
    );
    asteroid.rotation.set(
      rng.range(0, Math.PI * 2),
      rng.range(0, Math.PI * 2),
      rng.range(0, Math.PI * 2)
    );
    scene.add(asteroid);
    debris.push(asteroid);
  }

  return debris;
}

/**
 * Clear all debris from the scene
 */
export function clearDebrisField(scene: THREE.Scene, debris: THREE.Object3D[]): void {
  for (const d of debris) {
    scene.remove(d);
    disposeObject(d);
  }
}
