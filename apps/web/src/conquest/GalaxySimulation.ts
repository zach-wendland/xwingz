/**
 * GalaxySimulation - Real-time galaxy management wrapper
 *
 * Initializes the conquest galaxy from PLANETS data,
 * manages AI factions, and provides query interface for UI.
 */

import { addEntity, addComponent, removeEntity, type IWorld } from "bitecs";
import { PLANETS, type PlanetDef } from "@xwingz/data";
import {
  ConquestPlanet,
  ConquestFleet,
  ConquestState,
  CONQUEST_FACTION,
  FLEET_STATE,
  CONQUEST_PHASE,
  conquestTick,
  setConquestSeed,
  getConquestState,
  type ConquestFactionId
} from "@xwingz/gameplay";
import { FactionAI, EMPIRE_AI_CONFIG, REBEL_AI_CONFIG, setAISeed } from "./FactionAI";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GalaxyPlanetState {
  eid: number;
  planetIndex: number;
  planetDef: PlanetDef;
  controller: ConquestFactionId;
  garrison: number;
  resources: number;
  underAttack: boolean;
  spaceControl: ConquestFactionId;
  groundControl: ConquestFactionId;
}

export interface GalaxyFleetState {
  eid: number;
  faction: ConquestFactionId;
  strength: number;
  fighterSquadrons: number;
  capitalShips: number;
  bomberSquadrons: number;
  currentPlanetEid: number;
  destinationPlanetEid: number;
  movementProgress: number;
  isPlayerFleet: boolean;
}

export interface GalaxyOverview {
  gameTime: number;
  phase: number;
  rebelCredits: number;
  empireCredits: number;
  rebelPlanets: number;
  empirePlanets: number;
  neutralPlanets: number;
  playerFaction: ConquestFactionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Galaxy Simulation Class
// ─────────────────────────────────────────────────────────────────────────────

export class GalaxySimulation {
  private world: IWorld;
  private planetEids: number[] = [];
  private fleetEids: number[] = [];
  private stateEid: number = -1;
  private empireAI: FactionAI;
  private rebelAI: FactionAI;
  private initialized = false;
  private playerFaction: ConquestFactionId = CONQUEST_FACTION.REBEL;

  constructor(world: IWorld) {
    this.world = world;
    this.empireAI = new FactionAI(EMPIRE_AI_CONFIG);
    this.rebelAI = new FactionAI(REBEL_AI_CONFIG);
  }

  /**
   * Initialize the galaxy from PLANETS data
   */
  initialize(seed: number = 42, playerFaction: ConquestFactionId = CONQUEST_FACTION.REBEL): void {
    if (this.initialized) return;

    setConquestSeed(seed);
    setAISeed(seed * 2);
    this.playerFaction = playerFaction;

    // Create conquest state singleton
    this.stateEid = addEntity(this.world);
    addComponent(this.world, ConquestState, this.stateEid);
    ConquestState.gameTime[this.stateEid] = 0;
    ConquestState.rebelCredits[this.stateEid] = 1000;
    ConquestState.empireCredits[this.stateEid] = 1500;
    ConquestState.rebelVictoryPoints[this.stateEid] = 0;
    ConquestState.empireVictoryPoints[this.stateEid] = 0;
    ConquestState.victoryThreshold[this.stateEid] = 100;
    ConquestState.phase[this.stateEid] = CONQUEST_PHASE.PLAYING;
    ConquestState.playerFaction[this.stateEid] = playerFaction;

    // Create planets from PLANETS data
    this.planetEids = PLANETS.map((planetDef, index) => {
      const eid = addEntity(this.world);
      addComponent(this.world, ConquestPlanet, eid);

      ConquestPlanet.planetIndex[eid] = index;

      // Determine initial controller based on faction
      let controller: ConquestFactionId;
      switch (planetDef.faction) {
        case "republic":
          controller = CONQUEST_FACTION.REBEL;
          break;
        case "empire":
          controller = CONQUEST_FACTION.EMPIRE;
          break;
        default:
          controller = CONQUEST_FACTION.NEUTRAL;
      }

      ConquestPlanet.controllingFaction[eid] = controller;
      ConquestPlanet.spaceControl[eid] = controller;
      ConquestPlanet.groundControl[eid] = controller;
      ConquestPlanet.garrison[eid] = controller === CONQUEST_FACTION.NEUTRAL ? 20 : 50;
      ConquestPlanet.maxGarrison[eid] = 100;
      ConquestPlanet.resources[eid] = 0;
      ConquestPlanet.resourceRate[eid] = planetDef.economy.wealth * 10;
      ConquestPlanet.industryLevel[eid] = planetDef.economy.industry;
      ConquestPlanet.defenseBonus[eid] = planetDef.economy.security * 0.5;
      ConquestPlanet.underAttack[eid] = 0;
      ConquestPlanet.battlePhase[eid] = 0;

      return eid;
    });

    // Create starting fleets
    this.createStartingFleets();

    this.initialized = true;
  }

