/**
 * Yavin Defense Scenario submodules
 *
 * Extracted from YavinDefenseScenario.ts for maintainability.
 */

export {
  buildYavinTerrain,
  getTerrainHeight,
  clearYavinAtmosphere,
  type YavinTerrainResult
} from "./YavinTerrainBuilder";

export { spawnEnvironmentalProps } from "./YavinEnvironmentalProps";

export {
  spawnWave1TieRaid,
  spawnWave2Bombers,
  spawnWave3FinalAssault,
  type WaveSpawnResult
} from "./YavinWaveSpawner";

export {
  createAllyManagerState,
  spawnWingman,
  spawnWingmanSquadron,
  syncAllies,
  clearAllies,
  getAllyCount,
  type AllyManagerState
} from "./YavinAllyManager";

export { YAVIN_OBJECTIVES } from "./YavinObjectives";
