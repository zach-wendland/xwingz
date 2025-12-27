/**
 * StarDestroyerObjectives - Objective definitions for Star Destroyer mission
 *
 * Defines the mission objectives, their triggers, and progression.
 */

import {
  type ObjectiveDefinition,
  ObjectivePriority,
  TriggerType,
  ProgressIndicatorType
} from "@xwingz/gameplay";
import { STAR_DESTROYER_RADIO } from "../RadioChatterSystem";

/**
 * Star Destroyer mission objectives
 */
export const STAR_DESTROYER_OBJECTIVES: ObjectiveDefinition[] = [
  {
    id: "sd_obj_1",
    name: "Clear Fighter Screen",
    description: "Destroy the TIE Fighter intercept force protecting the Star Destroyer",
    hudText: "CLEAR TIE SCREEN: 0/12",
    hudTextActive: "ENGAGING TIE FIGHTERS",
    hudTextComplete: "FIGHTER SCREEN ELIMINATED",
    phase: "approach",
    sequence: 1,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "tie_fighter", count: 12 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 12,
    rewardCredits: 200,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.approach,
    radioOnComplete: ["Fighter screen destroyed! Move in on the shields!"],
    radioMilestones: {
      "25": "Good shooting!",
      "50": "Halfway there!",
      "75": "Almost clear!"
    }
  },
  {
    id: "sd_obj_2",
    name: "Disable Shield Generators",
    description: "Destroy the dorsal shield generators to expose the Star Destroyer's hull",
    hudText: "DESTROY SHIELD GENERATORS: 0/2",
    hudTextActive: "TARGETING SHIELD GENERATORS",
    hudTextComplete: "SHIELDS DOWN",
    phase: "shields",
    sequence: 2,
    priority: ObjectivePriority.HIGH,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "sd_obj_1" },
    triggerComplete: { type: TriggerType.SUBSYSTEMS_DESTROYED, subsystemTypes: ["shield_gen"], count: 2 },
    progressType: ProgressIndicatorType.CIRCULAR_PROGRESS,
    progressMax: 2,
    rewardCredits: 400,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.shields,
    radioOnComplete: ["Shields are down! Target their critical systems!"]
  },
  {
    id: "sd_obj_3",
    name: "Destroy Critical Subsystems",
    description: "Target the bridge, engines, or power core to cripple the Star Destroyer",
    hudText: "SUBSYSTEMS: 0/3 CRITICAL",
    hudTextActive: "ATTACKING SUBSYSTEMS",
    hudTextComplete: "SUBSYSTEMS CRIPPLED",
    phase: "subsystems",
    sequence: 3,
    priority: ObjectivePriority.HIGH,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "sd_obj_2" },
    triggerComplete: { type: TriggerType.SUBSYSTEMS_DESTROYED, count: 3, anyCombination: true },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 3,
    rewardCredits: 500,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.subsystems,
    radioOnComplete: ["She's crippled! Finish her off!"]
  },
  {
    id: "sd_obj_4",
    name: "Destroy the Star Destroyer",
    description: "Finish off the crippled Star Destroyer before reinforcements arrive",
    hudText: "DESTROY STAR DESTROYER",
    hudTextActive: "ATTACKING HULL",
    hudTextComplete: "STAR DESTROYER DESTROYED",
    phase: "final",
    sequence: 4,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "sd_obj_3" },
    triggerComplete: { type: TriggerType.ENTITY_DESTROYED, entity: "star_destroyer" },
    progressType: ProgressIndicatorType.PROGRESS_BAR,
    progressMax: 100,
    rewardCredits: 1000,
    isOptional: false,
    radioOnStart: STAR_DESTROYER_RADIO.final,
    radioOnComplete: ["That's a kill! Star Destroyer destroyed!"]
  },
  {
    id: "sd_bonus_1",
    name: "No Casualties",
    description: "Complete the mission without losing any wingmen",
    hudText: "BONUS: PROTECT SQUADRON",
    hudTextActive: "WINGMEN ALIVE: 5/5",
    hudTextComplete: "SQUADRON INTACT!",
    phase: "combat",
    sequence: 99,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: { type: TriggerType.ALLIES_ALIVE, count: 5 },
    triggerFail: { type: TriggerType.ALLY_DEATH },
    progressType: ProgressIndicatorType.NONE,
    progressMax: 1,
    rewardCredits: 750,
    isOptional: true,
    radioOnComplete: ["All wings accounted for! Outstanding leadership!"]
  }
];
