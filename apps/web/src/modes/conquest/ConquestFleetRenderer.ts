/**
 * ConquestFleetRenderer - Fleet visualization for galactic conquest
 *
 * Handles:
 * - Fleet mesh creation and updates
 * - Hyperspace trail rendering
 * - Fleet position interpolation
 */

import * as THREE from "three";
import { CONQUEST_FACTION } from "@xwingz/gameplay";
import { createProceduralShip } from "@xwingz/render";
import { disposeObject } from "../../rendering/MeshManager";
import type { GalaxyFleetState, GalaxyPlanetState } from "../../conquest/GalaxySimulation";
import { GALAXY_SCALE, FACTION_COLORS, FACTION_GLOW } from "./ConquestConstants";

/**
 * Create a fleet mesh group with ship models
 */
export function createFleetMesh(fleet: GalaxyFleetState): THREE.Group {
  const group = new THREE.Group();

  // Use faction-appropriate ship models for visual variety
  const isRebel = fleet.faction === CONQUEST_FACTION.REBEL;

  // Create a small representative ship (scales down for strategic view)
  if (fleet.capitalShips > 0) {
    // Capital fleet - show a mini star destroyer or nebulon-b
    const capShip = createProceduralShip({
      type: isRebel ? "nebulon_b" : "star_destroyer",
      scale: 0.15, // Very small for strategic map
      enableShadows: false
    });
    capShip.position.y = 8;
    group.add(capShip);
  } else {
    // Fighter fleet - show mini fighters
    const fighterType = isRebel ? "xwing" : "tie_ln";
    for (let i = 0; i < Math.min(fleet.fighterSquadrons, 3); i++) {
      const fighter = createProceduralShip({
        type: fighterType,
        scale: 0.3,
        enableShadows: false
      });
      fighter.position.set((i - 1) * 6, 8, 0);
      fighter.rotation.x = Math.PI / 6; // Angle upward slightly
      group.add(fighter);
    }
  }

  // Glow effect underneath to show faction and make visible from far
  const glowGeo = new THREE.CircleGeometry(12, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: FACTION_GLOW[fleet.faction],
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 2;
  group.add(glow);

  return group;
}

/**
 * Update or create hyperspace trail
 */
export function updateHyperspaceTrail(
  scene: THREE.Scene,
  hyperspaceTrails: Map<number, THREE.Line>,
  fleetEid: number,
  start: THREE.Vector3,
  current: THREE.Vector3,
  faction: number
): void {
  let trail = hyperspaceTrails.get(fleetEid);

  if (!trail) {
    // Create geometry with pre-allocated buffer (reused across frames)
    const positions = new Float32Array(6); // 2 points x 3 components
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: FACTION_COLORS[faction as keyof typeof FACTION_COLORS],
      transparent: true,
      opacity: 0.6
    });
    trail = new THREE.Line(geometry, material);
    scene.add(trail);
    hyperspaceTrails.set(fleetEid, trail);
  }

  // Update existing buffer in-place (no new allocations)
  const posAttr = trail.geometry.attributes.position as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  arr[0] = start.x;
  arr[1] = start.y;
  arr[2] = start.z;
  arr[3] = current.x;
  arr[4] = current.y;
  arr[5] = current.z;
  posAttr.needsUpdate = true;
}

/**
 * Update all fleet visuals (positions, colors, trails)
 */
export function updateFleetVisuals(
  scene: THREE.Scene,
  fleets: GalaxyFleetState[],
  planets: GalaxyPlanetState[],
  fleetMeshes: Map<number, THREE.Object3D>,
  hyperspaceTrails: Map<number, THREE.Line>
): void {
  const activeFleetEids = new Set(fleets.map((f) => f.eid));

  // Remove meshes for destroyed fleets
  for (const [eid, mesh] of fleetMeshes) {
    if (!activeFleetEids.has(eid)) {
      scene.remove(mesh);
      disposeObject(mesh);
      fleetMeshes.delete(eid);

      // Also clean up trails
      const trail = hyperspaceTrails.get(eid);
      if (trail) {
        scene.remove(trail);
        trail.geometry.dispose();
        (trail.material as THREE.Material).dispose();
        hyperspaceTrails.delete(eid);
      }
    }
  }

  for (const fleet of fleets) {
    let mesh = fleetMeshes.get(fleet.eid);

    // Create fleet mesh if needed
    if (!mesh) {
      mesh = createFleetMesh(fleet);
      scene.add(mesh);
      fleetMeshes.set(fleet.eid, mesh);
    }

    // Update position
    if (fleet.currentPlanetEid >= 0 && fleet.destinationPlanetEid < 0) {
      // At a planet
      const planet = planets.find((p) => p.eid === fleet.currentPlanetEid);
      if (planet) {
        const pos = planet.planetDef.position;
        const scale = GALAXY_SCALE * 0.18;
        mesh.position.set(pos[0] * scale + 30, 15, pos[1] * scale);
      }
      mesh.visible = true;

      // Remove hyperspace trail
      const trail = hyperspaceTrails.get(fleet.eid);
      if (trail) {
        scene.remove(trail);
        trail.geometry.dispose();
        (trail.material as THREE.Material).dispose();
        hyperspaceTrails.delete(fleet.eid);
      }
    } else if (fleet.destinationPlanetEid >= 0) {
      // In hyperspace
      const srcPlanet = planets.find((p) => p.eid === fleet.currentPlanetEid);
      const destPlanet = planets.find((p) => p.eid === fleet.destinationPlanetEid);

      if (srcPlanet && destPlanet) {
        const scale = GALAXY_SCALE * 0.18;
        const srcPos = new THREE.Vector3(
          srcPlanet.planetDef.position[0] * scale,
          15,
          srcPlanet.planetDef.position[1] * scale
        );
        const destPos = new THREE.Vector3(
          destPlanet.planetDef.position[0] * scale,
          15,
          destPlanet.planetDef.position[1] * scale
        );

        // Interpolate position
        const t = fleet.movementProgress;
        mesh.position.lerpVectors(srcPos, destPos, t);

        // Update or create hyperspace trail
        updateHyperspaceTrail(scene, hyperspaceTrails, fleet.eid, srcPos, mesh.position, fleet.faction);
      }
      mesh.visible = true;
    }

    // Update fleet color
    const fleetMat = (mesh.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial | undefined;
    if (fleetMat) {
      fleetMat.color.setHex(FACTION_COLORS[fleet.faction]);
    }
  }
}
