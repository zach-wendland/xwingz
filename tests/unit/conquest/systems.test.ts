import { createWorld, addEntity, addComponent, hasComponent, removeEntity } from 'bitecs';
import {
  ConquestPlanet,
  ConquestFleet,
  GroundForce,
  ConquestState,
  BattlePending,
  CONQUEST_FACTION,
  FLEET_STATE,
  BATTLE_TYPE,
  CONQUEST_PHASE
} from '../../../packages/gameplay/src/conquest/components';
import {
  resourceGenerationSystem,
  fleetMovementSystem,
  battleDetectionSystem,
  autoResolveBattleSystem,
  victoryConditionSystem,
  garrisonReinforcementSystem,
  conquestTick,
  orderFleetMove,
  getPlanetsControlledBy,
  getFleetsOfFaction,
  getPlayerFleet,
  getConquestState,
  setConquestSeed
} from '../../../packages/gameplay/src/conquest/systems';

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createConquestWorld() {
  return createWorld();
}

function createConquestStateEntity(world: ReturnType<typeof createWorld>, options: {
  phase?: number;
  rebelCredits?: number;
  empireCredits?: number;
  gameTime?: number;
} = {}) {
  const eid = addEntity(world);
  addComponent(world, ConquestState, eid);

  ConquestState.phase[eid] = options.phase ?? CONQUEST_PHASE.PLAYING;
  ConquestState.rebelCredits[eid] = options.rebelCredits ?? 0;
  ConquestState.empireCredits[eid] = options.empireCredits ?? 0;
  ConquestState.gameTime[eid] = options.gameTime ?? 0;
  ConquestState.rebelPlanets[eid] = 0;
  ConquestState.empirePlanets[eid] = 0;

  return eid;
}

function createPlanet(world: ReturnType<typeof createWorld>, options: {
  controllingFaction?: number;
  resourceRate?: number;
  industryLevel?: number;
  resources?: number;
  garrison?: number;
  maxGarrison?: number;
  defenseBonus?: number;
  underAttack?: number;
  battlePhase?: number;
  spaceControl?: number;
} = {}) {
  const eid = addEntity(world);
  addComponent(world, ConquestPlanet, eid);

  ConquestPlanet.controllingFaction[eid] = options.controllingFaction ?? CONQUEST_FACTION.NEUTRAL;
  ConquestPlanet.resourceRate[eid] = options.resourceRate ?? 1.0;
  ConquestPlanet.industryLevel[eid] = options.industryLevel ?? 0.5;
  ConquestPlanet.resources[eid] = options.resources ?? 0;
  ConquestPlanet.garrison[eid] = options.garrison ?? 50;
  ConquestPlanet.maxGarrison[eid] = options.maxGarrison ?? 100;
  ConquestPlanet.defenseBonus[eid] = options.defenseBonus ?? 0;
  ConquestPlanet.underAttack[eid] = options.underAttack ?? 0;
  ConquestPlanet.battlePhase[eid] = options.battlePhase ?? 0;
  ConquestPlanet.spaceControl[eid] = options.spaceControl ?? options.controllingFaction ?? CONQUEST_FACTION.NEUTRAL;

  return eid;
}

