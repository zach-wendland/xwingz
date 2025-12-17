/**
 * AssetLoader - GLTF/GLB model loading with caching
 *
 * Usage:
 *   const loader = new AssetLoader('/assets/models/');
 *   await loader.preload(['turret_single.glb', 'turret_double.glb']);
 *   const turret = loader.clone('turret_single.glb');
 *   scene.add(turret);
 */

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface AssetLoaderOptions {
  basePath?: string;
}

export class AssetLoader {
  private loader: GLTFLoader;
  private cache: Map<string, THREE.Group> = new Map();
  private loading: Map<string, Promise<THREE.Group>> = new Map();
  private basePath: string;

  constructor(options: AssetLoaderOptions = {}) {
    this.loader = new GLTFLoader();
    this.basePath = options.basePath ?? '/assets/models/';
  }

  /**
   * Load a single model, returning cached version if available.
   */
  async load(filename: string): Promise<THREE.Group> {
    // Return cached if available
    const cached = this.cache.get(filename);
    if (cached) {
      return cached;
    }

    // Return existing loading promise if in progress
    const existing = this.loading.get(filename);
    if (existing) {
      return existing;
    }

    // Start loading
    const promise = this.loadFile(filename);
    this.loading.set(filename, promise);

    try {
      const model = await promise;
      this.cache.set(filename, model);
      return model;
    } finally {
      this.loading.delete(filename);
    }
  }

  /**
   * Preload multiple models in parallel.
   */
  async preload(filenames: string[]): Promise<void> {
    await Promise.all(filenames.map(f => this.load(f)));
  }

  /**
   * Get a clone of a cached model. Must be loaded first.
   * Throws if model not in cache.
   */
  clone(filename: string): THREE.Group {
    const cached = this.cache.get(filename);
    if (!cached) {
      throw new Error(`Model not loaded: ${filename}. Call load() or preload() first.`);
    }
    return cached.clone();
  }

  /**
   * Get a clone if loaded, or load then clone.
   */
  async getOrLoad(filename: string): Promise<THREE.Group> {
    await this.load(filename);
    return this.clone(filename);
  }

  /**
   * Check if a model is cached.
   */
  isCached(filename: string): boolean {
    return this.cache.has(filename);
  }

  /**
   * Clear all cached models.
   */
  clearCache(): void {
    this.cache.forEach(model => {
      model.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
    });
    this.cache.clear();
  }

  private async loadFile(filename: string): Promise<THREE.Group> {
    const url = this.basePath + filename;

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf: GLTF) => {
          const model = gltf.scene;
          // Enable shadows by default
          model.traverse(obj => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          resolve(model);
        },
        undefined,
        (error) => {
          reject(new Error(`Failed to load ${url}: ${error}`));
        }
      );
    });
  }
}

// Singleton instance for convenience
let defaultLoader: AssetLoader | null = null;

export function getAssetLoader(options?: AssetLoaderOptions): AssetLoader {
  if (!defaultLoader) {
    defaultLoader = new AssetLoader(options);
  }
  return defaultLoader;
}

// Base path for Kenney Space Kit models
const KENNEY_BASE = 'capital-ships/kenney_space-kit/Models/GLTF format/';

