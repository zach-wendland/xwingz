/**
 * ConquestPlanetVisuals - Planet visual updates for conquest mode
 *
 * Handles:
 * - Faction color updates on planet meshes
 * - Atmosphere and ring color changes
 * - Attack state visual feedback
 */

import * as THREE from "three";
import type { GalaxyPlanetState } from "../../conquest/GalaxySimulation";
import { FACTION_COLORS, FACTION_GLOW } from "./ConquestConstants";

/**
 * Update planet visuals based on faction control and attack state
 */
export function updatePlanetVisuals(
  planets: GalaxyPlanetState[],
  planetMeshes: THREE.Group[]
): void {
  for (let i = 0; i < planets.length; i++) {
    const planet = planets[i]!;
    const group = planetMeshes[i];
    if (!group) continue;

    // Update faction colors
    const atmosMesh = group.getObjectByName("atmosphere") as THREE.Mesh | undefined;
    if (atmosMesh) {
      const mat = atmosMesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(FACTION_GLOW[planet.controller]);
      mat.opacity = planet.underAttack ? 0.6 : 0.3;
    }

    const ring = group.getObjectByName("factionRing") as THREE.Mesh | undefined;
    if (ring) {
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(FACTION_COLORS[planet.controller]);
    }

    const planetMesh = group.getObjectByName("planet") as THREE.Mesh | undefined;
    if (planetMesh) {
      const mat = planetMesh.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(FACTION_COLORS[planet.controller]);
      mat.emissiveIntensity = planet.underAttack ? 0.4 : 0.15;
    }
  }
}
