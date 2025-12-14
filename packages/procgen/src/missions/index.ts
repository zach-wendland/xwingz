/**
 * Mission Definitions Index
 *
 * Exports all scripted campaign missions and mission utilities.
 */

// Battle of Coruscant - ROTS Opening
export {
  // Mission factory
  createCoruscantBattleMission,

  // Fighter archetypes
  CORUSCANT_FIGHTER_ARCHETYPES,
  getCoruscantFighterArchetype,

  // Capital ships
  CORUSCANT_CAPITAL_SHIPS,
  getCapitalShip,

  // Buzz droid config
  BUZZDROID_CONFIG,

  // Spawn utilities
  calculateSpawnPosition,
  calculateInitialHeading,

  // Types
  type CoruscantMissionDef,
  type CoruscantFighterArchetype,
  type CoruscantFighterArchetypeId,
  type CapitalShip,
  type CapitalShipId,
  type MissionPhaseId,
  type CoruscantMissionPhase,
  type CoruscantMissionObjective,
  type CoruscantDialogueTrigger,
  type CoruscantWaveSpawnConfig,
  type BuzzDroidSwarm,
  type BuzzDroidConfig,
  type WingmanConfig,
  type BonusObjective,
  type CapitalShipPlacement,
  type DebrisField,
  type CoruscantBackdrop
} from "./coruscant_battle";
