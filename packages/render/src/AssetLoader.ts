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

// Asset path constants for the Kenney Space Kit
export const KENNEY_ASSETS = {
  // Ships
  CRAFT_CARGO_A: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_cargoA.glb',
  CRAFT_CARGO_B: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_cargoB.glb',
  CRAFT_MINER: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_miner.glb',
  CRAFT_RACER: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_racer.glb',
  CRAFT_SPEEDER_A: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_speederA.glb',
  CRAFT_SPEEDER_B: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_speederB.glb',
  CRAFT_SPEEDER_C: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_speederC.glb',
  CRAFT_SPEEDER_D: 'capital-ships/kenney_space-kit/Models/GLTF format/craft_speederD.glb',

  // Turrets
  TURRET_SINGLE: 'capital-ships/kenney_space-kit/Models/GLTF format/turret_single.glb',
  TURRET_DOUBLE: 'capital-ships/kenney_space-kit/Models/GLTF format/turret_double.glb',

  // Rockets/Projectiles
  ROCKET_BASE_A: 'capital-ships/kenney_space-kit/Models/GLTF format/rocket_baseA.glb',
  ROCKET_BASE_B: 'capital-ships/kenney_space-kit/Models/GLTF format/rocket_baseB.glb',

  // Hangars
  HANGAR_LARGE_A: 'capital-ships/kenney_space-kit/Models/GLTF format/hangar_largeA.glb',
  HANGAR_LARGE_B: 'capital-ships/kenney_space-kit/Models/GLTF format/hangar_largeB.glb',
  HANGAR_SMALL_A: 'capital-ships/kenney_space-kit/Models/GLTF format/hangar_smallA.glb',
  HANGAR_SMALL_B: 'capital-ships/kenney_space-kit/Models/GLTF format/hangar_smallB.glb',

  // Space environment
  METEOR: 'capital-ships/kenney_space-kit/Models/GLTF format/meteor.glb',
  METEOR_DETAILED: 'capital-ships/kenney_space-kit/Models/GLTF format/meteor_detailed.glb',
  CRATER: 'capital-ships/kenney_space-kit/Models/GLTF format/crater.glb',
} as const;
