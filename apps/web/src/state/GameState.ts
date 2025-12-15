/**
 * GameState - Central game state management
 * Tracks current mode, player entities, and shared state across modes
 */

import type { IWorld } from "bitecs";
import type { SystemDef, MissionDef } from "@xwingz/procgen";
import type { PhysicsWorld } from "@xwingz/physics";
import type { Profile } from "./ProfileManager";

export type Mode = "map" | "flight" | "ground";
export type Scenario = "sandbox" | "yavin_defense";

export type MissionRuntime = {
  def: MissionDef;
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

/**
 * Centralized game state container
 */
export type GameState = {
  // Current game mode
  mode: Mode;

  // Profile data (credits, upgrades, mission tier)
  profile: Profile;

  // ECS world reference
  world: IWorld;

  // Flight mode state
  flight: {
    scenario: Scenario;
    currentSystem: SystemDef | null;
    jumpIndex: number;
    playerDead: boolean;
    respawnTimer: number;
    shipEid: number | null;
    mission: MissionRuntime | null;
    yavin: YavinDefenseState | null;
    targetEids: number[];
    allyEids: number[];
    lockValue: number;
    lockTargetEid: number;
  };

  // Ground mode state
  ground: {
    physicsWorld: PhysicsWorld | null;
    playerSoldierEid: number | null;
    commandPostEids: number[];
    enemyEids: number[];
  };

  // Map mode state
  map: {
    selectedSystem: SystemDef | null;
  };

  // UI state
  ui: {
    upgradesOpen: boolean;
  };
};

/**
 * Create initial game state
 */
export function createGameState(world: IWorld, profile: Profile): GameState {
  return {
    mode: "map",
    profile,
    world,

    flight: {
      scenario: "sandbox",
      currentSystem: null,
      jumpIndex: 0,
      playerDead: false,
      respawnTimer: 0,
      shipEid: null,
      mission: null,
      yavin: null,
      targetEids: [],
      allyEids: [],
      lockValue: 0,
      lockTargetEid: -1
    },

    ground: {
      physicsWorld: null,
      playerSoldierEid: null,
      commandPostEids: [],
      enemyEids: []
    },

    map: {
      selectedSystem: null
    },

    ui: {
      upgradesOpen: false
    }
  };
}

/**
 * Reset flight state for entering flight mode
 */
export function resetFlightState(state: GameState): void {
  state.flight.scenario = "sandbox";
  state.flight.jumpIndex = 0;
  state.flight.playerDead = false;
  state.flight.respawnTimer = 0;
  state.flight.mission = null;
  state.flight.yavin = null;
  state.flight.lockValue = 0;
  state.flight.lockTargetEid = -1;
}

/**
 * Reset ground state for entering ground mode
 */
export function resetGroundState(state: GameState): void {
  state.ground.playerSoldierEid = null;
  state.ground.commandPostEids = [];
  state.ground.enemyEids = [];
}
