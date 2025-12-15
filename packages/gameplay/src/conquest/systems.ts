/**
 * Conquest ECS Systems - Real-time galaxy simulation
 *
 * Handles resource generation, fleet movement, battle detection,
 * and auto-resolution for AI factions.
 */

import { defineQuery, hasComponent, addEntity, addComponent, removeEntity, IWorld } from "bitecs";
import {
  ConquestPlanet,
  ConquestFleet,
  GroundForce,
  ConquestState,
  BattlePending,
  CONQUEST_FACTION,
  FLEET_STATE,
  BATTLE_TYPE,
  CONQUEST_PHASE,
  type ConquestFactionId
} from "./components";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

const conquestPlanetQuery = defineQuery([ConquestPlanet]);
const conquestFleetQuery = defineQuery([ConquestFleet]);
const groundForceQuery = defineQuery([GroundForce]);
const conquestStateQuery = defineQuery([ConquestState]);
const battlePendingQuery = defineQuery([BattlePending]);

// ─────────────────────────────────────────────────────────────────────────────
// Seeded RNG for deterministic gameplay
// ─────────────────────────────────────────────────────────────────────────────

let conquestRngState = 12345;

export function setConquestSeed(seed: number): void {
  conquestRngState = seed;
}

function seededRandom(): number {
  conquestRngState = (conquestRngState * 1103515245 + 12345) & 0x7fffffff;
  return conquestRngState / 0x7fffffff;
}

