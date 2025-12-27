/**
 * YavinObjectives - Objective definitions for Yavin Defense mission
 *
 * Defines the mission objectives, their triggers, and progression.
 */

import {
  type ObjectiveDefinition,
  ObjectivePriority,
  TriggerType,
  ProgressIndicatorType
} from "@xwingz/gameplay";
import { YAVIN_RADIO } from "../RadioChatterSystem";

/**
 * Yavin Defense mission objectives
 */
export const YAVIN_OBJECTIVES: ObjectiveDefinition[] = [
  {
    id: "yd_obj_1",
    name: "Scramble Alert",
    description: "Launch from the Great Temple and form up with Red Squadron",
    hudText: "SCRAMBLE - FORM UP WITH RED SQUADRON",
    hudTextActive: "FORMING UP...",
    hudTextComplete: "RED SQUADRON READY",
    phase: "launch",
    sequence: 1,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.MISSION_START },
    triggerComplete: {
      type: TriggerType.COMPOUND,
      conditions: [
        { type: TriggerType.ALTITUDE_ABOVE, value: 80 },
        { type: TriggerType.NEAR_ALLIES, count: 3, radius: 150 },
        { type: TriggerType.DURATION, seconds: 2 }
      ]
    },
    progressType: ProgressIndicatorType.NONE,
    progressMax: 1,
    rewardCredits: 0,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.scramble,
    radioOnComplete: ["All wings report in - Red Squadron formed up"]
  },
  {
    id: "yd_obj_2",
    name: "Intercept First Wave",
    description: "Engage the incoming TIE Fighter wave before they reach the temple",
    hudText: "INTERCEPT WAVE 1: 0/6 TIEs",
    hudTextActive: "ENGAGING TIE FIGHTERS",
    hudTextComplete: "WAVE 1 ELIMINATED",
    phase: "combat_wave_1",
    sequence: 2,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_1" },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "tie_fighter", count: 6, waveId: 1 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 6,
    rewardCredits: 150,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.wave1,
    radioOnComplete: ["Wave cleared! But more incoming!"],
    radioMilestones: {
      "50": "Halfway there!",
      "75": "Almost got 'em!"
    }
  },
  {
    id: "yd_obj_3",
    name: "Bomber Defense",
    description: "TIE Bombers are making attack runs on the temple - destroy them!",
    hudText: "BOMBERS INBOUND - PROTECT THE TEMPLE",
    hudTextActive: "INTERCEPTING BOMBERS: 0/3",
    hudTextComplete: "BOMBERS ELIMINATED",
    phase: "combat_wave_2",
    sequence: 3,
    priority: ObjectivePriority.CRITICAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_2" },
    triggerComplete: { type: TriggerType.KILL_COUNT, targetType: "tie_bomber", count: 3, waveId: 2 },
    triggerFail: { type: TriggerType.ENTITY_HEALTH_BELOW, entity: "great_temple", thresholdPercent: 30 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 3,
    rewardCredits: 300,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.wave2,
    radioOnComplete: ["Bombers neutralized!"]
  },
  {
    id: "yd_obj_4",
    name: "Final Assault",
    description: "The remaining Imperial forces are making a desperate all-out attack",
    hudText: "FINAL WAVE: 0/6 REMAINING",
    hudTextActive: "ELIMINATE REMAINING FORCES",
    hudTextComplete: "IMPERIAL ASSAULT REPELLED",
    phase: "combat_wave_3",
    sequence: 4,
    priority: ObjectivePriority.HIGH,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_3" },
    triggerComplete: { type: TriggerType.KILL_COUNT, count: 6, waveId: 3 },
    triggerFail: { type: TriggerType.ENTITY_HEALTH_BELOW, entity: "great_temple", thresholdPercent: 0 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 6,
    rewardCredits: 250,
    isOptional: false,
    radioOnStart: YAVIN_RADIO.wave3,
    radioOnComplete: ["That's the last of them! Victory!"]
  },
  {
    id: "yd_bonus_1",
    name: "Ace Pilot",
    description: "Destroy 5 enemies consecutively without taking significant damage",
    hudText: "BONUS: ACE STREAK 0/5",
    hudTextActive: "ACE STREAK: 0/5",
    hudTextComplete: "ACE PILOT ACHIEVED!",
    phase: "combat",
    sequence: 99,
    priority: ObjectivePriority.NORMAL,
    triggerStart: { type: TriggerType.OBJECTIVE_COMPLETE, objectiveId: "yd_obj_1" },
    triggerComplete: { type: TriggerType.KILL_STREAK, count: 5 },
    progressType: ProgressIndicatorType.NUMERIC_COUNTER,
    progressMax: 5,
    rewardCredits: 500,
    isOptional: true,
    radioOnComplete: ["Great shot! That was one in a million!"]
  }
];
