/**
 * FactionAI - Strategic AI for Empire and Rebel factions
 *
 * Empire: Aggressive expansion, prioritizes military strength
 * Rebels: Defensive, hit-and-run, prioritizes resource denial
 */

import type { IWorld } from "bitecs";
import {
  ConquestPlanet,
  ConquestFleet,
  CONQUEST_FACTION,
  FLEET_STATE,
  getFleetsOfFaction,
  orderFleetMove,
  type ConquestFactionId
} from "@xwingz/gameplay";

// ─────────────────────────────────────────────────────────────────────────────
// AI Personality Types
// ─────────────────────────────────────────────────────────────────────────────

export type AIPersonality = "aggressive" | "defensive" | "balanced";

export interface FactionAIConfig {
  faction: ConquestFactionId;
  personality: AIPersonality;
  decisionInterval: number; // Seconds between strategic decisions
  aggressiveness: number; // 0-1, how likely to attack vs defend
  expansionPriority: number; // 0-1, preference for taking new planets
  fleetConcentration: number; // 0-1, how much to group fleets together
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configurations
// ─────────────────────────────────────────────────────────────────────────────

export const EMPIRE_AI_CONFIG: FactionAIConfig = {
  faction: CONQUEST_FACTION.EMPIRE,
  personality: "aggressive",
  decisionInterval: 8,
  aggressiveness: 0.75,
  expansionPriority: 0.8,
  fleetConcentration: 0.6
};

export const REBEL_AI_CONFIG: FactionAIConfig = {
  faction: CONQUEST_FACTION.REBEL,
  personality: "defensive",
  decisionInterval: 10,
  aggressiveness: 0.35,
  expansionPriority: 0.5,
  fleetConcentration: 0.4
};

// ─────────────────────────────────────────────────────────────────────────────
// Seeded RNG for deterministic AI
// ─────────────────────────────────────────────────────────────────────────────

// Deprecated - kept for backward compatibility but AIs now use instance-local RNG
let _aiSeedDeprecated = 54321;
export function setAISeed(seed: number): void {
  _aiSeedDeprecated = seed;
  // This is now a no-op - each FactionAI instance manages its own seed
  void _aiSeedDeprecated;
}

// Instance-local RNG class for per-AI determinism
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  random(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  range(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  reset(seed: number): void {
    this.state = seed;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategic Analysis
// ─────────────────────────────────────────────────────────────────────────────

interface PlanetAnalysis {
  eid: number;
  controller: ConquestFactionId;
  garrison: number;
  resources: number;
  industry: number;
  defense: number;
  underAttack: boolean;
  threatLevel: number; // 0-1, how threatened this planet is
  value: number; // 0-1, strategic value
}

interface FleetAnalysis {
  eid: number;
  strength: number;
  currentPlanet: number;
  isMoving: boolean;
  isIdle: boolean;
}

function analyzePlanets(_world: IWorld, planetEids: number[]): PlanetAnalysis[] {
  return planetEids.map((eid) => {
    const controller = (ConquestPlanet.controllingFaction[eid] ?? 0) as ConquestFactionId;
    const garrison = ConquestPlanet.garrison[eid] ?? 0;
    const resources = ConquestPlanet.resources[eid] ?? 0;
    const industry = ConquestPlanet.industryLevel[eid] ?? 0.5;
    const defense = ConquestPlanet.defenseBonus[eid] ?? 0;
    const underAttack = (ConquestPlanet.underAttack[eid] ?? 0) === 1;

    // Calculate threat level based on nearby enemy fleets
    const threatLevel = underAttack ? 1.0 : 0;

    // Strategic value based on resources and industry
    const value = industry * 0.6 + (resources / 1000) * 0.4;

    return {
      eid,
      controller,
      garrison,
      resources,
      industry,
      defense,
      underAttack,
      threatLevel,
      value
    };
  });
}

function analyzeFleets(_world: IWorld, fleetEids: number[]): FleetAnalysis[] {
  return fleetEids.map((eid) => {
    const fighters = ConquestFleet.fighterSquadrons[eid] ?? 0;
    const capitals = ConquestFleet.capitalShips[eid] ?? 0;
    const bombers = ConquestFleet.bomberSquadrons[eid] ?? 0;
    const strength = fighters * 10 + capitals * 50 + bombers * 15;

    const state = ConquestFleet.state[eid] ?? FLEET_STATE.IDLE;
    const currentPlanet = ConquestFleet.currentPlanetEid[eid] ?? -1;

    return {
      eid,
      strength,
      currentPlanet,
      isMoving: state === FLEET_STATE.MOVING,
      isIdle: state === FLEET_STATE.IDLE
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision Making
// ─────────────────────────────────────────────────────────────────────────────

export interface AIDecision {
  type: "attack" | "defend" | "reinforce" | "idle";
  fleetEid: number;
  targetPlanetEid: number;
  priority: number;
}

function findBestAttackTarget(
  _ownPlanets: PlanetAnalysis[],
  enemyPlanets: PlanetAnalysis[],
  neutralPlanets: PlanetAnalysis[],
  config: FactionAIConfig
): PlanetAnalysis | null {
  // Prioritize weak, high-value targets
  const targets = [...enemyPlanets, ...neutralPlanets];

  if (targets.length === 0) return null;

  // Score each target
  const scored = targets.map((p) => {
    let score = p.value;

    // Prefer weaker garrisons
    score += (1 - Math.min(1, p.garrison / 100)) * 0.5;

    // Prefer neutrals for expansion-focused AI
    if (p.controller === CONQUEST_FACTION.NEUTRAL) {
      score += config.expansionPriority * 0.3;
    }

    // Avoid heavily defended planets unless aggressive
    if (p.defense > 0.5) {
      score -= (1 - config.aggressiveness) * 0.4;
    }

    return { planet: p, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.planet ?? null;
}

function findThreatenedPlanet(ownPlanets: PlanetAnalysis[]): PlanetAnalysis | null {
  const threatened = ownPlanets.filter((p) => p.underAttack || p.threatLevel > 0.5);
  if (threatened.length === 0) return null;

  // Return most threatened
  threatened.sort((a, b) => b.threatLevel - a.threatLevel);
  return threatened[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FactionAI Class
// ─────────────────────────────────────────────────────────────────────────────

export class FactionAI {
  private config: FactionAIConfig;
  private decisionTimer = 0;
  private lastDecisions: AIDecision[] = [];
  private rng: SeededRNG;
  private initialSeed: number;

  constructor(config: FactionAIConfig, seed?: number) {
    this.config = config;
    // Use faction-specific seed offset for deterministic but different behavior
    this.initialSeed = (seed ?? 54321) + config.faction * 12345;
    this.rng = new SeededRNG(this.initialSeed);
  }

  get faction(): ConquestFactionId {
    return this.config.faction;
  }

  get personality(): AIPersonality {
    return this.config.personality;
  }

  /**
   * Main AI tick - called every frame
   */
  tick(world: IWorld, dt: number, allPlanetEids: number[]): AIDecision[] {
    this.decisionTimer -= dt;

    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.config.decisionInterval + this.rng.range(-1, 1);
      this.lastDecisions = this.makeDecisions(world, allPlanetEids);
      this.executeDecisions(world, this.lastDecisions);
    }

    return this.lastDecisions;
  }

  /**
   * Generate strategic decisions based on current state
   */
  private makeDecisions(world: IWorld, allPlanetEids: number[]): AIDecision[] {
    const decisions: AIDecision[] = [];

    // Analyze the galaxy
    const allPlanets = analyzePlanets(world, allPlanetEids);
    const ownPlanets = allPlanets.filter((p) => p.controller === this.config.faction);
    const enemyPlanets = allPlanets.filter(
      (p) => p.controller !== CONQUEST_FACTION.NEUTRAL && p.controller !== this.config.faction
    );
    const neutralPlanets = allPlanets.filter((p) => p.controller === CONQUEST_FACTION.NEUTRAL);

    // Get our fleets
    const fleetEids = getFleetsOfFaction(world, this.config.faction);
    const fleets = analyzeFleets(world, fleetEids);
    const idleFleets = fleets.filter((f) => f.isIdle && f.strength > 0);

    if (idleFleets.length === 0) return decisions;

    // Defense-first check
    const threatened = findThreatenedPlanet(ownPlanets);
    if (threatened && this.config.personality !== "aggressive") {
      // Send strongest idle fleet to defend
      const defender = idleFleets.sort((a, b) => b.strength - a.strength)[0];
      if (defender) {
        decisions.push({
          type: "defend",
          fleetEid: defender.eid,
          targetPlanetEid: threatened.eid,
          priority: 0.9
        });
        idleFleets.splice(idleFleets.indexOf(defender), 1);
      }
    }

    // Track targeted planets to avoid pile-on
    const targetedPlanetEids = new Set<number>();

    // Offensive decisions for remaining idle fleets
    for (const fleet of idleFleets) {
      // Roll for attack vs idle
      const attackRoll = this.rng.random();
      if (attackRoll < this.config.aggressiveness) {
        // Filter out already-targeted planets for better fleet distribution
        const availableEnemies = enemyPlanets.filter((p) => !targetedPlanetEids.has(p.eid));
        const availableNeutrals = neutralPlanets.filter((p) => !targetedPlanetEids.has(p.eid));
        const target = findBestAttackTarget(ownPlanets, availableEnemies, availableNeutrals, this.config);
        if (target) {
          targetedPlanetEids.add(target.eid);
          decisions.push({
            type: "attack",
            fleetEid: fleet.eid,
            targetPlanetEid: target.eid,
            priority: 0.7 + target.value * 0.3
          });
        }
      } else {
        // Consider reinforcing weak planets
        const weakPlanet = ownPlanets
          .filter((p) => p.garrison < 50 && !targetedPlanetEids.has(p.eid))
          .sort((a, b) => a.garrison - b.garrison)[0];
        if (weakPlanet) {
          targetedPlanetEids.add(weakPlanet.eid);
          decisions.push({
            type: "reinforce",
            fleetEid: fleet.eid,
            targetPlanetEid: weakPlanet.eid,
            priority: 0.5
          });
        }
      }
    }

    return decisions;
  }

  /**
   * Execute the decisions by issuing fleet orders
   */
  private executeDecisions(world: IWorld, decisions: AIDecision[]): void {
    for (const decision of decisions) {
      if (decision.type === "idle") continue;

      // Calculate travel time based on distance (simplified: fixed time)
      const travelTime = 15 + this.rng.range(-3, 3);

      orderFleetMove(world, decision.fleetEid, decision.targetPlanetEid, travelTime);
    }
  }

  /**
   * Reset the AI state
   */
  reset(): void {
    this.decisionTimer = 0;
    this.lastDecisions = [];
    this.rng.reset(this.initialSeed);
  }

  /**
   * Update the seed (for new game starts)
   */
  setSeed(seed: number): void {
    this.initialSeed = seed + this.config.faction * 12345;
    this.rng.reset(this.initialSeed);
  }
}