function createFleet(world: ReturnType<typeof createWorld>, options: {
  faction?: number;
  currentPlanetEid?: number;
  destinationPlanetEid?: number;
  state?: number;
  movementProgress?: number;
  travelTime?: number;
  fighterSquadrons?: number;
  capitalShips?: number;
  bomberSquadrons?: number;
  veterancy?: number;
  isPlayerFleet?: number;
} = {}) {
  const eid = addEntity(world);
  addComponent(world, ConquestFleet, eid);

  ConquestFleet.faction[eid] = options.faction ?? CONQUEST_FACTION.REBEL;
  ConquestFleet.currentPlanetEid[eid] = options.currentPlanetEid ?? -1;
  ConquestFleet.destinationPlanetEid[eid] = options.destinationPlanetEid ?? -1;
  ConquestFleet.state[eid] = options.state ?? FLEET_STATE.IDLE;
  ConquestFleet.movementProgress[eid] = options.movementProgress ?? 0;
  ConquestFleet.travelTime[eid] = options.travelTime ?? 10;
  ConquestFleet.fighterSquadrons[eid] = options.fighterSquadrons ?? 5;
  ConquestFleet.capitalShips[eid] = options.capitalShips ?? 1;
  ConquestFleet.bomberSquadrons[eid] = options.bomberSquadrons ?? 2;
  ConquestFleet.veterancy[eid] = options.veterancy ?? 0.5;
  ConquestFleet.isPlayerFleet[eid] = options.isPlayerFleet ?? 0;

  return eid;
}

