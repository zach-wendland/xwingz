/**
 * ConquestHud - HUD text building for conquest mode
 *
 * Handles:
 * - Overview stats display
 * - Selected planet info
 * - Control hints
 */

import { CONQUEST_PHASE, CONQUEST_FACTION } from "@xwingz/gameplay";
import type { GalaxySimulation, GalaxyPlanetState } from "../../conquest/GalaxySimulation";

/**
 * Get display name for conquest phase
 */
export function getPhaseName(phase: number): string {
  switch (phase) {
    case CONQUEST_PHASE.SETUP:
      return "SETUP";
    case CONQUEST_PHASE.PLAYING:
      return "IN PROGRESS";
    case CONQUEST_PHASE.REBEL_VICTORY:
      return "REBEL VICTORY!";
    case CONQUEST_PHASE.EMPIRE_VICTORY:
      return "EMPIRE VICTORY!";
    default:
      return "UNKNOWN";
  }
}

/**
 * Get display name for faction
 */
export function getFactionName(faction: number): string {
  switch (faction) {
    case CONQUEST_FACTION.REBEL:
      return "Rebel Alliance";
    case CONQUEST_FACTION.EMPIRE:
      return "Galactic Empire";
    default:
      return "Neutral";
  }
}

/**
 * Build HUD text for conquest mode
 */
export function buildConquestHudText(
  simulation: GalaxySimulation | null,
  selectedPlanetIndex: number,
  gameSpeed: number,
  paused: boolean
): string {
  if (!simulation) return "";

  const overview = simulation.getOverview();
  const phaseName = getPhaseName(overview.phase);
  const speedStr = paused ? "PAUSED" : `${gameSpeed.toFixed(1)}x`;

  let hudText =
    `GALACTIC CONQUEST - ${phaseName}\n` +
    `Time: ${Math.floor(overview.gameTime)}s | Speed: ${speedStr}\n\n` +
    `REBEL ALLIANCE: ${overview.rebelPlanets} planets | ${Math.floor(overview.rebelCredits)} credits\n` +
    `GALACTIC EMPIRE: ${overview.empirePlanets} planets | ${Math.floor(overview.empireCredits)} credits\n` +
    `Neutral: ${overview.neutralPlanets} planets\n\n`;

  if (selectedPlanetIndex >= 0) {
    const planet = simulation.getPlanetByIndex(selectedPlanetIndex);
    if (planet) {
      const factionName = getFactionName(planet.controller);
      hudText +=
        `Selected: ${planet.planetDef.name.toUpperCase()}\n` +
        `Controller: ${factionName}\n` +
        `Garrison: ${Math.floor(planet.garrison)}\n` +
        `Resources: ${Math.floor(planet.resources)}\n` +
        `${planet.underAttack ? ">>> UNDER ATTACK <<<" : ""}\n` +
        `Press ENTER to enter system\n`;
    }
  } else {
    hudText += `Click a planet to select\nB for Battle of Coruscant\n`;
  }

  hudText += `\nESC: Return to map | SPACE: Pause | +/-: Speed`;
  return hudText;
}
