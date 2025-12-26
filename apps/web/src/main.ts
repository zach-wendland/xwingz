/**
 * xwingz - Star Wars space combat game
 * Main entry point - mode orchestration
 */

import "./style.css";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createGame } from "@xwingz/core";
import { createBasicRenderer } from "@xwingz/render";
import { PLANETS, planetToSystem } from "@xwingz/data";
import { deriveSeed, type SystemDef } from "@xwingz/procgen";

import { loadProfile, saveProfile, scheduleSave, type Profile } from "./state/ProfileManager";
import { MapMode, FlightMode, GroundMode, ConquestMode } from "./modes";
import type { Mode, ModeHandler, ModeContext, ModeTransitionData } from "./modes";
import { CONQUEST_FACTION, CONQUEST_PHASE } from "@xwingz/gameplay";
import { UpgradesOverlay } from "./ui";

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
// Mode Management (Factory Pattern)
// ─────────────────────────────────────────────────────────────────────────────

// Factory functions create fresh mode instances to prevent state leakage
const modeFactories: Record<Mode, () => ModeHandler> = {
  map: () => new MapMode(),
  flight: () => new FlightMode(),
  ground: () => new GroundMode(),
  conquest: () => new ConquestMode()
};

let currentMode: Mode = "map";
let currentHandler: ModeHandler | null = null;

function requestModeChange(newMode: Mode, data?: ModeTransitionData): void {
  // Exit current mode with full cleanup
  if (currentHandler) {
    currentHandler.exit(modeContext);
    currentHandler = null; // Allow GC of old handler
  }

  // Create fresh instance via factory (prevents state leakage)
  currentMode = newMode;
  currentHandler = modeFactories[newMode]();
  currentHandler.enter(modeContext, data);
}

// Getter for current handler (used by E2E hooks)
function getCurrentHandler(): ModeHandler | null {
  return currentHandler;
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
// Upgrades Overlay
// ─────────────────────────────────────────────────────────────────────────────

const upgradesOverlay = new UpgradesOverlay(overlay, profile, {
  onPurchase: () => scheduleSave(profile)
});

// Global 'U' key handler for upgrades overlay (only in map mode)
window.addEventListener("keydown", (e) => {
  if (e.key === "u" || e.key === "U") {
    if (currentMode === "map") {
      upgradesOverlay.toggle();
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// E2E Test Hooks (Development/Test Only)
// ─────────────────────────────────────────────────────────────────────────────

// Only expose test hooks in development or test builds
// In production builds, this entire block is tree-shaken out
if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  const e2eEnabled = (() => {
    try {
      return new URLSearchParams(window.location.search).has("e2e");
    } catch {
      return false;
    }
  })();

  try {
    // Helper to safely get typed handler (factory pattern means handler changes)
    const getFlightHandler = (): FlightMode | null => {
      const handler = getCurrentHandler();
      return currentMode === "flight" && handler ? handler as FlightMode : null;
    };
    const getConquestHandler = (): ConquestMode | null => {
      const handler = getCurrentHandler();
      return currentMode === "conquest" && handler ? handler as ConquestMode : null;
    };

    // Read-only game state getters (dev tools only)
    (window as any).__xwingz = {
      get mode() { return currentMode; },
      get scenario() {
        return getFlightHandler()?.currentScenario ?? null;
      },
      get yavinPhase() {
        return getFlightHandler()?.yavinPhase ?? null;
      },
      get starDestroyerPhase() {
        return getFlightHandler()?.starDestroyerPhase ?? null;
      },
      get capitalShipCount() {
        return getFlightHandler()?.capitalShipCount ?? 0;
      },
      get targetCount() {
        return getFlightHandler()?.targetCount ?? 0;
      },
      get allyCount() {
        return getFlightHandler()?.allyCount ?? 0;
      },
      get projectileCount() {
        return getFlightHandler()?.projectileCount ?? 0;
      },
      get planetCount() { return PLANETS.length; },
      get credits() { return profile.credits; },
      // Expose Yavin system for tests
      get yavinSystem() { return YAVIN_DEFENSE_SYSTEM; },
      // Conquest mode state getters
      get conquestState() {
        const conquest = getConquestHandler();
        return conquest?.simulation?.getOverview() ?? null;
      },
      get conquestPlanets() {
        const conquest = getConquestHandler();
        return conquest?.simulation?.getPlanets() ?? [];
      },
      get conquestFleets() {
        const conquest = getConquestHandler();
        return conquest?.simulation?.getFleets() ?? [];
      },
      get selectedPlanetIndex() {
        return getConquestHandler()?.selectedPlanetIndex ?? -1;
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
      // Quick access to Star Destroyer mission
      enterStarDestroyer() {
        const coruscant = PLANETS.find(p => p.id === "coruscant");
        if (coruscant) {
          const system = planetToSystem(coruscant);
          requestModeChange("flight", { type: "flight", system, scenario: "destroy_star_destroyer" });
        }
      },
      // Conquest test helpers
      CONQUEST_FACTION,
      CONQUEST_PHASE
    };

    // Destructive test actions - only with explicit ?e2e=1 param
    if (e2eEnabled) {
      (window as any).__xwingzTest = {
        godMode(_on = true) {
          // Implementation moved to FlightMode - could add method there
        },
        killAllEnemies() {
          const flight = getFlightHandler();
          if (flight) flight.killAllEnemiesForTest(game.world);
        },
        failBase() {
          const flight = getFlightHandler();
          if (flight) flight.failBaseForTest(game.world);
        },
        destroyStarDestroyer() {
          const flight = getFlightHandler();
          if (flight) flight.destroyStarDestroyerForTest(game.world);
        }
      };
    }
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Game Loop
// ─────────────────────────────────────────────────────────────────────────────

// Enter initial mode via factory
requestModeChange("map", { type: "map" });

// Main tick - uses currentHandler from factory pattern
game.setTick((dt) => {
  if (currentHandler) {
    currentHandler.tick(modeContext, dt);
  }
});

game.start();