// Asset path constants for the Kenney Space Kit
export const KENNEY_ASSETS = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Ships & Vehicles
  // ─────────────────────────────────────────────────────────────────────────────
  CRAFT_CARGO_A: `${KENNEY_BASE}craft_cargoA.glb`,
  CRAFT_CARGO_B: `${KENNEY_BASE}craft_cargoB.glb`,
  CRAFT_MINER: `${KENNEY_BASE}craft_miner.glb`,
  CRAFT_RACER: `${KENNEY_BASE}craft_racer.glb`,
  CRAFT_SPEEDER_A: `${KENNEY_BASE}craft_speederA.glb`,
  CRAFT_SPEEDER_B: `${KENNEY_BASE}craft_speederB.glb`,
  CRAFT_SPEEDER_C: `${KENNEY_BASE}craft_speederC.glb`,
  CRAFT_SPEEDER_D: `${KENNEY_BASE}craft_speederD.glb`,
  ROVER: `${KENNEY_BASE}rover.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Turrets & Weapons
  // ─────────────────────────────────────────────────────────────────────────────
  TURRET_SINGLE: `${KENNEY_BASE}turret_single.glb`,
  TURRET_DOUBLE: `${KENNEY_BASE}turret_double.glb`,
  WEAPON_GUN: `${KENNEY_BASE}weapon_gun.glb`,
  WEAPON_RIFLE: `${KENNEY_BASE}weapon_rifle.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Rockets/Projectiles
  // ─────────────────────────────────────────────────────────────────────────────
  ROCKET_BASE_A: `${KENNEY_BASE}rocket_baseA.glb`,
  ROCKET_BASE_B: `${KENNEY_BASE}rocket_baseB.glb`,
  ROCKET_FINS_A: `${KENNEY_BASE}rocket_finsA.glb`,
  ROCKET_FINS_B: `${KENNEY_BASE}rocket_finsB.glb`,
  ROCKET_TOP_A: `${KENNEY_BASE}rocket_topA.glb`,
  ROCKET_TOP_B: `${KENNEY_BASE}rocket_topB.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Hangars & Gates
  // ─────────────────────────────────────────────────────────────────────────────
  HANGAR_LARGE_A: `${KENNEY_BASE}hangar_largeA.glb`,
  HANGAR_LARGE_B: `${KENNEY_BASE}hangar_largeB.glb`,
  HANGAR_SMALL_A: `${KENNEY_BASE}hangar_smallA.glb`,
  HANGAR_SMALL_B: `${KENNEY_BASE}hangar_smallB.glb`,
  HANGAR_ROUND_A: `${KENNEY_BASE}hangar_roundA.glb`,
  HANGAR_ROUND_B: `${KENNEY_BASE}hangar_roundB.glb`,
  HANGAR_ROUND_GLASS: `${KENNEY_BASE}hangar_roundGlass.glb`,
  GATE_COMPLEX: `${KENNEY_BASE}gate_complex.glb`,
  GATE_SIMPLE: `${KENNEY_BASE}gate_simple.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Corridors (Echo Base interiors)
  // ─────────────────────────────────────────────────────────────────────────────
  CORRIDOR: `${KENNEY_BASE}corridor.glb`,
  CORRIDOR_CORNER: `${KENNEY_BASE}corridor_corner.glb`,
  CORRIDOR_CORNER_ROUND: `${KENNEY_BASE}corridor_cornerRound.glb`,
  CORRIDOR_CROSS: `${KENNEY_BASE}corridor_cross.glb`,
  CORRIDOR_DETAILED: `${KENNEY_BASE}corridor_detailed.glb`,
  CORRIDOR_END: `${KENNEY_BASE}corridor_end.glb`,
  CORRIDOR_OPEN: `${KENNEY_BASE}corridor_open.glb`,
  CORRIDOR_SPLIT: `${KENNEY_BASE}corridor_split.glb`,
  CORRIDOR_WALL: `${KENNEY_BASE}corridor_wall.glb`,
  CORRIDOR_WINDOW: `${KENNEY_BASE}corridor_window.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Terrain & Rocks (Hoth ice plains)
  // ─────────────────────────────────────────────────────────────────────────────
  ROCK: `${KENNEY_BASE}rock.glb`,
  ROCK_LARGE_A: `${KENNEY_BASE}rock_largeA.glb`,
  ROCK_LARGE_B: `${KENNEY_BASE}rock_largeB.glb`,
  ROCK_CRYSTALS: `${KENNEY_BASE}rock_crystals.glb`,
  ROCK_CRYSTALS_LARGE_A: `${KENNEY_BASE}rock_crystalsLargeA.glb`,
  ROCK_CRYSTALS_LARGE_B: `${KENNEY_BASE}rock_crystalsLargeB.glb`,
  ROCKS_SMALL_A: `${KENNEY_BASE}rocks_smallA.glb`,
  ROCKS_SMALL_B: `${KENNEY_BASE}rocks_smallB.glb`,
  TERRAIN: `${KENNEY_BASE}terrain.glb`,
  TERRAIN_RAMP: `${KENNEY_BASE}terrain_ramp.glb`,
  TERRAIN_RAMP_LARGE: `${KENNEY_BASE}terrain_rampLarge.glb`,
  TERRAIN_SIDE: `${KENNEY_BASE}terrain_side.glb`,
  TERRAIN_SIDE_CLIFF: `${KENNEY_BASE}terrain_sideCliff.glb`,
  TERRAIN_SIDE_CORNER: `${KENNEY_BASE}terrain_sideCorner.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Craters & Space Environment
  // ─────────────────────────────────────────────────────────────────────────────
  CRATER: `${KENNEY_BASE}crater.glb`,
  CRATER_LARGE: `${KENNEY_BASE}craterLarge.glb`,
  METEOR: `${KENNEY_BASE}meteor.glb`,
  METEOR_DETAILED: `${KENNEY_BASE}meteor_detailed.glb`,
  METEOR_HALF: `${KENNEY_BASE}meteor_half.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Platforms (trench fortifications)
  // ─────────────────────────────────────────────────────────────────────────────
  PLATFORM_CENTER: `${KENNEY_BASE}platform_center.glb`,
  PLATFORM_CORNER: `${KENNEY_BASE}platform_corner.glb`,
  PLATFORM_CORNER_OPEN: `${KENNEY_BASE}platform_cornerOpen.glb`,
  PLATFORM_CORNER_ROUND: `${KENNEY_BASE}platform_cornerRound.glb`,
  PLATFORM_END: `${KENNEY_BASE}platform_end.glb`,
  PLATFORM_HIGH: `${KENNEY_BASE}platform_high.glb`,
  PLATFORM_LARGE: `${KENNEY_BASE}platform_large.glb`,
  PLATFORM_LONG: `${KENNEY_BASE}platform_long.glb`,
  PLATFORM_LOW: `${KENNEY_BASE}platform_low.glb`,
  PLATFORM_SIDE: `${KENNEY_BASE}platform_side.glb`,
  PLATFORM_SMALL: `${KENNEY_BASE}platform_small.glb`,
  PLATFORM_STRAIGHT: `${KENNEY_BASE}platform_straight.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Machinery & Generators (shield generator, base equipment)
  // ─────────────────────────────────────────────────────────────────────────────
  MACHINE_BARREL: `${KENNEY_BASE}machine_barrel.glb`,
  MACHINE_BARREL_LARGE: `${KENNEY_BASE}machine_barrelLarge.glb`,
  MACHINE_GENERATOR: `${KENNEY_BASE}machine_generator.glb`,
  MACHINE_GENERATOR_LARGE: `${KENNEY_BASE}machine_generatorLarge.glb`,
  MACHINE_WIRELESS: `${KENNEY_BASE}machine_wireless.glb`,
  SATELLITE_DISH: `${KENNEY_BASE}satelliteDish.glb`,
  SATELLITE_DISH_DETAILED: `${KENNEY_BASE}satelliteDish_detailed.glb`,
  SATELLITE_DISH_LARGE: `${KENNEY_BASE}satelliteDish_large.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Props & Objects
  // ─────────────────────────────────────────────────────────────────────────────
  BARREL: `${KENNEY_BASE}barrel.glb`,
  BARRELS: `${KENNEY_BASE}barrels.glb`,
  BARRELS_RAIL: `${KENNEY_BASE}barrels_rail.glb`,
  BONES: `${KENNEY_BASE}bones.glb`,
  DESK_COMPUTER: `${KENNEY_BASE}desk_computer.glb`,
  DESK_CHAIR: `${KENNEY_BASE}desk_chair.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Characters
  // ─────────────────────────────────────────────────────────────────────────────
  ALIEN: `${KENNEY_BASE}alien.glb`,
  ASTRONAUT_A: `${KENNEY_BASE}astronautA.glb`,
  ASTRONAUT_B: `${KENNEY_BASE}astronautB.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Structures & Supports
  // ─────────────────────────────────────────────────────────────────────────────
  STRUCTURE: `${KENNEY_BASE}structure.glb`,
  STRUCTURE_CLOSED: `${KENNEY_BASE}structure_closed.glb`,
  STRUCTURE_DETAILED: `${KENNEY_BASE}structure_detailed.glb`,
  SUPPORTS_HIGH: `${KENNEY_BASE}supports_high.glb`,
  SUPPORTS_LOW: `${KENNEY_BASE}supports_low.glb`,
  STAIRS: `${KENNEY_BASE}stairs.glb`,
  STAIRS_CORNER: `${KENNEY_BASE}stairs_corner.glb`,
  STAIRS_SHORT: `${KENNEY_BASE}stairs_short.glb`,

  // ─────────────────────────────────────────────────────────────────────────────
  // Pipes (base infrastructure)
  // ─────────────────────────────────────────────────────────────────────────────
  PIPE_CORNER: `${KENNEY_BASE}pipe_corner.glb`,
  PIPE_CROSS: `${KENNEY_BASE}pipe_cross.glb`,
  PIPE_END: `${KENNEY_BASE}pipe_end.glb`,
  PIPE_STRAIGHT: `${KENNEY_BASE}pipe_straight.glb`,
  PIPE_SPLIT: `${KENNEY_BASE}pipe_split.glb`,
} as const;
