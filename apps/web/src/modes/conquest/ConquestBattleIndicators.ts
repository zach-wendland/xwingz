/**
 * ConquestBattleIndicators - Battle indicator visuals for conquest mode
 *
 * Handles:
 * - Battle "X" indicator creation
 * - Pulse animation
 * - Position updates at planets under attack
 */

import * as THREE from "three";
import { disposeObject } from "../../rendering/MeshManager";
import type { GalaxyPlanetState } from "../../conquest/GalaxySimulation";
import { GALAXY_SCALE } from "./ConquestConstants";

/**
 * Create a battle indicator mesh (crossed swords icon)
 */
export function createBattleIndicator(): THREE.Object3D {
  const group = new THREE.Group();

  // Crossed swords icon (simplified as X)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff4444,
    transparent: true,
    opacity: 0.9
  });

  const bar1 = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 2), mat);
  bar1.rotation.z = Math.PI / 4;
  group.add(bar1);

  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 2), mat);
  bar2.rotation.z = -Math.PI / 4;
  group.add(bar2);

  // Glow ring
  const ringGeo = new THREE.RingGeometry(12, 15, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  group.add(ring);

  return group;
}

/**
 * Update battle indicators for all planets
 */
export function updateBattleIndicators(
  scene: THREE.Scene,
  planets: GalaxyPlanetState[],
  battleIndicators: Map<number, THREE.Object3D>
): void {
  for (const planet of planets) {
    if (planet.underAttack) {
      let indicator = battleIndicators.get(planet.eid);

      if (!indicator) {
        indicator = createBattleIndicator();
        scene.add(indicator);
        battleIndicators.set(planet.eid, indicator);
      }

      // Position at planet
      const pos = planet.planetDef.position;
      const scale = GALAXY_SCALE * 0.18;
      indicator.position.set(pos[0] * scale, 40, pos[1] * scale);
      indicator.visible = true;

      // Pulse animation
      const pulseScale = 1 + Math.sin(Date.now() * 0.005) * 0.2;
      indicator.scale.setScalar(pulseScale);
    } else {
      const indicator = battleIndicators.get(planet.eid);
      if (indicator) {
        indicator.visible = false;
      }
    }
  }
}

/**
 * Clean up all battle indicators
 */
export function clearBattleIndicators(
  scene: THREE.Scene,
  battleIndicators: Map<number, THREE.Object3D>
): void {
  for (const indicator of battleIndicators.values()) {
    scene.remove(indicator);
    disposeObject(indicator);
  }
  battleIndicators.clear();
}