function seededRange(min: number, max: number): number {
  return min + seededRandom() * (max - min);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Generation System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates resources for controlled planets each tick.
 * Resources accumulate and can be spent on fleet/unit production.
 */
export function resourceGenerationSystem(world: IWorld, dt: number): void {
  const stateEids = conquestStateQuery(world);
  if (stateEids.length === 0) return;
  const stateEid = stateEids[0]!;

  const planetEids = conquestPlanetQuery(world);

  for (const eid of planetEids) {
    const controller = ConquestPlanet.controllingFaction[eid] ?? CONQUEST_FACTION.NEUTRAL;
    if (controller === CONQUEST_FACTION.NEUTRAL) continue;

    const rate = ConquestPlanet.resourceRate[eid] ?? 1.0;
    const industry = ConquestPlanet.industryLevel[eid] ?? 0.5;
    const generated = rate * industry * dt;

    // Add to planet's local resources
    ConquestPlanet.resources[eid] = (ConquestPlanet.resources[eid] ?? 0) + generated;

    // Also add to faction's global credits (10% of local generation)
    if (controller === CONQUEST_FACTION.REBEL) {
      ConquestState.rebelCredits[stateEid] = (ConquestState.rebelCredits[stateEid] ?? 0) + generated * 0.1;
    } else if (controller === CONQUEST_FACTION.EMPIRE) {
      ConquestState.empireCredits[stateEid] = (ConquestState.empireCredits[stateEid] ?? 0) + generated * 0.1;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fleet Movement System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moves fleets toward their destinations.
 * Updates movement progress and triggers arrival events.
 */
export function fleetMovementSystem(world: IWorld, dt: number): void {
  const fleetEids = conquestFleetQuery(world);

  for (const eid of fleetEids) {
    const state = ConquestFleet.state[eid] ?? FLEET_STATE.IDLE;
    if (state !== FLEET_STATE.MOVING) continue;

    const destEid = ConquestFleet.destinationPlanetEid[eid] ?? -1;
    if (destEid < 0) {
      ConquestFleet.state[eid] = FLEET_STATE.IDLE;
      continue;
    }

    const travelTime = ConquestFleet.travelTime[eid] ?? 10;
    const progress = ConquestFleet.movementProgress[eid] ?? 0;
    const newProgress = progress + dt / travelTime;

    if (newProgress >= 1) {
      // Fleet arrived
      ConquestFleet.movementProgress[eid] = 0;
      ConquestFleet.currentPlanetEid[eid] = destEid;
      ConquestFleet.destinationPlanetEid[eid] = -1;
      ConquestFleet.state[eid] = FLEET_STATE.IDLE;
    } else {
      ConquestFleet.movementProgress[eid] = newProgress;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Battle Detection System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects when opposing forces occupy the same planet.
 * Creates BattlePending entities for resolution.
 */
export function battleDetectionSystem(world: IWorld): void {
  const planetEids = conquestPlanetQuery(world);
  const fleetEids = conquestFleetQuery(world);

  for (const planetEid of planetEids) {
    // Skip planets already under attack
    if (ConquestPlanet.underAttack[planetEid]) continue;

    // Find all fleets at this planet
    const fleetsHere: { eid: number; faction: ConquestFactionId }[] = [];
    for (const fleetEid of fleetEids) {
      const currentPlanet = ConquestFleet.currentPlanetEid[fleetEid] ?? -1;
      const fleetState = ConquestFleet.state[fleetEid] ?? FLEET_STATE.IDLE;
      if (currentPlanet === planetEid && fleetState !== FLEET_STATE.MOVING) {
        fleetsHere.push({
          eid: fleetEid,
          faction: (ConquestFleet.faction[fleetEid] ?? CONQUEST_FACTION.NEUTRAL) as ConquestFactionId
        });
      }
    }

    // Count opposing factions (avoid allocation)
    let rebelFleetEid = -1;
    let empireFleetEid = -1;
    for (const f of fleetsHere) {
      if (f.faction === CONQUEST_FACTION.REBEL && rebelFleetEid < 0) {
        rebelFleetEid = f.eid;
      } else if (f.faction === CONQUEST_FACTION.EMPIRE && empireFleetEid < 0) {
        empireFleetEid = f.eid;
      }
    }

    if (rebelFleetEid >= 0 && empireFleetEid >= 0) {
      // Space battle detected - create BattlePending entity
      ConquestPlanet.underAttack[planetEid] = 1;
      ConquestPlanet.battlePhase[planetEid] = 1; // Space battle

      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);
      BattlePending.planetEid[battleEid] = planetEid;
      BattlePending.attackerFleetEid[battleEid] = empireFleetEid;
      BattlePending.defenderFleetEid[battleEid] = rebelFleetEid;
      BattlePending.attackerGroundEid[battleEid] = -1;
      BattlePending.defenderGroundEid[battleEid] = -1;
      BattlePending.attackerFaction[battleEid] = CONQUEST_FACTION.EMPIRE;
      BattlePending.defenderFaction[battleEid] = CONQUEST_FACTION.REBEL;
      BattlePending.battleType[battleEid] = BATTLE_TYPE.SPACE;
      BattlePending.playerInvolved[battleEid] = 0;
      BattlePending.autoResolveTimer[battleEid] = 5; // 5 seconds to auto-resolve
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Resolve System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fleet strength calculation for combat resolution.
 */
function calculateFleetStrength(world: IWorld, fleetEid: number): number {
  const fighters = ConquestFleet.fighterSquadrons[fleetEid] ?? 0;
  const capitals = ConquestFleet.capitalShips[fleetEid] ?? 0;
  const bombers = ConquestFleet.bomberSquadrons[fleetEid] ?? 0;
  const veterancy = ConquestFleet.veterancy[fleetEid] ?? 0.5;

  const baseStrength = fighters * 10 + capitals * 50 + bombers * 15;
  return baseStrength * (0.8 + veterancy * 0.4);
}

/**
 * Ground force strength calculation.
 */
function calculateGroundStrength(world: IWorld, forceEid: number): number {
  const infantry = GroundForce.infantryPlatoons[forceEid] ?? 0;
  const vehicles = GroundForce.vehicleSquadrons[forceEid] ?? 0;
  const artillery = GroundForce.artilleryUnits[forceEid] ?? 0;
  const veterancy = GroundForce.veterancy[forceEid] ?? 0.5;

  const baseStrength = infantry * 5 + vehicles * 20 + artillery * 15;
  return baseStrength * (0.8 + veterancy * 0.4);
}

/**
 * Auto-resolves battles when player is not present.
 * Simple strength comparison with variance.
 */
export function autoResolveBattleSystem(world: IWorld, dt: number): void {
  const battleEids = battlePendingQuery(world);

  for (const battleEid of battleEids) {
    const playerInvolved = BattlePending.playerInvolved[battleEid] ?? 0;
    if (playerInvolved) continue; // Player fights manually

    let timer = BattlePending.autoResolveTimer[battleEid] ?? 5;
    timer -= dt;

    if (timer <= 0) {
      // Resolve battle
      const attackerFleetEid = BattlePending.attackerFleetEid[battleEid] ?? -1;
      const defenderFleetEid = BattlePending.defenderFleetEid[battleEid] ?? -1;
      const planetEid = BattlePending.planetEid[battleEid] ?? -1;

      let attackerStrength = 0;
      let defenderStrength = 0;

      if (attackerFleetEid >= 0) {
        attackerStrength += calculateFleetStrength(world, attackerFleetEid);
      }
      if (defenderFleetEid >= 0) {
        defenderStrength += calculateFleetStrength(world, defenderFleetEid);
      }

      // Add planetary defense bonus
      if (planetEid >= 0) {
        const defenseBonus = ConquestPlanet.defenseBonus[planetEid] ?? 0;
        defenderStrength *= 1 + defenseBonus;
      }

      // Roll with variance (0.7 to 1.3 multiplier)
      const roll = seededRange(0.7, 1.3);
      const attackerEffective = attackerStrength * roll;

      // Determine winner and apply losses
      if (attackerEffective > defenderStrength) {
        // Attacker wins
        const lossRatio = Math.min(0.8, defenderStrength / attackerEffective);
        if (attackerFleetEid >= 0) {
          applyFleetLosses(world, attackerFleetEid, lossRatio * 0.5);
        }
        if (defenderFleetEid >= 0) {
          applyFleetLosses(world, defenderFleetEid, 0.8);
        }
        // Transfer planet control
        if (planetEid >= 0 && attackerFleetEid >= 0) {
          const attackerFaction = ConquestFleet.faction[attackerFleetEid] ?? CONQUEST_FACTION.NEUTRAL;
          ConquestPlanet.spaceControl[planetEid] = attackerFaction;
        }
      } else {
        // Defender wins
        const lossRatio = Math.min(0.8, attackerStrength / defenderStrength);
        if (defenderFleetEid >= 0) {
          applyFleetLosses(world, defenderFleetEid, lossRatio * 0.5);
        }
        if (attackerFleetEid >= 0) {
          applyFleetLosses(world, attackerFleetEid, 0.7);
          // Force retreat
          ConquestFleet.state[attackerFleetEid] = FLEET_STATE.RETREATING;
        }
      }

      // Clear battle state
      if (planetEid >= 0) {
        ConquestPlanet.underAttack[planetEid] = 0;
        ConquestPlanet.battlePhase[planetEid] = 0;
      }

      // Remove resolved battle entity
      removeEntity(world, battleEid);
    } else {
      BattlePending.autoResolveTimer[battleEid] = timer;
    }
  }
}

function applyFleetLosses(world: IWorld, fleetEid: number, lossPercent: number): void {
  const fighters = ConquestFleet.fighterSquadrons[fleetEid] ?? 0;
  const capitals = ConquestFleet.capitalShips[fleetEid] ?? 0;
  const bombers = ConquestFleet.bomberSquadrons[fleetEid] ?? 0;

  ConquestFleet.fighterSquadrons[fleetEid] = Math.max(0, Math.round(fighters * (1 - lossPercent)));
  ConquestFleet.capitalShips[fleetEid] = Math.max(0, Math.round(capitals * (1 - lossPercent * 0.5)));
  ConquestFleet.bomberSquadrons[fleetEid] = Math.max(0, Math.round(bombers * (1 - lossPercent)));

  // Increase veterancy for survivors
  const currentVet = ConquestFleet.veterancy[fleetEid] ?? 0.5;
  ConquestFleet.veterancy[fleetEid] = Math.min(1, currentVet + 0.05);
}

// ─────────────────────────────────────────────────────────────────────────────
// Victory Condition System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks for victory conditions.
 */
export function victoryConditionSystem(world: IWorld): void {
  const stateEids = conquestStateQuery(world);
  if (stateEids.length === 0) return;
  const stateEid = stateEids[0]!;

  const phase = ConquestState.phase[stateEid] ?? CONQUEST_PHASE.PLAYING;
  if (phase !== CONQUEST_PHASE.PLAYING) return;

  const planetEids = conquestPlanetQuery(world);

  let rebelPlanets = 0;
  let empirePlanets = 0;

  for (const eid of planetEids) {
    const controller = ConquestPlanet.controllingFaction[eid] ?? CONQUEST_FACTION.NEUTRAL;
    if (controller === CONQUEST_FACTION.REBEL) rebelPlanets++;
    else if (controller === CONQUEST_FACTION.EMPIRE) empirePlanets++;
  }

  ConquestState.rebelPlanets[stateEid] = rebelPlanets;
  ConquestState.empirePlanets[stateEid] = empirePlanets;

  const totalPlanets = planetEids.length;
  const victoryThreshold = Math.ceil(totalPlanets * 0.75); // 75% control = victory

  if (rebelPlanets >= victoryThreshold) {
    ConquestState.phase[stateEid] = CONQUEST_PHASE.REBEL_VICTORY;
  } else if (empirePlanets >= victoryThreshold) {
    ConquestState.phase[stateEid] = CONQUEST_PHASE.EMPIRE_VICTORY;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Garrison Reinforcement System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slowly reinforces garrison at controlled planets.
 */
export function garrisonReinforcementSystem(world: IWorld, dt: number): void {
  const planetEids = conquestPlanetQuery(world);

  for (const eid of planetEids) {
    const controller = ConquestPlanet.controllingFaction[eid] ?? CONQUEST_FACTION.NEUTRAL;
    if (controller === CONQUEST_FACTION.NEUTRAL) continue;
    if (ConquestPlanet.underAttack[eid]) continue;

    const garrison = ConquestPlanet.garrison[eid] ?? 0;
    const maxGarrison = ConquestPlanet.maxGarrison[eid] ?? 100;
    const industry = ConquestPlanet.industryLevel[eid] ?? 0.5;

    if (garrison < maxGarrison) {
      const reinforceRate = 0.5 * industry; // troops per second
      ConquestPlanet.garrison[eid] = Math.min(maxGarrison, garrison + reinforceRate * dt);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Conquest Tick
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs all conquest systems in order.
 * Called from the game's main loop when in conquest mode.
 */
export function conquestTick(world: IWorld, dt: number): void {
  const stateEids = conquestStateQuery(world);
  if (stateEids.length === 0) return;
  const stateEid = stateEids[0]!;

  // Update game time
  ConquestState.gameTime[stateEid] = (ConquestState.gameTime[stateEid] ?? 0) + dt;

  // Run systems
  resourceGenerationSystem(world, dt);
  fleetMovementSystem(world, dt);
  battleDetectionSystem(world);
  autoResolveBattleSystem(world, dt);
  garrisonReinforcementSystem(world, dt);
  victoryConditionSystem(world);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orders a fleet to move to a destination planet.
 */
export function orderFleetMove(
  world: IWorld,
  fleetEid: number,
  destinationPlanetEid: number,
  travelTime: number
): void {
  ConquestFleet.destinationPlanetEid[fleetEid] = destinationPlanetEid;
  ConquestFleet.travelTime[fleetEid] = travelTime;
  ConquestFleet.movementProgress[fleetEid] = 0;
  ConquestFleet.state[fleetEid] = FLEET_STATE.MOVING;
}

/**
 * Gets all planets controlled by a faction.
 */
export function getPlanetsControlledBy(world: IWorld, faction: ConquestFactionId): number[] {
  const planetEids = conquestPlanetQuery(world);
  return planetEids.filter((eid) => ConquestPlanet.controllingFaction[eid] === faction);
}

/**
 * Gets all fleets belonging to a faction.
 */
export function getFleetsOfFaction(world: IWorld, faction: ConquestFactionId): number[] {
  const fleetEids = conquestFleetQuery(world);
  return fleetEids.filter((eid) => ConquestFleet.faction[eid] === faction);
}

/**
 * Gets the player fleet entity (if any).
 */
export function getPlayerFleet(world: IWorld): number | null {
  const fleetEids = conquestFleetQuery(world);
  for (const eid of fleetEids) {
    if (ConquestFleet.isPlayerFleet[eid]) return eid;
  }
  return null;
}

/**
 * Gets the conquest game state entity.
 */
export function getConquestState(world: IWorld): number | null {
  const stateEids = conquestStateQuery(world);
  return stateEids.length > 0 ? stateEids[0]! : null;
}