function createGroundForce(world: ReturnType<typeof createWorld>, options: {
  faction?: number;
  planetEid?: number;
  infantryPlatoons?: number;
  vehicleSquadrons?: number;
  artilleryUnits?: number;
  veterancy?: number;
} = {}) {
  const eid = addEntity(world);
  addComponent(world, GroundForce, eid);

  GroundForce.faction[eid] = options.faction ?? CONQUEST_FACTION.REBEL;
  GroundForce.planetEid[eid] = options.planetEid ?? -1;
  GroundForce.infantryPlatoons[eid] = options.infantryPlatoons ?? 4;
  GroundForce.vehicleSquadrons[eid] = options.vehicleSquadrons ?? 2;
  GroundForce.artilleryUnits[eid] = options.artilleryUnits ?? 1;
  GroundForce.veterancy[eid] = options.veterancy ?? 0.5;

  return eid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Conquest Systems', () => {
  beforeEach(() => {
    // Reset the seeded RNG to a known state for deterministic tests
    setConquestSeed(12345);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Resource Generation System
  // ─────────────────────────────────────────────────────────────────────────

  describe('resourceGenerationSystem', () => {
    it('should not generate resources without conquest state entity', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        resourceRate: 1.0,
        industryLevel: 1.0
      });

      resourceGenerationSystem(world, 1.0);

      // No state entity, so resources should remain at initial value
      expect(ConquestPlanet.resources[planetEid]).toBe(0);
    });

    it('should not generate resources for neutral planets', () => {
      const world = createConquestWorld();
      createConquestStateEntity(world);
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.NEUTRAL,
        resourceRate: 10.0,
        industryLevel: 1.0
      });

      resourceGenerationSystem(world, 1.0);

      expect(ConquestPlanet.resources[planetEid]).toBe(0);
    });

    it('should generate resources for rebel-controlled planets', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world);
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        resourceRate: 10.0,
        industryLevel: 1.0
      });

      resourceGenerationSystem(world, 1.0);

      // Resources = rate * industry * dt = 10 * 1.0 * 1.0 = 10
      expect(ConquestPlanet.resources[planetEid]).toBeCloseTo(10, 5);
      // Faction credits = 10% of generated = 1.0
      expect(ConquestState.rebelCredits[stateEid]).toBeCloseTo(1.0, 5);
    });

    it('should generate resources for empire-controlled planets', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world);
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.EMPIRE,
        resourceRate: 20.0,
        industryLevel: 0.5
      });

      resourceGenerationSystem(world, 2.0);

      // Resources = rate * industry * dt = 20 * 0.5 * 2.0 = 20
      expect(ConquestPlanet.resources[planetEid]).toBeCloseTo(20, 5);
      // Faction credits = 10% of generated = 2.0
      expect(ConquestState.empireCredits[stateEid]).toBeCloseTo(2.0, 5);
    });

    it('should accumulate resources over multiple ticks', () => {
      const world = createConquestWorld();
      createConquestStateEntity(world);
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        resourceRate: 5.0,
        industryLevel: 1.0
      });

      resourceGenerationSystem(world, 1.0);
      resourceGenerationSystem(world, 1.0);
      resourceGenerationSystem(world, 1.0);

      // 5 resources per tick * 3 ticks = 15
      expect(ConquestPlanet.resources[planetEid]).toBeCloseTo(15, 5);
    });

    it('should scale resources by industry level', () => {
      const world = createConquestWorld();
      createConquestStateEntity(world);
      const highIndustryPlanet = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        resourceRate: 10.0,
        industryLevel: 1.0
      });
      const lowIndustryPlanet = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        resourceRate: 10.0,
        industryLevel: 0.25
      });

      resourceGenerationSystem(world, 1.0);

      expect(ConquestPlanet.resources[highIndustryPlanet]).toBeCloseTo(10, 5);
      expect(ConquestPlanet.resources[lowIndustryPlanet]).toBeCloseTo(2.5, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fleet Movement System
  // ─────────────────────────────────────────────────────────────────────────

  describe('fleetMovementSystem', () => {
    it('should not move idle fleets', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);
      const fleetEid = createFleet(world, {
        state: FLEET_STATE.IDLE,
        currentPlanetEid: planetEid,
        movementProgress: 0
      });

      fleetMovementSystem(world, 1.0);

      expect(ConquestFleet.movementProgress[fleetEid]).toBe(0);
    });

    it('should progress movement for moving fleets', () => {
      const world = createConquestWorld();
      const destPlanetEid = createPlanet(world);
      const fleetEid = createFleet(world, {
        state: FLEET_STATE.MOVING,
        destinationPlanetEid: destPlanetEid,
        travelTime: 10,
        movementProgress: 0
      });

      fleetMovementSystem(world, 1.0);

      // Progress = dt / travelTime = 1.0 / 10 = 0.1
      expect(ConquestFleet.movementProgress[fleetEid]).toBeCloseTo(0.1, 5);
    });

    it('should complete movement when progress reaches 1', () => {
      const world = createConquestWorld();
      const originPlanetEid = createPlanet(world);
      const destPlanetEid = createPlanet(world);
      const fleetEid = createFleet(world, {
        state: FLEET_STATE.MOVING,
        currentPlanetEid: originPlanetEid,
        destinationPlanetEid: destPlanetEid,
        travelTime: 10,
        movementProgress: 0.95
      });

      // 0.95 + 0.1 = 1.05 >= 1, should arrive
      fleetMovementSystem(world, 1.0);

      expect(ConquestFleet.state[fleetEid]).toBe(FLEET_STATE.IDLE);
      expect(ConquestFleet.currentPlanetEid[fleetEid]).toBe(destPlanetEid);
      expect(ConquestFleet.destinationPlanetEid[fleetEid]).toBe(-1);
      expect(ConquestFleet.movementProgress[fleetEid]).toBe(0);
    });

    it('should set fleet to idle if destination is invalid', () => {
      const world = createConquestWorld();
      const fleetEid = createFleet(world, {
        state: FLEET_STATE.MOVING,
        destinationPlanetEid: -1,
        travelTime: 10
      });

      fleetMovementSystem(world, 1.0);

      expect(ConquestFleet.state[fleetEid]).toBe(FLEET_STATE.IDLE);
    });

    it('should handle multiple fleets moving simultaneously', () => {
      const world = createConquestWorld();
      const dest1 = createPlanet(world);
      const dest2 = createPlanet(world);

      const fleet1 = createFleet(world, {
        state: FLEET_STATE.MOVING,
        destinationPlanetEid: dest1,
        travelTime: 10,
        movementProgress: 0
      });
      const fleet2 = createFleet(world, {
        state: FLEET_STATE.MOVING,
        destinationPlanetEid: dest2,
        travelTime: 5,
        movementProgress: 0
      });

      fleetMovementSystem(world, 1.0);

      expect(ConquestFleet.movementProgress[fleet1]).toBeCloseTo(0.1, 5);
      expect(ConquestFleet.movementProgress[fleet2]).toBeCloseTo(0.2, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Battle Detection System
  // ─────────────────────────────────────────────────────────────────────────

  describe('battleDetectionSystem', () => {
    it('should not create battle when only one faction present', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);

      createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });

      battleDetectionSystem(world);

      // No battle should be created
      expect(ConquestPlanet.underAttack[planetEid]).toBe(0);
    });

    it('should create battle when opposing factions at same planet', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);

      createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });
      createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });

      battleDetectionSystem(world);

      expect(ConquestPlanet.underAttack[planetEid]).toBe(1);
      expect(ConquestPlanet.battlePhase[planetEid]).toBe(1); // Space battle
    });

    it('should not create battle for planets already under attack', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world, { underAttack: 1 });

      createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });
      createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });

      // Should not create a second battle
      battleDetectionSystem(world);

      // Planet was already under attack, no additional processing
      expect(ConquestPlanet.underAttack[planetEid]).toBe(1);
    });

    it('should not consider moving fleets for battle detection', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);
      const destPlanetEid = createPlanet(world);

      createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });
      createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        currentPlanetEid: planetEid,
        destinationPlanetEid: destPlanetEid,
        state: FLEET_STATE.MOVING
      });

      battleDetectionSystem(world);

      // Moving fleet should not trigger battle
      expect(ConquestPlanet.underAttack[planetEid]).toBe(0);
    });

    it('should create BattlePending entity with correct factions', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);

      const rebelFleet = createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });
      const empireFleet = createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        currentPlanetEid: planetEid,
        state: FLEET_STATE.IDLE
      });

      battleDetectionSystem(world);

      // Find the BattlePending entity (it was created after our fleets)
      // The battle entity should be the next entity after the fleets
      const battleEid = planetEid + 3; // planet + 2 fleets + battle

      expect(hasComponent(world, BattlePending, battleEid)).toBe(true);
      expect(BattlePending.planetEid[battleEid]).toBe(planetEid);
      expect(BattlePending.attackerFaction[battleEid]).toBe(CONQUEST_FACTION.EMPIRE);
      expect(BattlePending.defenderFaction[battleEid]).toBe(CONQUEST_FACTION.REBEL);
      expect(BattlePending.battleType[battleEid]).toBe(BATTLE_TYPE.SPACE);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-Resolve Battle System
  // ─────────────────────────────────────────────────────────────────────────

  describe('autoResolveBattleSystem', () => {
    it('should not resolve battles involving player', () => {
      const world = createConquestWorld();
      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);

      BattlePending.playerInvolved[battleEid] = 1;
      BattlePending.autoResolveTimer[battleEid] = 0;

      autoResolveBattleSystem(world, 1.0);

      // Battle should still exist
      expect(hasComponent(world, BattlePending, battleEid)).toBe(true);
    });

    it('should decrement auto-resolve timer', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);
      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);

      BattlePending.planetEid[battleEid] = planetEid;
      BattlePending.playerInvolved[battleEid] = 0;
      BattlePending.autoResolveTimer[battleEid] = 5;

      autoResolveBattleSystem(world, 1.0);

      expect(BattlePending.autoResolveTimer[battleEid]).toBeCloseTo(4, 5);
    });

    it('should resolve battle when timer reaches zero', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world);

      const attackerFleet = createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        fighterSquadrons: 10,
        capitalShips: 2,
        bomberSquadrons: 5,
        veterancy: 0.8
      });
      const defenderFleet = createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        fighterSquadrons: 3,
        capitalShips: 0,
        bomberSquadrons: 1,
        veterancy: 0.5
      });

      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);

      BattlePending.planetEid[battleEid] = planetEid;
      BattlePending.attackerFleetEid[battleEid] = attackerFleet;
      BattlePending.defenderFleetEid[battleEid] = defenderFleet;
      BattlePending.playerInvolved[battleEid] = 0;
      BattlePending.autoResolveTimer[battleEid] = 0.5;

      autoResolveBattleSystem(world, 1.0);

      // Battle should be removed after resolution
      expect(hasComponent(world, BattlePending, battleEid)).toBe(false);
      // Planet should no longer be under attack
      expect(ConquestPlanet.underAttack[planetEid]).toBe(0);
    });

    it('should apply losses to fleets after battle', () => {
      const world = createConquestWorld();
      setConquestSeed(42); // Set predictable seed
      const planetEid = createPlanet(world);

      const attackerFleet = createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        fighterSquadrons: 10,
        capitalShips: 2,
        bomberSquadrons: 5,
        veterancy: 0.5
      });
      const defenderFleet = createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        fighterSquadrons: 10,
        capitalShips: 2,
        bomberSquadrons: 5,
        veterancy: 0.5
      });

      const initialAttackerFighters = ConquestFleet.fighterSquadrons[attackerFleet];
      const initialDefenderFighters = ConquestFleet.fighterSquadrons[defenderFleet];

      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);

      BattlePending.planetEid[battleEid] = planetEid;
      BattlePending.attackerFleetEid[battleEid] = attackerFleet;
      BattlePending.defenderFleetEid[battleEid] = defenderFleet;
      BattlePending.playerInvolved[battleEid] = 0;
      BattlePending.autoResolveTimer[battleEid] = 0;

      autoResolveBattleSystem(world, 1.0);

      // At least one fleet should have lost fighters
      const attackerLost = ConquestFleet.fighterSquadrons[attackerFleet] < initialAttackerFighters;
      const defenderLost = ConquestFleet.fighterSquadrons[defenderFleet] < initialDefenderFighters;
      expect(attackerLost || defenderLost).toBe(true);
    });

    it('should increase veterancy for surviving fleet', () => {
      const world = createConquestWorld();
      setConquestSeed(123);
      const planetEid = createPlanet(world);

      const strongFleet = createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        fighterSquadrons: 20,
        capitalShips: 5,
        bomberSquadrons: 10,
        veterancy: 0.5
      });
      const weakFleet = createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        fighterSquadrons: 1,
        capitalShips: 0,
        bomberSquadrons: 0,
        veterancy: 0.5
      });

      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);

      BattlePending.planetEid[battleEid] = planetEid;
      BattlePending.attackerFleetEid[battleEid] = strongFleet;
      BattlePending.defenderFleetEid[battleEid] = weakFleet;
      BattlePending.playerInvolved[battleEid] = 0;
      BattlePending.autoResolveTimer[battleEid] = 0;

      autoResolveBattleSystem(world, 1.0);

      // Winner should have increased veterancy (capped at 1.0)
      expect(ConquestFleet.veterancy[strongFleet]).toBeGreaterThan(0.5);
    });

    it('should apply defense bonus to defender strength', () => {
      const world = createConquestWorld();
      setConquestSeed(999);

      const planetEid = createPlanet(world, { defenseBonus: 0.5 });

      const attackerFleet = createFleet(world, {
        faction: CONQUEST_FACTION.EMPIRE,
        fighterSquadrons: 5,
        capitalShips: 1,
        veterancy: 0.5
      });
      const defenderFleet = createFleet(world, {
        faction: CONQUEST_FACTION.REBEL,
        fighterSquadrons: 5,
        capitalShips: 1,
        veterancy: 0.5
      });

      const battleEid = addEntity(world);
      addComponent(world, BattlePending, battleEid);

      BattlePending.planetEid[battleEid] = planetEid;
      BattlePending.attackerFleetEid[battleEid] = attackerFleet;
      BattlePending.defenderFleetEid[battleEid] = defenderFleet;
      BattlePending.playerInvolved[battleEid] = 0;
      BattlePending.autoResolveTimer[battleEid] = 0;

      // The defense bonus should give the defender an advantage
      autoResolveBattleSystem(world, 1.0);

      // Battle resolved, planet no longer under attack
      expect(ConquestPlanet.underAttack[planetEid]).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Victory Condition System
  // ─────────────────────────────────────────────────────────────────────────

  describe('victoryConditionSystem', () => {
    it('should not check victory without state entity', () => {
      const world = createConquestWorld();
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });

      // Should not throw
      expect(() => victoryConditionSystem(world)).not.toThrow();
    });

    it('should not check victory if not in playing phase', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { phase: CONQUEST_PHASE.SETUP });

      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });

      victoryConditionSystem(world);

      expect(ConquestState.phase[stateEid]).toBe(CONQUEST_PHASE.SETUP);
    });

    it('should declare rebel victory at 75% control', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { phase: CONQUEST_PHASE.PLAYING });

      // 4 planets total, 3 rebel = 75%
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });

      victoryConditionSystem(world);

      expect(ConquestState.phase[stateEid]).toBe(CONQUEST_PHASE.REBEL_VICTORY);
    });

    it('should declare empire victory at 75% control', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { phase: CONQUEST_PHASE.PLAYING });

      // 4 planets total, 3 empire = 75%
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });

      victoryConditionSystem(world);

      expect(ConquestState.phase[stateEid]).toBe(CONQUEST_PHASE.EMPIRE_VICTORY);
    });

    it('should not declare victory below threshold', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { phase: CONQUEST_PHASE.PLAYING });

      // 4 planets, 2 rebel = 50% (below 75%)
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.NEUTRAL });

      victoryConditionSystem(world);

      expect(ConquestState.phase[stateEid]).toBe(CONQUEST_PHASE.PLAYING);
    });

    it('should update planet count tracking', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { phase: CONQUEST_PHASE.PLAYING });

      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.NEUTRAL });

      victoryConditionSystem(world);

      expect(ConquestState.rebelPlanets[stateEid]).toBe(2);
      expect(ConquestState.empirePlanets[stateEid]).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Garrison Reinforcement System
  // ─────────────────────────────────────────────────────────────────────────

  describe('garrisonReinforcementSystem', () => {
    it('should not reinforce neutral planets', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.NEUTRAL,
        garrison: 50,
        maxGarrison: 100,
        industryLevel: 1.0
      });

      garrisonReinforcementSystem(world, 10.0);

      expect(ConquestPlanet.garrison[planetEid]).toBeCloseTo(50, 5);
    });

    it('should not reinforce planets under attack', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        garrison: 50,
        maxGarrison: 100,
        industryLevel: 1.0,
        underAttack: 1
      });

      garrisonReinforcementSystem(world, 10.0);

      expect(ConquestPlanet.garrison[planetEid]).toBeCloseTo(50, 5);
    });

    it('should reinforce controlled planets', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        garrison: 50,
        maxGarrison: 100,
        industryLevel: 1.0
      });

      // Rate = 0.5 * industry = 0.5 * 1.0 = 0.5 per second
      // After 10 seconds: 50 + 5 = 55
      garrisonReinforcementSystem(world, 10.0);

      expect(ConquestPlanet.garrison[planetEid]).toBeCloseTo(55, 5);
    });

    it('should not exceed max garrison', () => {
      const world = createConquestWorld();
      const planetEid = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.EMPIRE,
        garrison: 99,
        maxGarrison: 100,
        industryLevel: 1.0
      });

      garrisonReinforcementSystem(world, 100.0);

      expect(ConquestPlanet.garrison[planetEid]).toBe(100);
    });

    it('should scale reinforcement by industry level', () => {
      const world = createConquestWorld();
      const highIndustry = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        garrison: 50,
        maxGarrison: 100,
        industryLevel: 1.0
      });
      const lowIndustry = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        garrison: 50,
        maxGarrison: 100,
        industryLevel: 0.25
      });

      garrisonReinforcementSystem(world, 10.0);

      // High: 50 + 0.5 * 1.0 * 10 = 55
      // Low: 50 + 0.5 * 0.25 * 10 = 51.25
      expect(ConquestPlanet.garrison[highIndustry]).toBeCloseTo(55, 5);
      expect(ConquestPlanet.garrison[lowIndustry]).toBeCloseTo(51.25, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Conquest Tick (Integration)
  // ─────────────────────────────────────────────────────────────────────────

  describe('conquestTick', () => {
    it('should update game time', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { gameTime: 0 });

      conquestTick(world, 1.5);

      expect(ConquestState.gameTime[stateEid]).toBeCloseTo(1.5, 5);
    });

    it('should do nothing without state entity', () => {
      const world = createConquestWorld();

      // Should not throw
      expect(() => conquestTick(world, 1.0)).not.toThrow();
    });

    it('should run all systems in order', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world, { phase: CONQUEST_PHASE.PLAYING });

      const planet1 = createPlanet(world, {
        controllingFaction: CONQUEST_FACTION.REBEL,
        resourceRate: 10,
        industryLevel: 1.0,
        garrison: 50,
        maxGarrison: 100
      });

      conquestTick(world, 1.0);

      // Resources should be generated
      expect(ConquestPlanet.resources[planet1]).toBeCloseTo(10, 5);
      // Garrison should be reinforced
      expect(ConquestPlanet.garrison[planet1]).toBeGreaterThan(50);
      // Game time should advance
      expect(ConquestState.gameTime[stateEid]).toBeCloseTo(1.0, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Utility Functions
  // ─────────────────────────────────────────────────────────────────────────

  describe('orderFleetMove', () => {
    it('should set fleet to moving state with correct parameters', () => {
      const world = createConquestWorld();
      const originPlanet = createPlanet(world);
      const destPlanet = createPlanet(world);
      const fleetEid = createFleet(world, {
        currentPlanetEid: originPlanet,
        state: FLEET_STATE.IDLE
      });

      orderFleetMove(world, fleetEid, destPlanet, 15);

      expect(ConquestFleet.state[fleetEid]).toBe(FLEET_STATE.MOVING);
      expect(ConquestFleet.destinationPlanetEid[fleetEid]).toBe(destPlanet);
      expect(ConquestFleet.travelTime[fleetEid]).toBe(15);
      expect(ConquestFleet.movementProgress[fleetEid]).toBe(0);
    });
  });

  describe('getPlanetsControlledBy', () => {
    it('should return empty array when no planets exist', () => {
      const world = createConquestWorld();

      const result = getPlanetsControlledBy(world, CONQUEST_FACTION.REBEL);

      expect(result).toEqual([]);
    });

    it('should return planets controlled by specified faction', () => {
      const world = createConquestWorld();

      const rebelPlanet1 = createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      const rebelPlanet2 = createPlanet(world, { controllingFaction: CONQUEST_FACTION.REBEL });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.EMPIRE });
      createPlanet(world, { controllingFaction: CONQUEST_FACTION.NEUTRAL });

      const result = getPlanetsControlledBy(world, CONQUEST_FACTION.REBEL);

      expect(result).toHaveLength(2);
      expect(result).toContain(rebelPlanet1);
      expect(result).toContain(rebelPlanet2);
    });
  });

  describe('getFleetsOfFaction', () => {
    it('should return empty array when no fleets exist', () => {
      const world = createConquestWorld();

      const result = getFleetsOfFaction(world, CONQUEST_FACTION.EMPIRE);

      expect(result).toEqual([]);
    });

    it('should return fleets belonging to specified faction', () => {
      const world = createConquestWorld();

      const empireFleet1 = createFleet(world, { faction: CONQUEST_FACTION.EMPIRE });
      const empireFleet2 = createFleet(world, { faction: CONQUEST_FACTION.EMPIRE });
      createFleet(world, { faction: CONQUEST_FACTION.REBEL });

      const result = getFleetsOfFaction(world, CONQUEST_FACTION.EMPIRE);

      expect(result).toHaveLength(2);
      expect(result).toContain(empireFleet1);
      expect(result).toContain(empireFleet2);
    });
  });

  describe('getPlayerFleet', () => {
    it('should return null when no player fleet exists', () => {
      const world = createConquestWorld();

      createFleet(world, { isPlayerFleet: 0 });

      const result = getPlayerFleet(world);

      expect(result).toBeNull();
    });

    it('should return player fleet entity', () => {
      const world = createConquestWorld();

      createFleet(world, { isPlayerFleet: 0 });
      const playerFleet = createFleet(world, { isPlayerFleet: 1 });
      createFleet(world, { isPlayerFleet: 0 });

      const result = getPlayerFleet(world);

      expect(result).toBe(playerFleet);
    });
  });

  describe('getConquestState', () => {
    it('should return null when no state exists', () => {
      const world = createConquestWorld();

      const result = getConquestState(world);

      expect(result).toBeNull();
    });

    it('should return state entity', () => {
      const world = createConquestWorld();
      const stateEid = createConquestStateEntity(world);

      const result = getConquestState(world);

      expect(result).toBe(stateEid);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Seeded RNG
  // ─────────────────────────────────────────────────────────────────────────

  describe('setConquestSeed', () => {
    it('should produce deterministic battle outcomes with same seed', () => {
      const world1 = createConquestWorld();
      const world2 = createConquestWorld();

      // Create identical scenarios
      const planet1 = createPlanet(world1);
      const attacker1 = createFleet(world1, {
        faction: CONQUEST_FACTION.EMPIRE,
        fighterSquadrons: 8,
        capitalShips: 2,
        veterancy: 0.5
      });
      const defender1 = createFleet(world1, {
        faction: CONQUEST_FACTION.REBEL,
        fighterSquadrons: 8,
        capitalShips: 2,
        veterancy: 0.5
      });

      const planet2 = createPlanet(world2);
      const attacker2 = createFleet(world2, {
        faction: CONQUEST_FACTION.EMPIRE,
        fighterSquadrons: 8,
        capitalShips: 2,
        veterancy: 0.5
      });
      const defender2 = createFleet(world2, {
        faction: CONQUEST_FACTION.REBEL,
        fighterSquadrons: 8,
        capitalShips: 2,
        veterancy: 0.5
      });

      // Create battles
      const battle1 = addEntity(world1);
      addComponent(world1, BattlePending, battle1);
      BattlePending.planetEid[battle1] = planet1;
      BattlePending.attackerFleetEid[battle1] = attacker1;
      BattlePending.defenderFleetEid[battle1] = defender1;
      BattlePending.playerInvolved[battle1] = 0;
      BattlePending.autoResolveTimer[battle1] = 0;

      const battle2 = addEntity(world2);
      addComponent(world2, BattlePending, battle2);
      BattlePending.planetEid[battle2] = planet2;
      BattlePending.attackerFleetEid[battle2] = attacker2;
      BattlePending.defenderFleetEid[battle2] = defender2;
      BattlePending.playerInvolved[battle2] = 0;
      BattlePending.autoResolveTimer[battle2] = 0;

      // Set same seed and resolve
      setConquestSeed(77777);
      autoResolveBattleSystem(world1, 1.0);

      setConquestSeed(77777);
      autoResolveBattleSystem(world2, 1.0);

      // Outcomes should be identical
      expect(ConquestFleet.fighterSquadrons[attacker1]).toBe(ConquestFleet.fighterSquadrons[attacker2]);
      expect(ConquestFleet.fighterSquadrons[defender1]).toBe(ConquestFleet.fighterSquadrons[defender2]);
    });
  });
});
