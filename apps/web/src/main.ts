/**
 * xwingz - Star Wars space combat game
 * Main entry point - mode orchestration
 */

import "./style.css";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createGame } from "@xwingz/core";
import { createBasicRenderer } from "@xwingz/render";
import { PLANETS } from "@xwingz/data";
import { deriveSeed, type SystemDef } from "@xwingz/procgen";

import { loadProfile, saveProfile, scheduleSave, type Profile } from "./state/ProfileManager";
import { MapMode, FlightMode, GroundMode, ConquestMode } from "./modes";
import type { Mode, ModeHandler, ModeContext, ModeTransitionData } from "./modes";
import { CONQUEST_FACTION, CONQUEST_PHASE } from "@xwingz/gameplay";

// ─────────────────────────────────────────────────────────────────────────────
// DOM Setup
// ─────────────────────────────────────────────────────────────────────────────

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

root.innerHTML = `
  <canvas id="game-canvas"></canvas>
  <div id="hud"></div>
  <div id="overlay" class="overlay hidden"></div>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const hud = document.querySelector<HTMLDivElement>("#hud")!;
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;

// ─────────────────────────────────────────────────────────────────────────────
// Three.js Setup
// ─────────────────────────────────────────────────────────────────────────────

const { renderer, scene, camera } = createBasicRenderer(canvas);
camera.position.set(0, 200, 600);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 50;
controls.maxDistance = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Game State
// ─────────────────────────────────────────────────────────────────────────────

const globalSeed = 42n;
const game = createGame({ globalSeed });
const profile: Profile = loadProfile();

// Yavin defense system definition
const YAVIN_DEFENSE_SYSTEM: SystemDef = {
  id: "yavin_4",
  seed: deriveSeed(globalSeed, "story", "yavin_4"),
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
// Mode Management
// ─────────────────────────────────────────────────────────────────────────────

let currentMode: Mode = "map";
const modeHandlers: Record<Mode, ModeHandler> = {
  map: new MapMode(),
  flight: new FlightMode(),
  ground: new GroundMode(),
  conquest: new ConquestMode()
};

function requestModeChange(newMode: Mode, data?: ModeTransitionData): void {
  // Allow same-mode re-entry when data is provided (for restarts)
  const isSameMode = newMode === currentMode;

  // Exit current mode
  modeHandlers[currentMode].exit(modeContext);

  // Enter new mode (or re-enter same mode for restart)
  currentMode = newMode;
  modeHandlers[currentMode].enter(modeContext, data);

  void isSameMode; // Used for restart logic
}

// Create mode context
const modeContext: ModeContext = {
  world: game.world,
  scene,
  camera,
  renderer,
  canvas,
  controls,
  hud,
  overlay,
  profile,
  requestModeChange,
  scheduleSave: () => scheduleSave(profile)
};

// Save on unload
window.addEventListener("beforeunload", () => saveProfile(profile));

// ─────────────────────────────────────────────────────────────────────────────
// E2E Test Hooks
// ─────────────────────────────────────────────────────────────────────────────

const e2eEnabled = (() => {
  try {
    return new URLSearchParams(window.location.search).has("e2e");
  } catch {
    return false;
  }
})();

try {
  (window as any).__xwingz = {
    get mode() { return currentMode; },
    get scenario() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.currentScenario;
    },
    get yavinPhase() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.yavinPhase;
    },
    get starDestroyerPhase() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.starDestroyerPhase;
    },
    get capitalShipCount() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.capitalShipCount;
    },
    get targetCount() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.targetCount;
    },
    get allyCount() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.allyCount;
    },
    get projectileCount() {
      const flight = modeHandlers.flight as FlightMode;
      return flight.projectileCount;
    },
    get planetCount() { return PLANETS.length; },
    get credits() { return profile.credits; },
    // Expose Yavin system for tests
    get yavinSystem() { return YAVIN_DEFENSE_SYSTEM; },
    // Conquest mode state getters
    get conquestState() {
      const conquest = modeHandlers.conquest as ConquestMode;
      if (currentMode !== "conquest" || !conquest.simulation) return null;
      return conquest.simulation.getOverview();
    },
    get conquestPlanets() {
      const conquest = modeHandlers.conquest as ConquestMode;
      if (currentMode !== "conquest" || !conquest.simulation) return [];
      return conquest.simulation.getPlanets();
    },
    get conquestFleets() {
      const conquest = modeHandlers.conquest as ConquestMode;
      if (currentMode !== "conquest" || !conquest.simulation) return [];
      return conquest.simulation.getFleets();
    },
    get selectedPlanetIndex() {
      const conquest = modeHandlers.conquest as ConquestMode;
      return conquest.selectedPlanetIndex ?? -1;
    },
    // Mode transition helpers for tests
    enterFlight(system: SystemDef, scenario: "sandbox" | "yavin_defense" | "destroy_star_destroyer" = "sandbox") {
      requestModeChange("flight", { type: "flight", system, scenario });
    },
    enterMap() {
      requestModeChange("map", { type: "map" });
    },
    enterGround() {
      requestModeChange("ground", { type: "ground" });
    },
    enterConquest() {
      requestModeChange("conquest", { type: "conquest" });
    },
    // Conquest test helpers
    CONQUEST_FACTION,
    CONQUEST_PHASE
  };

  if (e2eEnabled) {
    (window as any).__xwingzTest = {
      godMode(_on = true) {
        // Implementation moved to FlightMode - could add method there
      },
      killAllEnemies() {
        const flight = modeHandlers.flight as FlightMode;
        flight.killAllEnemiesForTest(game.world);
      },
      failBase() {
        const flight = modeHandlers.flight as FlightMode;
        flight.failBaseForTest(game.world);
      },
      destroyStarDestroyer() {
        const flight = modeHandlers.flight as FlightMode;
        flight.destroyStarDestroyerForTest(game.world);
      }
    };
  }
} catch {
  // ignore
}

// ─────────────────────────────────────────────────────────────────────────────
// Game Loop
// ─────────────────────────────────────────────────────────────────────────────

// Enter initial mode
modeHandlers[currentMode].enter(modeContext, { type: "map" });

// Main tick
game.setTick((dt) => {
  modeHandlers[currentMode].tick(modeContext, dt);
});

game.start();
