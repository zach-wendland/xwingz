/**
 * ConquestMode - Real-time galactic conquest strategic view
 *
 * Enhanced graphics with:
 * - Faction-colored planets with glow effects
 * - Hyperspace fleet trails
 * - Battle indicators with particle effects
 * - Dynamic lighting based on galactic state
 */

import * as THREE from "three";
import { PLANETS, planetToSystem } from "@xwingz/data";
import { clearPlanetTextureCache } from "@xwingz/render";
import type { ModeHandler, ModeContext, ModeTransitionData } from "./types";
import { disposeObject } from "../rendering/MeshManager";
import {
  GalaxySimulation,
  type GalaxyPlanetState
} from "../conquest/GalaxySimulation";

// Import extracted modules
import {
  setupConquestLighting,
  buildConquestStarfield,
  buildConquestNebula,
  createConquestPlanetMesh,
  buildSelectionRing,
  updateSelectionRing
} from "./conquest";
import { updateFleetVisuals } from "./conquest/ConquestFleetRenderer";
import { updateBattleIndicators } from "./conquest/ConquestBattleIndicators";
import { updatePlanetVisuals } from "./conquest/ConquestPlanetVisuals";
import { buildConquestHudText } from "./conquest/ConquestHud";

// ─────────────────────────────────────────────────────────────────────────────
// ConquestMode Class
// ─────────────────────────────────────────────────────────────────────────────

export class ConquestMode implements ModeHandler {
  // Galaxy simulation (exposed for testing)
  public simulation: GalaxySimulation | null = null;

  // Three.js objects
  private planetMeshes: THREE.Group[] = [];
  private fleetMeshes: Map<number, THREE.Object3D> = new Map();
  private hyperspaceTrails: Map<number, THREE.Line> = new Map();
  private battleIndicators: Map<number, THREE.Object3D> = new Map();
  private starfield: THREE.Points | null = null;
  private nebula: THREE.Mesh | null = null;
  private selectionRing: THREE.Mesh | null = null;

  // State (exposed for testing)
  public selectedPlanetIndex = -1;
  private hoveredPlanetIndex = -1;
  private gameSpeed = 1.0;
  private paused = false;

  // Input helpers
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Event handlers
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // HUD state cache (for change detection)
  private lastHudState = "";
  private hudUpdateTimer = 0;
  private readonly HUD_UPDATE_INTERVAL = 0.1; // Update HUD every 100ms max

  enter(ctx: ModeContext, _data?: ModeTransitionData): void {
    ctx.controls.enabled = true;

    // Clear scene
    ctx.scene.clear();

    // Setup lighting
    setupConquestLighting(ctx.scene);

    // Setup camera
    ctx.camera.position.set(0, 400, 800);
    ctx.camera.lookAt(0, 0, 0);

    // Initialize simulation
    this.simulation = new GalaxySimulation(ctx.world);
    this.simulation.initialize(42, 0); // CONQUEST_FACTION.REBEL = 0

    // Build visual galaxy
    this.starfield = buildConquestStarfield(ctx.scene);
    this.nebula = buildConquestNebula(ctx.scene);
    this.buildPlanets(ctx.scene);
    this.selectionRing = buildSelectionRing(ctx.scene);

    // Attach input handlers
    this.attachInputHandlers(ctx);

    // Update HUD
    this.updateHud(ctx);
  }

  tick(ctx: ModeContext, dt: number): void {
    if (!this.simulation) return;

    // Run simulation (unless paused)
    if (!this.paused) {
      this.simulation.tick(dt * this.gameSpeed);
    }

    // Update visual state
    updatePlanetVisuals(this.simulation.getPlanets(), this.planetMeshes);
    updateFleetVisuals(
      ctx.scene,
      this.simulation.getFleets(),
      this.simulation.getPlanets(),
      this.fleetMeshes,
      this.hyperspaceTrails
    );
    updateBattleIndicators(ctx.scene, this.simulation.getPlanets(), this.battleIndicators);
    updateSelectionRing(this.selectionRing, this.selectedPlanetIndex, this.planetMeshes);

    // Rotate nebula slowly
    if (this.nebula) {
      this.nebula.rotation.y += dt * 0.02;
    }

    // Update controls and render
    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);

