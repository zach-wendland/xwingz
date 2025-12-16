/**
 * Shared types for Flight Mode
 */

import type { MissionDef } from "@xwingz/procgen";

/**
 * HUD element references for flight mode
 */
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

/**
 * Terrain generation parameters for Yavin
 */
export type TerrainParams = {
  a1: number;
  f1: number;
  p1: number;
  a2: number;
  f2: number;
  p2: number;
  yOffset: number;
};

/**
 * Mission runtime state
 */
export type MissionRuntime = {
  def: MissionDef;
  kills: number;
  wave: number;
  completed: boolean;
  message: string;
  messageTimer: number;
};

/**
 * Yavin defense mission state
 */
export type YavinDefenseState = {
  phase: "launch" | "combat" | "success" | "fail";
  baseHpMax: number;
  enemiesTotal: number;
  enemiesKilled: number;
  rewardCredits: number;
  message: string;
  messageTimer: number;
};

/**
 * Star Destroyer mission phase
 */
export type StarDestroyerMissionPhase = "approach" | "shields" | "subsystems" | "final" | "success" | "fail";

/**
 * Star Destroyer mission state
 */
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

/**
 * Screen projection point for HUD elements
 */
export type ScreenPoint = {
  x: number;
  y: number;
  onScreen: boolean;
  behind: boolean
};
