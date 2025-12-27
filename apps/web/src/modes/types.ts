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
 * Position data for seamless transitions
 */
export interface TransitionPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Preserved player state across transitions
 */
export interface PreservedPlayerState {
  health: number;
  maxHealth: number;
  shields?: number;
  maxShields?: number;
}

/**
 * Data passed during mode transitions
 */
export type ModeTransitionData =
  | { type: "flight"; system: SystemDef; scenario: FlightScenario }
  | { type: "ground"; scenario?: GroundScenario }
  | { type: "map" }
  | {
      type: "flight_from_ground";
      system: SystemDef;
      launchPosition: TransitionPosition;
      playerState: PreservedPlayerState;
      planetIndex: number;
    }
  | {
      type: "ground_from_flight";
      landingPosition: TransitionPosition;
      playerState: PreservedPlayerState;
      planetIndex: number;
      system?: SystemDef | null;
    };

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
export type FlightScenario = "sandbox" | "yavin_defense" | "destroy_star_destroyer" | "hoth_speeder";

/**
 * Ground mode specific scenarios
 */
export type GroundScenario = "default" | "hoth_defense";

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

/**
 * Seamless transition type guards
 */
export interface FlightFromGroundData {
  type: "flight_from_ground";
  system: SystemDef;
  launchPosition: TransitionPosition;
  playerState: PreservedPlayerState;
  planetIndex: number;
}

export interface GroundFromFlightData {
  type: "ground_from_flight";
  landingPosition: TransitionPosition;
  playerState: PreservedPlayerState;
  planetIndex: number;
  system?: SystemDef | null; // System to return to on launch
  scenario?: GroundScenario; // Ground scenario to load
}

export function isFlightFromGroundTransition(data?: ModeTransitionData): data is FlightFromGroundData {
  return data?.type === "flight_from_ground";
}

export function isGroundFromFlightTransition(data?: ModeTransitionData): data is GroundFromFlightData {
  return data?.type === "ground_from_flight";
}

/**
 * Check if this is any kind of seamless domain transition
 */
export function isSeamlessTransition(data?: ModeTransitionData): boolean {
  return data?.type === "flight_from_ground" || data?.type === "ground_from_flight";
}