    // Update HUD with rate limiting
    this.hudUpdateTimer += dt;
    if (this.hudUpdateTimer >= this.HUD_UPDATE_INTERVAL) {
      this.hudUpdateTimer = 0;
      this.updateHudIfChanged(ctx);
    }
  }

  exit(ctx: ModeContext): void {
    this.detachInputHandlers();

    // CRITICAL FIX: Clear HUD text and className to prevent persistence
    ctx.hud.innerText = "";
    ctx.hud.className = "";

    // Cleanup meshes (including sprite textures)
    for (const group of this.planetMeshes) {
      group.traverse((child) => {
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
      ctx.scene.remove(group);
      disposeObject(group);
    }
    this.planetMeshes = [];

    for (const mesh of this.fleetMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.fleetMeshes.clear();

    for (const trail of this.hyperspaceTrails.values()) {
      ctx.scene.remove(trail);
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
    }
    this.hyperspaceTrails.clear();

    for (const indicator of this.battleIndicators.values()) {
      ctx.scene.remove(indicator);
      disposeObject(indicator);
    }
    this.battleIndicators.clear();

    if (this.starfield) {
      ctx.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
      this.starfield = null;
    }

    if (this.nebula) {
      ctx.scene.remove(this.nebula);
      disposeObject(this.nebula);
      this.nebula = null;
    }

    if (this.selectionRing) {
      ctx.scene.remove(this.selectionRing);
      disposeObject(this.selectionRing);
      this.selectionRing = null;
    }

    // Reset simulation
    if (this.simulation) {
      this.simulation.reset();
      this.simulation = null;
    }

    // Clear planet texture cache
    clearPlanetTextureCache();

    this.selectedPlanetIndex = -1;
    this.hoveredPlanetIndex = -1;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene Setup
  // ─────────────────────────────────────────────────────────────────────────────

  private buildPlanets(scene: THREE.Scene): void {
    if (!this.simulation) return;

    const planets = this.simulation.getPlanets();

    for (const planet of planets) {
      const group = createConquestPlanetMesh(planet);
      scene.add(group);
      this.planetMeshes.push(group);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private attachInputHandlers(ctx: ModeContext): void {
    this.keyHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          ctx.requestModeChange("map", { type: "map" });
          break;
        case " ":
          this.paused = !this.paused;
          break;
        case "+":
        case "=":
          this.gameSpeed = Math.min(4, this.gameSpeed + 0.5);
          break;
        case "-":
          this.gameSpeed = Math.max(0.25, this.gameSpeed - 0.25);
          break;
        case "Enter":
          this.enterSelectedPlanet(ctx);
          break;
        case "b":
        case "B":
          // Quick battle at Coruscant
          this.startCoruscantBattle(ctx);
          break;
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    this.pointerMoveHandler = (ev: PointerEvent) => {
      this.mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      this.updateHover(ctx);
    };
    window.addEventListener("pointermove", this.pointerMoveHandler);

    this.clickHandler = (_ev: MouseEvent) => {
      if (this.hoveredPlanetIndex >= 0) {
        this.selectedPlanetIndex = this.hoveredPlanetIndex;
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

  private updateHover(ctx: ModeContext): void {
    this.raycaster.setFromCamera(this.mouse, ctx.camera);

    this.hoveredPlanetIndex = -1;
    for (let i = 0; i < this.planetMeshes.length; i++) {
      const group = this.planetMeshes[i]!;
      const planet = group.getObjectByName("planet");
      if (!planet) continue;

      const hits = this.raycaster.intersectObject(planet);
      if (hits.length > 0) {
        this.hoveredPlanetIndex = i;
        break;
      }
    }
  }

  private enterSelectedPlanet(ctx: ModeContext): void {
    if (this.selectedPlanetIndex < 0 || !this.simulation) return;

    const planet = this.simulation.getPlanetByIndex(this.selectedPlanetIndex);
    if (!planet) return;

    const system = planetToSystem(planet.planetDef);

    // If battle is occurring, enter combat
    if (planet.underAttack) {
      ctx.requestModeChange("flight", {
        type: "flight",
        system,
        scenario: "conquest"
      });
    } else {
      // Enter sandbox flight
      ctx.requestModeChange("flight", {
        type: "flight",
        system,
        scenario: "sandbox"
      });
    }
  }

  private startCoruscantBattle(ctx: ModeContext): void {
    // Quick access to Battle of Coruscant proof-of-concept
    const coruscantDef = PLANETS.find((p) => p.id === "coruscant");
    if (!coruscantDef) return;

    const system = planetToSystem(coruscantDef);

    ctx.requestModeChange("flight", {
      type: "flight",
      system,
      scenario: "yavin_defense" // Re-use yavin_defense scenario with Coruscant backdrop
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HUD
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update HUD only if content has changed (avoid DOM thrashing)
   */
  private updateHudIfChanged(ctx: ModeContext): void {
    const hudText = buildConquestHudText(
      this.simulation,
      this.selectedPlanetIndex,
      this.gameSpeed,
      this.paused
    );
    if (hudText !== this.lastHudState) {
      this.lastHudState = hudText;
      ctx.hud.className = "hud-conquest";
      ctx.hud.innerText = hudText;
    }
  }

  /**
   * Force HUD update (for initial render and after user actions)
   */
  private updateHud(ctx: ModeContext): void {
    this.lastHudState = ""; // Force update
    this.updateHudIfChanged(ctx);
  }
}