  /**
   * Create initial fleets for each faction
   */
  private createStartingFleets(): void {
    // Find Yavin 4 (rebel home) and Coruscant (empire capital)
    const yavinIdx = PLANETS.findIndex((p) => p.id === "yavin_4");
    const coruscantIdx = PLANETS.findIndex((p) => p.id === "coruscant");

    const yavinEid = this.planetEids[yavinIdx] ?? this.planetEids[0]!;
    const coruscantEid = this.planetEids[coruscantIdx] ?? this.planetEids[3]!;

    // Rebel fleet at Yavin
    const rebelFleetEid = addEntity(this.world);
    addComponent(this.world, ConquestFleet, rebelFleetEid);
    ConquestFleet.faction[rebelFleetEid] = CONQUEST_FACTION.REBEL;
    ConquestFleet.fighterSquadrons[rebelFleetEid] = 4;
    ConquestFleet.capitalShips[rebelFleetEid] = 1;
    ConquestFleet.bomberSquadrons[rebelFleetEid] = 2;
    ConquestFleet.currentPlanetEid[rebelFleetEid] = yavinEid;
    ConquestFleet.destinationPlanetEid[rebelFleetEid] = -1;
    ConquestFleet.movementProgress[rebelFleetEid] = 0;
    ConquestFleet.travelTime[rebelFleetEid] = 0;
    ConquestFleet.strength[rebelFleetEid] = 120;
    ConquestFleet.veterancy[rebelFleetEid] = 0.6;
    ConquestFleet.isPlayerFleet[rebelFleetEid] = this.playerFaction === CONQUEST_FACTION.REBEL ? 1 : 0;
    ConquestFleet.state[rebelFleetEid] = FLEET_STATE.IDLE;
    this.fleetEids.push(rebelFleetEid);

    // Empire fleet at Coruscant
    const empireFleetEid = addEntity(this.world);
    addComponent(this.world, ConquestFleet, empireFleetEid);
    ConquestFleet.faction[empireFleetEid] = CONQUEST_FACTION.EMPIRE;
    ConquestFleet.fighterSquadrons[empireFleetEid] = 6;
    ConquestFleet.capitalShips[empireFleetEid] = 2;
    ConquestFleet.bomberSquadrons[empireFleetEid] = 3;
    ConquestFleet.currentPlanetEid[empireFleetEid] = coruscantEid;
    ConquestFleet.destinationPlanetEid[empireFleetEid] = -1;
    ConquestFleet.movementProgress[empireFleetEid] = 0;
    ConquestFleet.travelTime[empireFleetEid] = 0;
    ConquestFleet.strength[empireFleetEid] = 190;
    ConquestFleet.veterancy[empireFleetEid] = 0.5;
    ConquestFleet.isPlayerFleet[empireFleetEid] = this.playerFaction === CONQUEST_FACTION.EMPIRE ? 1 : 0;
    ConquestFleet.state[empireFleetEid] = FLEET_STATE.IDLE;
    this.fleetEids.push(empireFleetEid);

    // Additional AI fleets (with bounds checking)
    if (this.planetEids.length > 7) {
      this.createAIFleet(CONQUEST_FACTION.EMPIRE, this.planetEids[7]!); // Mustafar
    }
    if (this.planetEids.length > 2) {
      this.createAIFleet(CONQUEST_FACTION.REBEL, this.planetEids[2]!); // Hoth
    }
  }

  /**
   * Create an AI-controlled fleet
   */
  private createAIFleet(faction: ConquestFactionId, planetEid: number): void {
    const eid = addEntity(this.world);
    addComponent(this.world, ConquestFleet, eid);

    const isEmpire = faction === CONQUEST_FACTION.EMPIRE;
    ConquestFleet.faction[eid] = faction;
    ConquestFleet.fighterSquadrons[eid] = isEmpire ? 3 : 2;
    ConquestFleet.capitalShips[eid] = isEmpire ? 1 : 0;
    ConquestFleet.bomberSquadrons[eid] = 1;
    ConquestFleet.currentPlanetEid[eid] = planetEid;
    ConquestFleet.destinationPlanetEid[eid] = -1;
    ConquestFleet.movementProgress[eid] = 0;
    ConquestFleet.travelTime[eid] = 0;
    ConquestFleet.strength[eid] = isEmpire ? 95 : 65;
    ConquestFleet.veterancy[eid] = 0.4;
    ConquestFleet.isPlayerFleet[eid] = 0;
    ConquestFleet.state[eid] = FLEET_STATE.IDLE;

    this.fleetEids.push(eid);
  }

  /**
   * Main simulation tick - runs ECS systems and AI
   */
  tick(dt: number): void {
    if (!this.initialized) return;

    // Run conquest ECS systems
    conquestTick(this.world, dt);

    // Run faction AIs (skip player's faction AI if player is active)
    if (this.playerFaction !== CONQUEST_FACTION.EMPIRE) {
      this.empireAI.tick(this.world, dt, this.planetEids);
    }
    if (this.playerFaction !== CONQUEST_FACTION.REBEL) {
      this.rebelAI.tick(this.world, dt, this.planetEids);
    }
  }

