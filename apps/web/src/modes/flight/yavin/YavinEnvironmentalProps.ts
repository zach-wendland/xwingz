/**
 * YavinEnvironmentalProps - Environmental prop spawning for Yavin 4
 *
 * Handles:
 * - Rock formations (outer ring, mid ring, inner ring)
 * - Defensive turrets on temple steps
 * - Generator props and barrels
 * - Communication dish on temple roof
 * - Procedural fallback rocks when assets unavailable
 */

import * as THREE from "three";
import { createRng, deriveSeed } from "@xwingz/procgen";
import { AssetLoader, KENNEY_ASSETS } from "@xwingz/render";
import { getTerrainHeight } from "./YavinTerrainBuilder";
import type { TerrainParams } from "../FlightScenarioTypes";

/**
 * Spawn environmental props (rocks, turrets, generators) around the temple
 */
export async function spawnEnvironmentalProps(
  scene: THREE.Scene,
  assetLoader: AssetLoader,
  seed: bigint,
  terrainParams: TerrainParams
): Promise<THREE.Object3D[]> {
  const rng = createRng(deriveSeed(seed, "yavin_props"));
  const props: THREE.Object3D[] = [];

  // Preload Kenney assets for environmental props
  const propsToLoad = [
    KENNEY_ASSETS.ROCK_LARGE_A,
    KENNEY_ASSETS.ROCK_LARGE_B,
    KENNEY_ASSETS.ROCK,
    KENNEY_ASSETS.ROCK_CRYSTALS,
    KENNEY_ASSETS.METEOR,
    KENNEY_ASSETS.TURRET_DOUBLE,
    KENNEY_ASSETS.TURRET_SINGLE,
    KENNEY_ASSETS.MACHINE_GENERATOR,
    KENNEY_ASSETS.SATELLITE_DISH_LARGE,
    KENNEY_ASSETS.BARRELS
  ];

  try {
    await assetLoader.preload(propsToLoad);
  } catch {
    // Assets not available, use procedural fallbacks
    const proceduralProps = spawnProceduralRocks(scene, rng, terrainParams);
    return proceduralProps;
  }

  // OUTER RING - Obstacle field (z = -1200 to -1600)
  // Forces TIEs to break formation
  const outerRocks = [
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: -600, z: -1400, scale: 3.2, rotY: 0.4 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -350, z: -1550, scale: 2.8, rotY: 1.2 },
    { asset: KENNEY_ASSETS.METEOR, x: -700, z: -1200, scale: 2.5, rotY: 2.1 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 550, z: -1350, scale: 3.5, rotY: 4.8 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: 400, z: -1500, scale: 2.6, rotY: 3.3 },
    { asset: KENNEY_ASSETS.METEOR, x: 700, z: -1250, scale: 2.8, rotY: 0.9 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 0, z: -1600, scale: 3.0, rotY: 1.5 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_B, x: -200, z: -1350, scale: 2.4, rotY: 5.5 }
  ];

  // MID RING - Engagement zone (z = -400 to -800)
  // Provides cover for dogfighting
  const midRocks = [
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: -500, z: -600, scale: 2.2, rotY: 1.8 },
    { asset: KENNEY_ASSETS.ROCK_LARGE_A, x: 520, z: -550, scale: 2.4, rotY: 5.2 },
    { asset: KENNEY_ASSETS.ROCK_CRYSTALS, x: -380, z: -700, scale: 1.8, rotY: 0.7 },
    { asset: KENNEY_ASSETS.ROCK, x: 450, z: -750, scale: 2.0, rotY: 2.3 },
    { asset: KENNEY_ASSETS.ROCK_CRYSTALS, x: 380, z: -680, scale: 1.6, rotY: 4.1 }
  ];

  // INNER RING - Temple flanks (z = 100 to 300)
  // Frames the temple
  const innerRocks = [
    { asset: KENNEY_ASSETS.ROCK, x: -200, z: 120, scale: 1.5, rotY: 2.9 },
    { asset: KENNEY_ASSETS.ROCK, x: 190, z: 100, scale: 1.4, rotY: 4.1 },
    { asset: KENNEY_ASSETS.ROCK, x: -240, z: -80, scale: 1.2, rotY: 1.1 },
    { asset: KENNEY_ASSETS.ROCK, x: 230, z: -60, scale: 1.3, rotY: 3.7 }
  ];

  // Spawn all rocks
  for (const rock of [...outerRocks, ...midRocks, ...innerRocks]) {
    try {
      const mesh = assetLoader.clone(rock.asset);
      const y = getTerrainHeight(rock.x, rock.z, terrainParams) + rock.scale * 4;
      mesh.position.set(rock.x, y, rock.z);
      mesh.rotation.y = rock.rotY;
      mesh.scale.setScalar(rock.scale);
      // Darken to match jungle stone aesthetic
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.color) mat.color.multiplyScalar(0.75);
        }
      });
      scene.add(mesh);
      props.push(mesh);
    } catch {
      // Individual asset failed, continue
    }
  }

  // DEFENSIVE TURRETS - On temple steps
  const turretPositions = [
    { asset: KENNEY_ASSETS.TURRET_DOUBLE, x: -110, y: 49 + 15, z: 105, scale: 1.3 },
    { asset: KENNEY_ASSETS.TURRET_DOUBLE, x: 110, y: 49 + 15, z: 105, scale: 1.3 },
    { asset: KENNEY_ASSETS.TURRET_SINGLE, x: -70, y: 1.5, z: 340, scale: 1.0 },
    { asset: KENNEY_ASSETS.TURRET_SINGLE, x: 70, y: 1.5, z: 340, scale: 1.0 }
  ];

  for (const turret of turretPositions) {
    try {
      const mesh = assetLoader.clone(turret.asset);
      const baseY = getTerrainHeight(turret.x, turret.z, terrainParams);
      mesh.position.set(turret.x, baseY + turret.y, turret.z);
      mesh.scale.setScalar(turret.scale);
      mesh.rotation.y = Math.PI; // Face outward
      scene.add(mesh);
      props.push(mesh);
    } catch {
      // Continue if asset fails
    }
  }

  // GENERATOR PROPS - Power infrastructure
  const generatorPositions = [
    { asset: KENNEY_ASSETS.MACHINE_GENERATOR, x: -50, z: 200, scale: 0.8 },
    { asset: KENNEY_ASSETS.MACHINE_GENERATOR, x: 50, z: 200, scale: 0.8 },
    { asset: KENNEY_ASSETS.BARRELS, x: -30, z: 180, scale: 0.6 },
    { asset: KENNEY_ASSETS.BARRELS, x: 35, z: 185, scale: 0.6 }
  ];

  for (const gen of generatorPositions) {
    try {
      const mesh = assetLoader.clone(gen.asset);
      const y = getTerrainHeight(gen.x, gen.z, terrainParams) + 1.5;
      mesh.position.set(gen.x, y, gen.z);
      mesh.scale.setScalar(gen.scale);
      scene.add(mesh);
      props.push(mesh);
    } catch {
      // Continue if asset fails
    }
  }

  // COMM DISH - On temple roof
  try {
    const dish = assetLoader.clone(KENNEY_ASSETS.SATELLITE_DISH_LARGE);
    const templeTopY = getTerrainHeight(0, 0, terrainParams) + 34 + 30 + 28 + 12;
    dish.position.set(40, templeTopY + 15, -30);
    dish.scale.setScalar(0.8);
    dish.rotation.x = -0.26; // Tilt toward sky
    scene.add(dish);
    props.push(dish);
  } catch {
    // Continue if asset fails
  }

  return props;
}

/**
 * Fallback procedural rocks when Kenney assets aren't available
 */
function spawnProceduralRocks(
  scene: THREE.Scene,
  rng: ReturnType<typeof createRng>,
  terrainParams: TerrainParams
): THREE.Object3D[] {
  const props: THREE.Object3D[] = [];
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5a4a, roughness: 0.95 });

  const rockPositions = [
    { x: -600, z: -1400, scale: 25 },
    { x: 550, z: -1350, scale: 28 },
    { x: -500, z: -600, scale: 18 },
    { x: 520, z: -550, scale: 20 },
    { x: -200, z: 120, scale: 12 },
    { x: 190, z: 100, scale: 11 }
  ];

  for (const pos of rockPositions) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const y = getTerrainHeight(pos.x, pos.z, terrainParams) + pos.scale * 0.5;
    rock.position.set(pos.x, y, pos.z);
    rock.scale.set(
      pos.scale * rng.range(0.8, 1.2),
      pos.scale * rng.range(0.6, 1.0),
      pos.scale * rng.range(0.8, 1.2)
    );
    rock.rotation.set(rng.range(0, 0.3), rng.range(0, Math.PI * 2), rng.range(0, 0.3));
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    props.push(rock);
  }

  return props;
}
