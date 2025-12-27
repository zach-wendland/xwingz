/**
 * Conquest Mode submodules
 *
 * Extracted from ConquestMode.ts for maintainability.
 */

export { GALAXY_SCALE, FACTION_COLORS, FACTION_GLOW } from "./ConquestConstants";

export {
  setupConquestLighting,
  buildConquestStarfield,
  buildConquestNebula,
  createConquestPlanetMesh,
  createTextSprite,
  buildSelectionRing,
  updateSelectionRing
} from "./ConquestSceneBuilder";

export {
  createFleetMesh,
  updateHyperspaceTrail,
  updateFleetVisuals
} from "./ConquestFleetRenderer";

export {
  createBattleIndicator,
  updateBattleIndicators,
  clearBattleIndicators
} from "./ConquestBattleIndicators";

export {
  getPhaseName,
  getFactionName,
  buildConquestHudText
} from "./ConquestHud";

export { updatePlanetVisuals } from "./ConquestPlanetVisuals";
