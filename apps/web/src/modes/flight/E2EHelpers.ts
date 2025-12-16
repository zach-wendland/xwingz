/**
 * E2EHelpers - Test-only helpers for automated testing
 * These methods are used by Playwright E2E tests to trigger specific game states
 */

import { removeEntity, hasComponent } from "bitecs";
import type { IWorld } from "bitecs";
import { Health, CapitalShipV2, removeCapitalShipV2 } from "@xwingz/gameplay";
import type { YavinDefenseState, StarDestroyerMissionState } from "./types";

export class E2EHelpers {
  /**
   * Kill all enemy targets - for e2e testing only
   * Removes entities to trigger death detection in syncTargets
   */
  static killAllEnemies(
    world: IWorld,
    targetEids: number[],
    yavin: YavinDefenseState | null,
    starDestroyerMission: StarDestroyerMissionState | null
  ): number[] {
    for (const eid of targetEids) {
      removeEntity(world, eid);
    }

    // Update yavin kill count if in yavin mission
    if (yavin && yavin.phase === "combat") {
      yavin.enemiesKilled = yavin.enemiesTotal;
    }

    // Update SD mission kill count
    if (starDestroyerMission) {
      starDestroyerMission.tieFightersKilled = starDestroyerMission.tieFighterCount;
    }

    // Return empty array to clear targetEids
    return [];
  }

  /**
   * Destroy the base - for e2e testing only
   */
  static failBase(world: IWorld, baseEid: number | null): void {
    if (baseEid !== null && hasComponent(world, Health, baseEid)) {
      Health.hp[baseEid] = 0;
    }
  }

  /**
   * Destroy the Star Destroyer - for e2e testing only
   */
  static destroyStarDestroyer(
    world: IWorld,
    starDestroyerMission: StarDestroyerMissionState | null
  ): void {
    if (starDestroyerMission) {
      const sdEid = starDestroyerMission.starDestroyerEid;
      if (hasComponent(world, CapitalShipV2, sdEid)) {
        // Set all hull sections to 0 to trigger destruction
        CapitalShipV2.hullFore[sdEid] = 0;
        CapitalShipV2.hullMid[sdEid] = 0;
        CapitalShipV2.hullAft[sdEid] = 0;
        // Remove the entity to trigger cleanup
        removeCapitalShipV2(world, sdEid);
      }
    }
  }
}
