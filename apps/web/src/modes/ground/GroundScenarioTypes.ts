/**
 * GroundScenarioTypes - Shared types for ground mode scenarios
 *
 * Pattern mirrors FlightScenarioTypes.ts for consistency.
 */

import type * as THREE from "three";
import type { PhysicsWorld } from "@xwingz/physics";
import type { ModeContext } from "../types";
import type { ExplosionManager } from "../../rendering/effects";

// ─────────────────────────────────────────────────────────────────────────────
// Ground Context - Shared state passed to scenario handlers
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundContext {
  // Core context
  ctx: ModeContext;

  // Physics
  physicsWorld: PhysicsWorld;

  // Player state
  playerEid: number | null;
  playerMesh: THREE.Object3D | null;

  // Entity tracking
  enemyEids: number[];
  enemyMeshes: Map<number, THREE.Object3D>;
  vehicleEids: number[];
  vehicleMeshes: Map<number, THREE.Object3D>;
  commandPostEids: number[];
  commandPostMeshes: THREE.Object3D[];

  // Blaster bolt tracking
  boltMeshes: Map<number, THREE.Mesh>;

  // VFX
  explosions: ExplosionManager | null;

  // Scene objects
  groundMesh: THREE.Mesh | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD Elements
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundHudElements {
  health: HTMLDivElement;
  stamina: HTMLDivElement;
  heat: HTMLDivElement;
  mission: HTMLDivElement;
  objective: HTMLDivElement;
  transports?: HTMLDivElement; // Hoth evacuation progress
  baseIntegrity?: HTMLDivElement; // Shield generator health
  atatCount?: HTMLDivElement; // AT-AT tracker
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission State Types
// ─────────────────────────────────────────────────────────────────────────────

export type HothPhase = "trenches" | "breach" | "speeder" | "evacuation" | "success" | "fail";

export interface HothDefenseState {
  phase: HothPhase;
  transportsEvacuated: number;
  transportsTotal: number;
  baseIntegrity: number;
  baseIntegrityMax: number;
  waveNumber: number;
  enemiesKilledThisWave: number;
  atatCount: number;
  atatTripped: number;
  message: string;
  messageTimer: number;
  rewardCredits: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain Parameters
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundTerrainParams {
  // Height function parameters
  amplitude1: number;
  frequency1: number;
  phase1: number;
  amplitude2: number;
  frequency2: number;
  phase2: number;
  yOffset: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Handler Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for ground scenario handlers.
 * Each scenario (default, hoth_defense) implements this.
 */
export interface GroundScenarioHandler {
  /**
   * Initialize the scenario - called when entering ground mode with this scenario
   */
  enter(gctx: GroundContext): void;

  /**
   * Per-frame update - handle scenario-specific logic
   * @returns true if the scenario wants to exit ground mode, false otherwise
   */
  tick(gctx: GroundContext, dt: number): boolean;

  /**
   * Update HUD with scenario-specific information
   */
  updateHud(gctx: GroundContext, els: GroundHudElements): void;

  /**
   * Get the current mission message for the HUD
   */
  getMissionMessage(): string;

  /**
   * Get mission number for HUD display (e.g., 5 for Hoth)
   */
  getMissionNumber(): number;

  /**
   * Check if player can transition to another mode
   * @returns "speeder" to board snowspeeder, "launch" to return to ship, null if no transition
   */
  canTransition(): "speeder" | "launch" | null;

  /**
   * Handle the speeder boarding transition
   * Called when player boards a snowspeeder
   */
  handleSpeederTransition?(gctx: GroundContext): void;

  /**
   * Cleanup scenario-specific state
   */
  exit(gctx: GroundContext): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SpawnPosition {
  x: number;
  y: number;
  z: number;
}

export interface WaveConfig {
  snowtroopers: number;
  atstCount: number;
  atatCount: number;
  spawnDelay: number; // Seconds between spawns
  spawnPositions: SpawnPosition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
