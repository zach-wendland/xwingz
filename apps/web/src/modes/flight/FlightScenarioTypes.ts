/**
 * FlightScenarioTypes - Shared types for flight mode scenarios
 */

import type * as THREE from "three";
import type { SystemDef } from "@xwingz/procgen";
import type { SpaceInputState } from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import type { ExplosionManager } from "../../rendering/effects";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type FlightHudElements = {
  speed: HTMLDivElement;
  throttle: HTMLDivElement;
  shield: HTMLDivElement;
  hp: HTMLDivElement;
  torpedo: HTMLDivElement;
  system: HTMLDivElement;
  faction: HTMLDivElement;
  credits: HTMLDivElement;
  target: HTMLDivElement;
  lock: HTMLDivElement;
  mission: HTMLDivElement;
  bracket: HTMLDivElement;
  lead: HTMLDivElement;
  landPrompt: HTMLDivElement;
  // Capital ship HUD
  capitalPanel: HTMLDivElement;
  capShieldFront: HTMLDivElement;
  capShieldRear: HTMLDivElement;
  capHullFore: HTMLDivElement;
  capHullMid: HTMLDivElement;
  capHullAft: HTMLDivElement;
  capSubsystems: HTMLDivElement;
};

export type TerrainParams = {
  a1: number;
  f1: number;
  p1: number;
  a2: number;
  f2: number;
  p2: number;
  yOffset: number;
};

export type MissionRuntime = {
  def: {
    id: string;
    title: string;
    goalKills: number;
    rewardCredits: number;
  };
  kills: number;
  wave: number;
  completed: boolean;
  message: string;
  messageTimer: number;
};

export type YavinDefenseState = {
  phase: "launch" | "combat" | "success" | "fail";
  baseHpMax: number;
  enemiesTotal: number;
  enemiesKilled: number;
  rewardCredits: number;
  message: string;
  messageTimer: number;
};

export type StarDestroyerMissionPhase = "approach" | "shields" | "subsystems" | "final" | "success" | "fail";

export type StarDestroyerMissionState = {
  phase: StarDestroyerMissionPhase;
  starDestroyerEid: number;
  tieFighterCount: number;
  tieFightersKilled: number;
  subsystemsDestroyed: number;
  totalSubsystems: number;
  shieldsDown: boolean;
  rewardCredits: number;
  message: string;
  messageTimer: number;
};

export type ScreenPoint = { x: number; y: number; onScreen: boolean; behind: boolean };

export type TargetBracketState = { lockValue: number; lockTargetEid: number };

// ─────────────────────────────────────────────────────────────────────────────
// Flight Context - Shared state passed to scenario handlers
// ─────────────────────────────────────────────────────────────────────────────

export interface FlightContext {
  // Core context
  ctx: ModeContext;

  // Current system
  currentSystem: SystemDef | null;

  // Scene objects
  starfield: THREE.Points | null;

  // Player state
  shipEid: number | null;
  shipMesh: THREE.Object3D | null;
  playerDead: boolean;

  // Targets (enemies)
  targetEids: number[];
  targetMeshes: Map<number, THREE.Object3D>;

  // Projectiles
  projectileMeshes: Map<number, THREE.Mesh>;

  // VFX
  explosions: ExplosionManager | null;

  // Input state
  simInput: SpaceInputState;

  // Targeting / lock
  lockValue: number;
  lockTargetEid: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Handler Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for flight scenario handlers.
 * Each scenario (sandbox, yavin_defense, destroy_star_destroyer) implements this.
 */
export interface FlightScenarioHandler {
  /**
   * Initialize the scenario - called when entering flight mode with this scenario
   */
  enter(fctx: FlightContext): void;

  /**
   * Per-frame update - handle scenario-specific logic
   * @returns true if the scenario wants to exit flight mode, false otherwise
   */
  tick(fctx: FlightContext, dt: number): boolean;

  /**
   * Handle hyperspace input - scenarios can block or allow jumps
   * @returns true if hyperspace should be processed, false to block
   */
  handleHyperspace(fctx: FlightContext): boolean;

  /**
   * Update HUD with scenario-specific information
   */
  updateHud(fctx: FlightContext, els: FlightHudElements, dt: number): void;

  /**
   * Get the current mission message for the HUD
   */
  getMissionMessage(fctx: FlightContext): string;

  /**
   * Check if landing is allowed in this scenario
   */
  canLand(fctx: FlightContext): boolean;

  /**
   * Cleanup scenario-specific state
   */
  exit(fctx: FlightContext): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
