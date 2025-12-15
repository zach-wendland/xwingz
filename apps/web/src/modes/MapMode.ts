/**
 * MapMode - Galaxy map for planet selection
 */

import * as THREE from "three";
import { createRng, deriveSeed, getMission, type SystemDef } from "@xwingz/procgen";
import { PLANETS, planetToSystem, type PlanetDef } from "@xwingz/data";
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
// Planet Styles
// ─────────────────────────────────────────────────────────────────────────────

type PlanetStyleId = "desert" | "ice" | "jungle" | "ocean" | "volcanic" | "city" | "gas" | "barren" | "mystic";
type PlanetStyle = { id: PlanetStyleId; base: number; atmos: number; roughness: number; emissive?: number };

const PLANET_STYLES: PlanetStyle[] = [
  { id: "desert", base: 0xe8c080, atmos: 0xffd19a, roughness: 0.85, emissive: 0x1a1408 },
  { id: "ice", base: 0xc8e0ff, atmos: 0xcfe6ff, roughness: 0.8, emissive: 0x101820 },
  { id: "jungle", base: 0x4a9860, atmos: 0x7cffc0, roughness: 0.88, emissive: 0x0a1a0c },
  { id: "ocean", base: 0x3070d0, atmos: 0x66aaff, roughness: 0.65, emissive: 0x081020 },
  { id: "volcanic", base: 0x6b3830, atmos: 0xff7744, roughness: 0.85, emissive: 0x301008 },
  { id: "city", base: 0x8898a8, atmos: 0xaad4ff, roughness: 0.55, emissive: 0x181820 },
  { id: "gas", base: 0xa080e0, atmos: 0xd2b7ff, roughness: 0.5, emissive: 0x180828 },
  { id: "barren", base: 0x8a7868, atmos: 0xb9b9b9, roughness: 0.9, emissive: 0x0c0a08 },
  { id: "mystic", base: 0x6040a0, atmos: 0xad5aff, roughness: 0.6, emissive: 0x180830 }
];

