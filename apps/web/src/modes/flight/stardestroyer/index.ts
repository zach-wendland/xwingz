/**
 * Star Destroyer Scenario submodules
 *
 * Extracted from StarDestroyerScenario.ts for maintainability.
 */

export { STAR_DESTROYER_OBJECTIVES } from "./StarDestroyerObjectives";

export {
  spawnDebrisField,
  clearDebrisField
} from "./DebrisFieldSpawner";

export {
  createSDAllyManagerState,
  spawnWingmenFormation,
  syncSDAllies,
  clearSDAllies,
  getSDAllyCount,
  type SDAllyManagerState
} from "./StarDestroyerAllyManager";

export {
  spawnTIEFighterScreen,
  spawnTIEInterceptorWave,
  type TIESpawnResult
} from "./TIEInterceptorSpawner";
