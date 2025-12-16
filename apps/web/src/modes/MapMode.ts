/**
 * MapMode - Galaxy map for planet selection
 */

import * as THREE from "three";
import { createRng, deriveSeed, getMission, type SystemDef } from "@xwingz/procgen";
import { PLANETS, planetToSystem, type PlanetDef } from "@xwingz/data";
import { getPlanetTexture, clearPlanetTextureCache } from "@xwingz/render";
import type { ModeHandler, ModeContext } from "./types";
import { disposeObject } from "../rendering/MeshManager";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const GALAXY_SCALE = 1000;
const GLOBAL_SEED = 42n;

// Fixed Yavin system for story mission
const YAVIN_DEFENSE_SYSTEM: SystemDef = {
  id: "yavin_4",
  seed: deriveSeed(GLOBAL_SEED, "story", "yavin_4"),
  sectorId: "story",
  sectorCoord: [0, 0, 0],
  localPos: [0, 0, 0],
  galaxyPos: [0, 0, 0],
  archetypeId: "rebel_base",
  tags: ["jungle", "rebel_base", "massassi_temple"],
  starClass: "g",
  planetCount: 1,
  poiDensity: 1,
  controllingFaction: "republic",
  economy: { wealth: 0.55, industry: 0.6, security: 0.85 },
  storyAnchorChance: 1
};

// ─────────────────────────────────────────────────────────────────────────────
// Map Mode State
// ─────────────────────────────────────────────────────────────────────────────

export class MapMode implements ModeHandler {
  // Three.js objects - individual planet groups (like ConquestMode)
  private planetGroups: THREE.Group[] = [];
  private mapStarfield: THREE.Points | null = null;
  private selectedMarker: THREE.Mesh | null = null;

  // Selection state
  private selectedSystem: SystemDef | null = null;
  private selectedPlanetIndex = -1;

  // Input helpers
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Event handlers (stored for cleanup)
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  constructor() {
    this.raycaster.params.Points.threshold = 25;
  }

  enter(ctx: ModeContext): void {
    ctx.controls.enabled = true;

    // Setup scene lighting
    ctx.scene.clear();
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(350, 620, 280);
    ctx.scene.add(sun);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.6);
    fillLight.position.set(-300, -200, -400);
    ctx.scene.add(fillLight);

    const centerGlow = new THREE.PointLight(0xffffcc, 0.5, 800, 1.5);
    centerGlow.position.set(0, 50, 0);
    ctx.scene.add(centerGlow);

    ctx.camera.position.set(0, 200, 600);

    // Build galaxy
    this.buildGalaxy(ctx);

