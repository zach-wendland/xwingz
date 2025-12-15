/**
 * Mode system infrastructure
 * Defines interfaces for the three game modes: map, flight, ground
 */

import type { IWorld } from "bitecs";
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SystemDef } from "@xwingz/procgen";
import type { Profile } from "../state/ProfileManager";

export type Mode = "map" | "flight" | "ground";

/**
 * Shared context passed to all mode handlers
 */
export interface ModeContext {
  // Core resources
  world: IWorld;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  controls: OrbitControls;

  // UI elements
  hud: HTMLDivElement;
  overlay: HTMLDivElement;

  // Player state (mutable, shared across modes)
  profile: Profile;

  // Mode transition callback
  requestModeChange: (mode: Mode, data?: ModeTransitionData) => void;

  // Save profile
  scheduleSave: () => void;
}

/**
 * Data passed during mode transitions
 */
export type ModeTransitionData =
  | { type: "flight"; system: SystemDef; scenario: "sandbox" | "yavin_defense" }
  | { type: "ground" }
  | { type: "map" };

/**
 * Interface that all mode handlers must implement
 */
export interface ModeHandler {
  /**
   * Called when entering this mode
   * Set up scene, spawn entities, initialize state
   */
  enter(ctx: ModeContext, data?: ModeTransitionData): void;

  /**
   * Called every frame while in this mode
   * Run systems, update meshes, render
   */
  tick(ctx: ModeContext, dt: number): void;

  /**
   * Called when leaving this mode
   * Clean up entities, dispose meshes, reset state
   */
  exit(ctx: ModeContext): void;
}

/**
 * Flight mode specific state (passed via data on transition)
 */
export type FlightScenario = "sandbox" | "yavin_defense";

export interface FlightModeData {
  type: "flight";
  system: SystemDef;
  scenario: FlightScenario;
}

/**
 * Helper to check transition data type
 */
export function isFlightTransition(data?: ModeTransitionData): data is FlightModeData {
  return data?.type === "flight";
}

export function isGroundTransition(data?: ModeTransitionData): data is { type: "ground" } {
  return data?.type === "ground";
}

export function isMapTransition(data?: ModeTransitionData): data is { type: "map" } {
  return data?.type === "map";
}
