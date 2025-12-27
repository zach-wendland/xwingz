/**
 * EnhancedStarfield - Procedural starfield generator
 *
 * Extracted from ConquestMode with enhancements:
 * - Seeded RNG for determinism
 * - Configurable star count, colors, opacity
 * - Reusable across all space scenes (map, flight, etc.)
 */

import * as THREE from "three";
import { SeededRNG } from "@xwingz/core";

export interface StarfieldConfig {
  count?: number; // default 4000
  minRadius?: number; // default 3000
  maxRadius?: number; // default 15000
  opacity?: number; // default 0.9
  size?: number; // default 2.5
}

/**
 * Build procedural starfield background
 *
 * @param seed - Seed for deterministic star placement (use system seed for variety)
 * @param config - Optional configuration for star count, size, etc.
 */
export function buildEnhancedStarfield(
  seed: number,
  config: StarfieldConfig = {}
): THREE.Points {
  const {
    count = 4000,
    minRadius = 3000,
    maxRadius = 15000,
    opacity = 0.9,
    size = 2.5
  } = config;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rng = new SeededRNG(seed);

  for (let i = 0; i < count; i++) {
    // Spherical distribution
    const r = minRadius + rng.next() * (maxRadius - minRadius);
    const theta = rng.next() * Math.PI * 2;
    const phi = Math.acos(rng.next() * 2 - 1);

    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Color variation - blue/white stars with brightness variation
    const brightness = 0.6 + rng.next() * 0.4;
    colors[i * 3 + 0] = brightness * (0.8 + rng.next() * 0.2); // R
    colors[i * 3 + 1] = brightness * (0.85 + rng.next() * 0.15); // G
    colors[i * 3 + 2] = brightness; // B (more blue)
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity
  });

  return new THREE.Points(geometry, material);
}

/**
 * Dispose starfield geometry and material
 */
export function disposeStarfield(starfield: THREE.Points | null): void {
  if (!starfield) return;
  starfield.geometry.dispose();
  (starfield.material as THREE.Material).dispose();
}