    // Setup input handlers
    this.attachInputHandlers(ctx);
  }

  tick(ctx: ModeContext, _dt: number): void {
    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  exit(ctx: ModeContext): void {
    this.detachInputHandlers();

    // Cleanup planet groups (including sprite textures)
    for (const group of this.planetGroups) {
      group.traverse((child) => {
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
      ctx.scene.remove(group);
      disposeObject(group);
    }
    this.planetGroups = [];

    // Cleanup starfield
    if (this.mapStarfield) {
      ctx.scene.remove(this.mapStarfield);
      this.mapStarfield.geometry.dispose();
      (this.mapStarfield.material as THREE.Material).dispose();
      this.mapStarfield = null;
    }

    // Cleanup selection marker
    if (this.selectedMarker) {
      ctx.scene.remove(this.selectedMarker);
      disposeObject(this.selectedMarker);
      this.selectedMarker = null;
    }

    // Clear planet texture cache
    clearPlanetTextureCache();

    this.selectedSystem = null;
    this.selectedPlanetIndex = -1;
  }

  private buildGalaxy(ctx: ModeContext): void {
    // Build individual planet groups (matching ConquestMode style)
    for (let i = 0; i < PLANETS.length; i++) {
      const planet = PLANETS[i]!;
      const group = this.createPlanetMesh(planet, i);
      ctx.scene.add(group);
      this.planetGroups.push(group);
    }

    // Backdrop starfield
    const starRng = createRng(deriveSeed(GLOBAL_SEED, "map_starfield_v0"));
    const count = 4000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 3000 + starRng.range(0, 12000);
      const theta = starRng.range(0, Math.PI * 2);
      const phi = Math.acos(starRng.range(-1, 1));
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Color variation - blue/white stars
      const brightness = 0.6 + starRng.range(0, 0.4);
      colors[i * 3 + 0] = brightness * (0.8 + starRng.range(0, 0.2));
      colors[i * 3 + 1] = brightness * (0.85 + starRng.range(0, 0.15));
      colors[i * 3 + 2] = brightness;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 2.5,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9
    });
    this.mapStarfield = new THREE.Points(starGeo, starMat);
    ctx.scene.add(this.mapStarfield);

    // Selection marker (ring style like ConquestMode)
    if (!this.selectedMarker) {
      const mGeo = new THREE.RingGeometry(28, 32, 64);
      const mMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
      });
      this.selectedMarker = new THREE.Mesh(mGeo, mMat);
      this.selectedMarker.rotation.x = -Math.PI / 2;
      this.selectedMarker.visible = false;
    }
    ctx.scene.add(this.selectedMarker);

    // Update HUD
    this.updateHud(ctx);
  }

  private createPlanetMesh(planet: PlanetDef, index: number): THREE.Group {
    const group = new THREE.Group();
    const scale = GALAXY_SCALE * 0.18;

    group.position.set(planet.position[0] * scale, 0, planet.position[1] * scale);
    group.userData.planetIndex = index;
    group.userData.planetId = planet.id;

    // Get procedural planet texture (matching ConquestMode)
    const planetTexture = getPlanetTexture(planet.style, planet.id, 256);

    // Planet sphere with textured material (matching ConquestMode style)
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

    // Atmosphere glow (faction-based colors)
    const atmosColor = this.getFactionGlowColor(planet.faction);
    const atmosGeo = new THREE.SphereGeometry(19, 24, 24);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: atmosColor,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    atmosMesh.name = "atmosphere";
    group.add(atmosMesh);

    // Faction ring indicator (matching ConquestMode)
    const ringColor = this.getFactionRingColor(planet.faction);
    const ringGeo = new THREE.RingGeometry(22, 24, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.name = "factionRing";
    group.add(ring);

    // Name label (sprite - matching ConquestMode)
    const label = this.createTextSprite(planet.name.toUpperCase());
    label.position.set(0, 32, 0);
    group.add(label);

    return group;
  }

  private createTextSprite(text: string): THREE.Sprite {
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

  private getFactionRingColor(faction: string): number {
    switch (faction) {
      case "republic": return 0xff6644;  // Rebel orange/red
      case "empire": return 0x4488ff;    // Imperial blue
      default: return 0x888888;          // Neutral gray
    }
  }

  private getFactionGlowColor(faction: string): number {
    switch (faction) {
      case "republic": return 0xff2200;  // Rebel glow
      case "empire": return 0x2266ff;    // Imperial glow
      default: return 0x444444;          // Neutral glow
    }
  }

  private updateHud(ctx: ModeContext, planetDef?: PlanetDef, sys?: SystemDef): void {
    if (!sys) {
      ctx.hud.className = "hud-map";
      ctx.hud.innerText =
        `xwingz – galaxy map\n` +
        `Credits: ${ctx.profile.credits} | Tier: ${ctx.profile.missionTier}\n` +
        `Planets: 10 iconic Star Wars locations\n` +
        `Click planet to select | Enter to fly\n` +
        `1 Yavin | 2/G Ground | 3/C Conquest | 4 Star Destroyer | U upgrades`;
    } else {
      const preview = getMission(sys, ctx.profile.missionTier);
      const planetName = planetDef?.name ?? sys.id;
      const description = planetDef?.description ?? "";

      ctx.hud.innerText =
        `xwingz – galaxy map\n` +
        `Credits: ${ctx.profile.credits} | Tier: ${ctx.profile.missionTier}\n` +
        `Planets: 10 iconic Star Wars locations\n\n` +
        `Selected: ${planetName.toUpperCase()}\n` +
        `${description}\n` +
        `Faction: ${sys.controllingFaction}\n` +
        `Mission: ${preview.title} — ${preview.goalKills} kills, reward ${preview.rewardCredits} CR\n` +
        `Press Enter to fly here`;
    }
  }

  private attachInputHandlers(ctx: ModeContext): void {
    // Keyboard handler
    this.keyHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "1":
          ctx.requestModeChange("flight", { type: "flight", system: YAVIN_DEFENSE_SYSTEM, scenario: "yavin_defense" });
          break;
        case "2":
        case "g":
          ctx.requestModeChange("ground", { type: "ground" });
          break;
        case "3":
        case "c":
          ctx.requestModeChange("conquest", { type: "conquest" });
          break;
        case "4": {
          const coruscant = PLANETS.find(p => p.id === "coruscant");
          if (coruscant) {
            const system = planetToSystem(coruscant);
            ctx.requestModeChange("flight", { type: "flight", system, scenario: "destroy_star_destroyer" });
          }
          break;
        }
        case "Enter":
          if (this.selectedSystem) {
            ctx.requestModeChange("flight", { type: "flight", system: this.selectedSystem, scenario: "sandbox" });
          }
          break;
        case "u":
        case "U":
          // Handled by UpgradesOverlay in main orchestrator
          break;
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    // Pointer move handler
    this.pointerMoveHandler = (ev: PointerEvent) => {
      this.mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("pointermove", this.pointerMoveHandler);

    // Click handler for planet selection
    this.clickHandler = (ev: MouseEvent) => {
      this.mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, ctx.camera);

      // Check each planet group for hits
      for (let i = 0; i < this.planetGroups.length; i++) {
        const group = this.planetGroups[i]!;
        const planetMesh = group.getObjectByName("planet");
        if (!planetMesh) continue;

        const hits = this.raycaster.intersectObject(planetMesh);
        if (hits.length > 0) {
          this.selectedPlanetIndex = i;
          const planetDef = PLANETS[i]!;
          const sys = planetToSystem(planetDef);
          this.selectedSystem = sys;

          // Update selection marker (ring style)
          if (this.selectedMarker) {
            this.selectedMarker.visible = true;
            this.selectedMarker.position.copy(group.position);
            this.selectedMarker.position.y = 1;
          }

          this.updateHud(ctx, planetDef, sys);
          return;
        }
      }
    };
    window.addEventListener("click", this.clickHandler);
  }

  private detachInputHandlers(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.pointerMoveHandler) {
      window.removeEventListener("pointermove", this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.clickHandler) {
      window.removeEventListener("click", this.clickHandler);
      this.clickHandler = null;
    }
  }
}
