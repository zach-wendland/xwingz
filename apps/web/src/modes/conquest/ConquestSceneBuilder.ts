/**
 * ConquestSceneBuilder - Scene setup for galactic conquest view
 *
 * Handles:
 * - Starfield generation
 * - Nebula backdrop
 * - Planet mesh creation with faction indicators
 * - Selection ring
 */

import * as THREE from "three";
import { SeededRNG } from "@xwingz/core";
import { getPlanetTexture } from "@xwingz/render";
import type { GalaxyPlanetState } from "../../conquest/GalaxySimulation";
import { GALAXY_SCALE, FACTION_COLORS, FACTION_GLOW } from "./ConquestConstants";

/**
 * Setup conquest mode lighting
 */
export function setupConquestLighting(scene: THREE.Scene): void {
  // Ambient for base visibility
  scene.add(new THREE.AmbientLight(0x303050, 0.6));

  // Main directional (sun-like)
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(500, 800, 400);
  scene.add(sun);

  // Blue fill light
  const fill = new THREE.DirectionalLight(0x4488ff, 0.5);
  fill.position.set(-400, -200, -500);
  scene.add(fill);

  // Central galactic glow
  const coreGlow = new THREE.PointLight(0xffffcc, 0.8, 1200, 1.2);
  coreGlow.position.set(0, 100, 0);
  scene.add(coreGlow);
}

/**
 * Build starfield background
 */
export function buildConquestStarfield(scene: THREE.Scene): THREE.Points {
  const count = 4000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  // Use fixed seed for deterministic starfield
  const rng = new SeededRNG(42);

  for (let i = 0; i < count; i++) {
    const r = 3000 + rng.next() * 12000;
    const theta = rng.next() * Math.PI * 2;
    const phi = Math.acos(rng.next() * 2 - 1);

    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Color variation - blue/white stars
    const brightness = 0.6 + rng.next() * 0.4;
    colors[i * 3 + 0] = brightness * (0.8 + rng.next() * 0.2);
    colors[i * 3 + 1] = brightness * (0.85 + rng.next() * 0.15);
    colors[i * 3 + 2] = brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 2.5,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9
  });

  const starfield = new THREE.Points(geometry, material);
  scene.add(starfield);
  return starfield;
}

/**
 * Build nebula backdrop
 */
export function buildConquestNebula(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(2500, 32, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0x1a0a30,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.6
  });

  const nebula = new THREE.Mesh(geometry, material);
  scene.add(nebula);
  return nebula;
}

/**
 * Create a planet mesh group with atmosphere and faction ring
 */
export function createConquestPlanetMesh(planet: GalaxyPlanetState): THREE.Group {
  const group = new THREE.Group();
  const pos = planet.planetDef.position;
  const scale = GALAXY_SCALE * 0.18;

  group.position.set(pos[0] * scale, 0, pos[1] * scale);
  group.userData.planetIndex = planet.planetIndex;

  // Get procedural planet texture
  const planetTexture = getPlanetTexture(
    planet.planetDef.style as any,
    planet.planetDef.id,
    256
  );

  // Planet sphere with textured material
  const planetGeo = new THREE.SphereGeometry(16, 32, 32);
  const planetMat = new THREE.MeshStandardMaterial({
    map: planetTexture,
    emissive: 0xffffff,
    emissiveMap: planetTexture,
    emissiveIntensity: 0.8,
    roughness: 0.8,
    metalness: 0.1
  });
  const planetMesh = new THREE.Mesh(planetGeo, planetMat);
  planetMesh.name = "planet";
  group.add(planetMesh);

  // Atmosphere glow
  const atmosGeo = new THREE.SphereGeometry(19, 24, 24);
  const atmosMat = new THREE.MeshBasicMaterial({
    color: FACTION_GLOW[planet.controller],
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide
  });
  const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
  atmosMesh.name = "atmosphere";
  group.add(atmosMesh);

  // Faction ring indicator
  const ringGeo = new THREE.RingGeometry(22, 24, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: FACTION_COLORS[planet.controller],
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.name = "factionRing";
  group.add(ring);

  // Name label (sprite)
  const label = createTextSprite(planet.planetDef.name.toUpperCase());
  label.position.set(0, 32, 0);
  group.add(label);

  return group;
}

/**
 * Create a text sprite for planet labels
 */
export function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(50, 12.5, 1);
  return sprite;
}

/**
 * Build selection ring mesh
 */
export function buildSelectionRing(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.RingGeometry(28, 32, 64);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  return ring;
}

/**
 * Update selection ring position and animation
 */
export function updateSelectionRing(
  ring: THREE.Mesh | null,
  selectedPlanetIndex: number,
  planetMeshes: THREE.Group[]
): void {
  if (!ring || selectedPlanetIndex < 0) {
    if (ring) ring.visible = false;
    return;
  }

  const group = planetMeshes[selectedPlanetIndex];
  if (!group) return;

  ring.position.copy(group.position);
  ring.position.y = 1;
  ring.visible = true;

  // Animate rotation
  ring.rotation.z += 0.01;
}