function pickPlanetStyle(sys: SystemDef): PlanetStyle {
  const styleId = sys.archetypeId as PlanetStyleId;
  const fromStyle = PLANET_STYLES.find((s) => s.id === styleId);
  if (fromStyle) return fromStyle;

  if (sys.id === "yavin_4") return PLANET_STYLES.find((s) => s.id === "jungle")!;
  const tags = new Set(sys.tags ?? []);
  if (tags.has("jungle")) return PLANET_STYLES.find((s) => s.id === "jungle")!;
  if (tags.has("haunted") || tags.has("anomaly")) return PLANET_STYLES.find((s) => s.id === "mystic")!;
  if (sys.starClass === "black_hole" || sys.starClass === "neutron") return PLANET_STYLES.find((s) => s.id === "mystic")!;
  if (sys.controllingFaction === "empire") return PLANET_STYLES.find((s) => s.id === "city")!;

  const rng = createRng(deriveSeed(sys.seed, "map_planet_style"));
  const table: PlanetStyleId[] = ["desert", "ice", "jungle", "ocean", "volcanic", "barren", "gas"];
  const pick = table[Math.floor(rng.range(0, table.length))] ?? "barren";
  return PLANET_STYLES.find((s) => s.id === pick)!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map Mode State
// ─────────────────────────────────────────────────────────────────────────────

export class MapMode implements ModeHandler {
  // Three.js objects
  private systemsPlanets: THREE.InstancedMesh | null = null;
  private systemsAtmos: THREE.InstancedMesh | null = null;
  private mapStarfield: THREE.Points | null = null;
  private selectedMarker: THREE.Mesh | null = null;

  // Selection state
  private selectedSystem: SystemDef | null = null;

  // Input helpers
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private tmpMapMat = new THREE.Matrix4();

  // Textures
  private mapPlanetNoise: THREE.CanvasTexture | null = null;

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

    // Cleanup Three.js objects
    if (this.mapStarfield) {
      ctx.scene.remove(this.mapStarfield);
      this.mapStarfield.geometry.dispose();
      (this.mapStarfield.material as THREE.Material).dispose();
      this.mapStarfield = null;
    }
    if (this.systemsPlanets) {
      ctx.scene.remove(this.systemsPlanets);
      this.systemsPlanets.geometry.dispose();
      (this.systemsPlanets.material as THREE.Material).dispose();
      this.systemsPlanets = null;
    }
    if (this.systemsAtmos) {
      ctx.scene.remove(this.systemsAtmos);
      this.systemsAtmos.geometry.dispose();
      (this.systemsAtmos.material as THREE.Material).dispose();
      this.systemsAtmos = null;
    }
    if (this.selectedMarker) {
      ctx.scene.remove(this.selectedMarker);
      disposeObject(this.selectedMarker);
      this.selectedMarker = null;
    }

    this.selectedSystem = null;
  }

  private buildGalaxy(ctx: ModeContext): void {
    // Create planet noise texture if needed
    if (!this.mapPlanetNoise) {
      this.mapPlanetNoise = this.createMapNoiseTexture(deriveSeed(GLOBAL_SEED, "map_planet_noise_v0"));
    }

    const systems = PLANETS.map(planetToSystem);

    // Build planet meshes
    const planetGeo = new THREE.SphereGeometry(1, 32, 32);
    const atmosGeo = new THREE.SphereGeometry(1.12, 24, 24);

    const planetMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.05,
      emissive: 0x111111,
      emissiveIntensity: 0.3,
      bumpMap: this.mapPlanetNoise,
      bumpScale: 0.4,
      roughnessMap: this.mapPlanetNoise
    });

    const atmosMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });

    this.systemsPlanets = new THREE.InstancedMesh(planetGeo, planetMat, systems.length);
    this.systemsAtmos = new THREE.InstancedMesh(atmosGeo, atmosMat, systems.length);

    const radii: number[] = new Array(systems.length);
    const tmpPos = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    const tmpS = new THREE.Vector3();
    const tmpColor = new THREE.Color();

    systems.forEach((sys, idx) => {
      tmpPos.set(
        sys.galaxyPos[0] * GALAXY_SCALE,
        sys.galaxyPos[1] * GALAXY_SCALE,
        sys.galaxyPos[2] * GALAXY_SCALE
      );

      const rng = createRng(deriveSeed(sys.seed, "map_planet_v0"));
      const style = pickPlanetStyle(sys);
      const r = sys.id === "yavin_4" ? 22 : rng.range(10, 20);
      radii[idx] = r;

      tmpQ.identity();
      tmpS.setScalar(r);
      this.tmpMapMat.compose(tmpPos, tmpQ, tmpS);
      this.systemsPlanets!.setMatrixAt(idx, this.tmpMapMat);

      tmpS.setScalar(r * 1.08);
      this.tmpMapMat.compose(tmpPos, tmpQ, tmpS);
      this.systemsAtmos!.setMatrixAt(idx, this.tmpMapMat);

      tmpColor.setHex(style.base);
      tmpColor.offsetHSL(rng.range(-0.03, 0.03), rng.range(-0.06, 0.06), rng.range(-0.08, 0.08));
      this.systemsPlanets!.setColorAt(idx, tmpColor);

      tmpColor.setHex(style.atmos);
      tmpColor.offsetHSL(rng.range(-0.04, 0.04), rng.range(-0.08, 0.08), rng.range(-0.08, 0.1));
      this.systemsAtmos!.setColorAt(idx, tmpColor);
    });

    this.systemsPlanets.instanceMatrix.needsUpdate = true;
    this.systemsAtmos.instanceMatrix.needsUpdate = true;
    if (this.systemsPlanets.instanceColor) this.systemsPlanets.instanceColor.needsUpdate = true;
    if (this.systemsAtmos.instanceColor) this.systemsAtmos.instanceColor.needsUpdate = true;

    this.systemsPlanets.userData.systems = systems;
    this.systemsPlanets.userData.radii = radii;
    this.systemsAtmos.userData.systems = systems;
    this.systemsAtmos.userData.radii = radii;

    // Backdrop starfield
    const starRng = createRng(deriveSeed(GLOBAL_SEED, "map_starfield_v0"));
    const count = 2600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2200 + starRng.range(0, 9800);
      const theta = starRng.range(0, Math.PI * 2);
      const phi = Math.acos(starRng.range(-1, 1));
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x9ab7ff,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85
    });
    this.mapStarfield = new THREE.Points(starGeo, starMat);
    ctx.scene.add(this.mapStarfield);

    ctx.scene.add(this.systemsAtmos);
    ctx.scene.add(this.systemsPlanets);

    // Selection marker
    if (!this.selectedMarker) {
      const mGeo = new THREE.SphereGeometry(1, 14, 14);
      const mMat = new THREE.MeshBasicMaterial({
        color: 0x7cff7c,
        wireframe: true,
        transparent: true,
        opacity: 0.85
      });
      this.selectedMarker = new THREE.Mesh(mGeo, mMat);
      this.selectedMarker.visible = false;
    }
    ctx.scene.add(this.selectedMarker);

    // Update HUD
    this.updateHud(ctx);
  }

  private createMapNoiseTexture(seed: bigint): THREE.CanvasTexture {
    const w = 256;
    const h = 128;
    const smallW = 64;
    const smallH = 32;
    const rng = createRng(seed);

    const small = document.createElement("canvas");
    small.width = smallW;
    small.height = smallH;
    const sctx = small.getContext("2d");
    if (!sctx) throw new Error("noise ctx missing");

    const img = sctx.createImageData(smallW, smallH);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(255 * (0.45 + rng.range(-0.25, 0.25)));
      img.data[i + 0] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cctx = c.getContext("2d");
    if (!cctx) throw new Error("noise ctx missing");
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(small, 0, 0, w, h);

    cctx.globalCompositeOperation = "overlay";
    for (let i = 0; i < 6; i++) {
      const y = rng.range(0, h);
      const bandH = rng.range(10, 28);
      cctx.fillStyle = `rgba(255,255,255,${rng.range(0.05, 0.12)})`;
      cctx.fillRect(0, y, w, bandH);
    }
    cctx.globalCompositeOperation = "source-over";

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(2, 1);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  private updateHud(ctx: ModeContext, planetDef?: PlanetDef, sys?: SystemDef): void {
    if (!sys) {
      ctx.hud.className = "hud-map";
      ctx.hud.innerText =
        `xwingz – galaxy map\n` +
        `Credits: ${ctx.profile.credits} | Tier: ${ctx.profile.missionTier}\n` +
        `Planets: 10 iconic Star Wars locations\n` +
        `Click planet to select | Enter to fly\n` +
        `1 Yavin mission | 2/G Ground | 3/C Conquest | U upgrades`;
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
      if (!this.systemsPlanets) return;

      this.mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, ctx.camera);

      const hits = this.raycaster.intersectObject(this.systemsPlanets);
      if (hits.length === 0) return;

      const hit = hits[0];
      const idx = hit.instanceId ?? -1;
      const systems = this.systemsPlanets.userData.systems as SystemDef[];
      const sys = systems[idx];
      if (!sys) return;

      this.selectedSystem = sys;
      const planetDef = PLANETS.find(p => p.id === sys.id);

      if (this.selectedMarker) {
        this.selectedMarker.visible = true;
        this.selectedMarker.position.set(
          sys.galaxyPos[0] * GALAXY_SCALE,
          sys.galaxyPos[1] * GALAXY_SCALE,
          sys.galaxyPos[2] * GALAXY_SCALE
        );
        const radii = this.systemsPlanets.userData.radii as number[] | undefined;
        const r = radii?.[idx] ?? 14;
        this.selectedMarker.scale.setScalar(r * 1.25);
      }

      this.updateHud(ctx, planetDef, sys);
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
