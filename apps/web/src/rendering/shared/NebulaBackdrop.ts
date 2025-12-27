/**
 * NebulaBackdrop - Procedural nebula background sphere
 *
 * Extracted from ConquestMode with enhancements:
 * - Configurable color themes (purple, blue, green, orange)
 * - Adjustable radius and opacity
 * - Reusable across all space scenes
 */

import * as THREE from "three";

export interface NebulaConfig {
  radius?: number; // default 2500
  color?: number | string; // default 0x1a0a30 (deep purple)
  opacity?: number; // default 0.6
  segments?: number; // default 32
}

/**
 * Nebula color presets
 */
export const NebulaColors = {
  DEEP_PURPLE: 0x1a0a30,
  DARK_BLUE: 0x0a1a30,
  EMERALD: 0x0a301a,
  ORANGE_RED: 0x301a0a
} as const;

/**
 * Build nebula backdrop sphere
 *
 * Creates a large inverted sphere that provides atmospheric depth
 * to space scenes without overwhelming the foreground.
 */
export function buildNebulaBackdrop(config: NebulaConfig = {}): THREE.Mesh {
  const {
    radius = 2500,
    color = NebulaColors.DEEP_PURPLE,
    opacity = 0.6,
    segments = 32
  } = config;

  const geometry = new THREE.SphereGeometry(radius, segments, segments);
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide, // Render inside of sphere
    transparent: true,
    opacity
  });

  return new THREE.Mesh(geometry, material);
}

/**
 * Dispose nebula geometry and material
 */
export function disposeNebula(nebula: THREE.Mesh | null): void {
  if (!nebula) return;
  nebula.geometry.dispose();
  (nebula.material as THREE.Material).dispose();
}