  /**
   * Get current state of all planets
   */
  getPlanets(): GalaxyPlanetState[] {
    return this.planetEids
      .map((eid) => {
        const planetIndex = ConquestPlanet.planetIndex[eid] ?? 0;
        const planetDef = PLANETS[planetIndex];
        if (!planetDef) return null; // Skip invalid indices
        return {
          eid,
          planetIndex,
          planetDef,
          controller: (ConquestPlanet.controllingFaction[eid] ?? 0) as ConquestFactionId,
          garrison: ConquestPlanet.garrison[eid] ?? 0,
          resources: ConquestPlanet.resources[eid] ?? 0,
          underAttack: (ConquestPlanet.underAttack[eid] ?? 0) === 1,
          spaceControl: (ConquestPlanet.spaceControl[eid] ?? 0) as ConquestFactionId,
          groundControl: (ConquestPlanet.groundControl[eid] ?? 0) as ConquestFactionId
        };
      })
      .filter((p): p is GalaxyPlanetState => p !== null);
  }

  /**
   * Get current state of all fleets
   */
  getFleets(): GalaxyFleetState[] {
    return this.fleetEids.map((eid) => ({
      eid,
      faction: (ConquestFleet.faction[eid] ?? 0) as ConquestFactionId,
      strength: ConquestFleet.strength[eid] ?? 0,
      fighterSquadrons: ConquestFleet.fighterSquadrons[eid] ?? 0,
      capitalShips: ConquestFleet.capitalShips[eid] ?? 0,
      bomberSquadrons: ConquestFleet.bomberSquadrons[eid] ?? 0,
      currentPlanetEid: ConquestFleet.currentPlanetEid[eid] ?? -1,
      destinationPlanetEid: ConquestFleet.destinationPlanetEid[eid] ?? -1,
      movementProgress: ConquestFleet.movementProgress[eid] ?? 0,
      isPlayerFleet: (ConquestFleet.isPlayerFleet[eid] ?? 0) === 1
    }));
  }

  /**
   * Get galaxy overview statistics
   */
  getOverview(): GalaxyOverview {
    const stateEid = getConquestState(this.world);
    if (stateEid === null) {
      return {
        gameTime: 0,
        phase: CONQUEST_PHASE.SETUP,
        rebelCredits: 0,
        empireCredits: 0,
        rebelPlanets: 0,
        empirePlanets: 0,
        neutralPlanets: PLANETS.length,
        playerFaction: this.playerFaction
      };
    }

    const planets = this.getPlanets();
    let rebelPlanets = 0;
    let empirePlanets = 0;
    let neutralPlanets = 0;

    for (const p of planets) {
      if (p.controller === CONQUEST_FACTION.REBEL) rebelPlanets++;
      else if (p.controller === CONQUEST_FACTION.EMPIRE) empirePlanets++;
      else neutralPlanets++;
    }

    return {
      gameTime: ConquestState.gameTime[stateEid] ?? 0,
      phase: ConquestState.phase[stateEid] ?? CONQUEST_PHASE.PLAYING,
      rebelCredits: ConquestState.rebelCredits[stateEid] ?? 0,
      empireCredits: ConquestState.empireCredits[stateEid] ?? 0,
      rebelPlanets,
      empirePlanets,
      neutralPlanets,
      playerFaction: this.playerFaction
    };
  }

  /**
   * Get player's fleet (if any)
   */
  getPlayerFleet(): GalaxyFleetState | null {
    const fleet = this.getFleets().find((f) => f.isPlayerFleet);
    return fleet ?? null;
  }

  /**
   * Get planet by entity ID
   */
  getPlanetByEid(eid: number): GalaxyPlanetState | null {
    return this.getPlanets().find((p) => p.eid === eid) ?? null;
  }

  /**
   * Get planet by PLANETS array index
   */
  getPlanetByIndex(index: number): GalaxyPlanetState | null {
    const eid = this.planetEids[index];
    if (eid === undefined) return null;
    return this.getPlanetByEid(eid);
  }

  /**
   * Get all planet entity IDs
   */
  getPlanetEids(): number[] {
    return [...this.planetEids];
  }

  /**
   * Check if simulation is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset the simulation - properly cleans up ECS entities
   */
  reset(): void {
    // Remove all entities from ECS to prevent memory leaks
    for (const eid of this.planetEids) {
      removeEntity(this.world, eid);
    }
    for (const eid of this.fleetEids) {
      removeEntity(this.world, eid);
    }
    if (this.stateEid >= 0) {
      removeEntity(this.world, this.stateEid);
    }

    this.initialized = false;
    this.planetEids = [];
    this.fleetEids = [];
    this.stateEid = -1;
    this.empireAI.reset();
    this.rebelAI.reset();
  }
}
