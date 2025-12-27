/**
 * EnhancedLighting - Improved space lighting system
 *
 * Extracted from ConquestMode and enhanced with:
 * - MUCH brighter ambient lighting (2.0 vs 0.6) to fix visibility
 * - Configurability for different scene types
 * - Better default values for space environments
 */

import * as THREE from "three";

export interface LightingConfig {
  ambient?: number; // default 2.0 (much brighter than conquest's 0.6)
  sun?: number; // default 1.2
  fill?: number; // default 0.5
  glow?: number; // default 0.8
}

/**
 * Setup enhanced space lighting for any mode
 *
 * This replaces the too-dark conquest lighting with much brighter values
 * that make planets, ships, and UI elements clearly visible.
 */
export function setupEnhancedSpaceLighting(
  scene: THREE.Scene,
  config: LightingConfig = {}
): void {
  const { ambient = 2.0, sun = 1.2, fill = 0.5, glow = 0.8 } = config;

  // FIX: Much brighter ambient (was 0.6, now 2.0+) to fix conquest darkness
  scene.add(new THREE.AmbientLight(0x303050, ambient));

  // Main directional (sun-like)
  const sunLight = new THREE.DirectionalLight(0xffffff, sun);
  sunLight.position.set(500, 800, 400);
  scene.add(sunLight);

  // Blue fill light (softer than conquest original)
  const fillLight = new THREE.DirectionalLight(0x4488ff, fill);
  fillLight.position.set(-400, -200, -500);
  scene.add(fillLight);

  // Central galactic glow (optional point light)
  if (glow > 0) {
    const coreGlow = new THREE.PointLight(0xffffcc, glow, 1200, 1.2);
    coreGlow.position.set(0, 100, 0);
    scene.add(coreGlow);
  }
}
