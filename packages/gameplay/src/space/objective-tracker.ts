/**
 * ObjectiveTracker - Generic, reusable objective tracking system
 */

import {
  type ObjectiveDefinition,
  type ObjectiveState,
  type ObjectiveContext,
  type ObjectiveEvent,
  type TriggerCondition,
  type ObjectiveTrackerSaveData,
  ObjectiveStatus,
  ObjectiveEventType,
  TriggerType
} from "./objective-types";

export class ObjectiveTracker {
  private objectiveStates: Map<string, ObjectiveState> = new Map();
  private activeObjectiveId: string | null = null;
  private completedObjectives: Set<string> = new Set();
  private failedObjectives: Set<string> = new Set();
  private eventQueue: ObjectiveEvent[] = [];
  private definitions: ObjectiveDefinition[];
  private lastMilestones: Map<string, number> = new Map();

  constructor(objectives: ObjectiveDefinition[]) {
    this.definitions = objectives;
  }

  /**
   * Initialize all objectives to PENDING and activate the first one
   */
  initialize(): void {
    this.objectiveStates.clear();
    this.completedObjectives.clear();
    this.failedObjectives.clear();
    this.eventQueue = [];
    this.lastMilestones.clear();
    this.activeObjectiveId = null;

    // Sort by sequence and create states
    const sorted = [...this.definitions].sort((a, b) => a.sequence - b.sequence);

    for (const def of sorted) {
      const state: ObjectiveState = {
        definition: def,
        status: def.isOptional ? ObjectiveStatus.OPTIONAL_AVAILABLE : ObjectiveStatus.PENDING,
        progress: 0,
        startTime: 0,
        completedTime: null,
        metadata: {}
      };
      this.objectiveStates.set(def.id, state);
    }

    // Activate first required objective
    const firstRequired = sorted.find(d => !d.isOptional);
    if (firstRequired) {
      this.activateObjective(firstRequired.id, 0);
    }
  }

  /**
   * Per-frame update - check triggers, update progress, emit events
   */
  tick(dt: number, context: ObjectiveContext): ObjectiveEvent[] {
    this.eventQueue = [];

    // Check active objective completion
    if (this.activeObjectiveId) {
      const activeState = this.objectiveStates.get(this.activeObjectiveId);
      if (activeState && activeState.status === ObjectiveStatus.ACTIVE) {
        // Check fail condition first
        if (activeState.definition.triggerFail) {
          if (this.evaluateTrigger(activeState.definition.triggerFail, context)) {
            this.failObjective(this.activeObjectiveId, context.missionTime);
          }
        }

        // Check complete condition (if not failed)
        if (activeState.status === ObjectiveStatus.ACTIVE) {
          if (this.evaluateTrigger(activeState.definition.triggerComplete, context)) {
            this.completeObjective(this.activeObjectiveId, context.missionTime);
          }
        }
      }
    }

    // Check optional objectives
    for (const [id, state] of this.objectiveStates) {
      if (state.definition.isOptional && state.status === ObjectiveStatus.OPTIONAL_AVAILABLE) {
        // Check fail condition
        if (state.definition.triggerFail) {
          if (this.evaluateTrigger(state.definition.triggerFail, context)) {
            this.failOptionalObjective(id);
          }
        }

        // Check complete condition
        if (state.status === ObjectiveStatus.OPTIONAL_AVAILABLE) {
          if (this.evaluateTrigger(state.definition.triggerComplete, context)) {
            this.completeOptionalObjective(id, context.missionTime);
          }
        }
      }
    }

    // Check pending objectives for activation
    for (const [id, state] of this.objectiveStates) {
      if (state.status === ObjectiveStatus.PENDING) {
        const triggerStart = state.definition.triggerStart;

        // String trigger = objective ID reference
        if (typeof triggerStart === "string") {
          if (triggerStart.startsWith("objective_complete:")) {
            const reqId = triggerStart.replace("objective_complete:", "");
            if (this.completedObjectives.has(reqId)) {
              this.activateObjective(id, context.missionTime);
            }
          }
        } else {
          // TriggerCondition
          if (this.evaluateTrigger(triggerStart, context)) {
            this.activateObjective(id, context.missionTime);
          }
        }
      }
    }

    // Update progress for active objective
    this.updateActiveProgress(context);

    // Check for mission complete
    if (this.isAllRequiredComplete()) {
      this.eventQueue.push({
        type: ObjectiveEventType.MISSION_COMPLETE,
        objectiveId: "",
        message: "MISSION COMPLETE"
      });
    }

    return this.eventQueue;
  }

  /**
   * Evaluate a trigger condition
   */
  evaluateTrigger(trigger: TriggerCondition, context: ObjectiveContext): boolean {
    switch (trigger.type) {
      case TriggerType.MISSION_START:
        return true;

      case TriggerType.OBJECTIVE_COMPLETE:
        return trigger.objectiveId
          ? this.completedObjectives.has(trigger.objectiveId)
          : false;

      case TriggerType.KILL_COUNT:
        if (trigger.waveId !== undefined) {
          return (context.kills.byWave.get(trigger.waveId) ?? 0) >= (trigger.count ?? 0);
        }
        if (trigger.targetType) {
          return (context.kills.byType.get(trigger.targetType) ?? 0) >= (trigger.count ?? 0);
        }
        return context.kills.total >= (trigger.count ?? 0);

      case TriggerType.KILL_ALL:
        if (trigger.targetTypes) {
          const totalOfTypes = trigger.targetTypes.reduce(
            (sum, type) => sum + (context.kills.byType.get(type) ?? 0),
            0
          );
          return totalOfTypes >= (trigger.count ?? 0);
        }
        return false;

      case TriggerType.KILL_STREAK:
        return context.kills.streakValid && context.kills.streak >= (trigger.count ?? 0);

      case TriggerType.SUBSYSTEMS_DESTROYED:
        if (trigger.subsystemTypes && trigger.anyCombination) {
          // Count how many of the specified types are destroyed
          let destroyed = 0;
          for (const type of trigger.subsystemTypes) {
            if (context.entities.destroyedSubsystemTypes.includes(type)) {
              destroyed++;
            }
          }
          return destroyed >= (trigger.count ?? 0);
        }
        return context.entities.subsystemsDestroyed >= (trigger.count ?? 0);

      case TriggerType.ENTITY_DESTROYED:
        if (trigger.entity === "star_destroyer") {
          return context.entities.capitalShipDestroyed;
        }
        return false;

      case TriggerType.ENTITY_HEALTH_BELOW:
        if (trigger.entity === "great_temple" || trigger.entity === "base") {
          return context.entities.baseHealthPercent <= (trigger.thresholdPercent ?? 0);
        }
        return false;

      case TriggerType.ALTITUDE_ABOVE:
        return context.location.playerAltitude >= (trigger.value ?? 0);

      case TriggerType.NEAR_ALLIES:
        return context.allies.nearbyCount >= (trigger.count ?? 0);

      case TriggerType.DURATION:
        // Duration triggers need state tracking - check metadata
        return false; // Handled separately

      case TriggerType.COMPOUND:
        // All conditions must be true (AND logic)
        if (trigger.conditions) {
          return trigger.conditions.every(cond => this.evaluateTrigger(cond, context));
        }
        return false;

      case TriggerType.REACH_LOCATION:
        if (trigger.location) {
          const distance = context.location.locationDistances.get(trigger.location);
          return distance !== undefined && distance <= (trigger.radius ?? 5);
        }
        return false;

      case TriggerType.INTERACT:
        return context.interactProgress >= (trigger.seconds ?? 1);

      case TriggerType.ESCORT_ALIVE:
        return context.escort.escortAlive;

      case TriggerType.NPC_HEALTH_ZERO:
        return !context.escort.escortAlive || context.escort.escortHealth <= 0;

      case TriggerType.NPC_DAMAGE_TAKEN:
        return context.escort.escortDamageTaken <= (trigger.value ?? 0);

      case TriggerType.ALLIES_ALIVE:
        return context.allies.alive >= (trigger.count ?? 0);

      case TriggerType.ALLY_DEATH:
        return context.allies.alive < context.allies.started;

      case TriggerType.CABLE_STATE:
        return context.entities.cableState === (trigger.value ?? 0);

      case TriggerType.CABLE_WRAPS:
        return context.entities.cableWraps >= (trigger.count ?? 0);

      default:
        return false;
    }
  }

  /**
   * Update progress for the active objective based on context
   */
  private updateActiveProgress(context: ObjectiveContext): void {
    if (!this.activeObjectiveId) return;

    const state = this.objectiveStates.get(this.activeObjectiveId);
    if (!state || state.status !== ObjectiveStatus.ACTIVE) return;

    const trigger = state.definition.triggerComplete;
    let newProgress = 0;
    const max = state.definition.progressMax;

    // Calculate progress based on trigger type
    switch (trigger.type) {
      case TriggerType.KILL_COUNT:
        if (trigger.waveId !== undefined) {
          newProgress = context.kills.byWave.get(trigger.waveId) ?? 0;
        } else if (trigger.targetType) {
          newProgress = context.kills.byType.get(trigger.targetType) ?? 0;
        }
        break;

      case TriggerType.KILL_ALL:
        if (trigger.targetTypes) {
          newProgress = trigger.targetTypes.reduce(
            (sum, type) => sum + (context.kills.byType.get(type) ?? 0),
            0
          );
        }
        break;

      case TriggerType.KILL_STREAK:
        newProgress = context.kills.streak;
        break;

      case TriggerType.SUBSYSTEMS_DESTROYED:
        if (trigger.subsystemTypes && trigger.anyCombination) {
          newProgress = trigger.subsystemTypes.filter(type =>
            context.entities.destroyedSubsystemTypes.includes(type)
          ).length;
        } else {
          newProgress = context.entities.subsystemsDestroyed;
        }
        break;

      case TriggerType.CABLE_WRAPS:
        newProgress = context.entities.cableWraps;
        break;

      case TriggerType.COMPOUND:
        // Count how many sub-conditions are met
        if (trigger.conditions) {
          newProgress = trigger.conditions.filter(cond =>
            this.evaluateTrigger(cond, context)
          ).length;
        }
        break;

      default:
        // Binary progress (0 or max)
        newProgress = this.evaluateTrigger(trigger, context) ? max : 0;
    }

    // Emit progress event if changed
    if (newProgress !== state.progress) {
      const prevProgress = state.progress;
      state.progress = Math.min(newProgress, max);

      this.eventQueue.push({
        type: ObjectiveEventType.OBJECTIVE_PROGRESS,
        objectiveId: state.definition.id,
        objective: state,
        previousProgress: prevProgress,
        newProgress: state.progress
      });

      // Check milestones
      this.checkMilestones(state, prevProgress, state.progress);
    }
  }

  /**
   * Check for milestone progress (25%, 50%, 75%)
   */
  private checkMilestones(state: ObjectiveState, prevProgress: number, newProgress: number): void {
    const max = state.definition.progressMax;
    if (max <= 0) return;

    const milestones = [25, 50, 75];
    const prevPercent = (prevProgress / max) * 100;
    const newPercent = (newProgress / max) * 100;

    for (const milestone of milestones) {
      if (prevPercent < milestone && newPercent >= milestone) {
        const lastMilestone = this.lastMilestones.get(state.definition.id) ?? 0;
        if (milestone > lastMilestone) {
          this.lastMilestones.set(state.definition.id, milestone);

          const milestoneMsg = state.definition.radioMilestones?.[`${milestone}`];
          this.eventQueue.push({
            type: ObjectiveEventType.OBJECTIVE_MILESTONE,
            objectiveId: state.definition.id,
            objective: state,
            milestone: `${milestone}%`,
            message: milestoneMsg ?? `${milestone}% complete!`
          });
        }
      }
    }
  }

  /**
   * Activate an objective
   */
  private activateObjective(objectiveId: string, missionTime: number): void {
    const state = this.objectiveStates.get(objectiveId);
    if (!state) return;

    state.status = ObjectiveStatus.ACTIVE;
    state.startTime = missionTime;
    this.activeObjectiveId = objectiveId;

    this.eventQueue.push({
      type: ObjectiveEventType.OBJECTIVE_ACTIVATED,
      objectiveId,
      objective: state,
      message: state.definition.hudTextActive
    });
  }

  /**
   * Complete an objective
   */
  private completeObjective(objectiveId: string, missionTime: number): void {
    const state = this.objectiveStates.get(objectiveId);
    if (!state) return;

    state.status = ObjectiveStatus.COMPLETED;
    state.completedTime = missionTime;
    state.progress = state.definition.progressMax;
    this.completedObjectives.add(objectiveId);

    this.eventQueue.push({
      type: ObjectiveEventType.OBJECTIVE_COMPLETED,
      objectiveId,
      objective: state,
      message: state.definition.hudTextComplete
    });

    // Find and activate next objective by sequence
    const currentSeq = state.definition.sequence;
    let nextObjective: ObjectiveState | null = null;

    for (const [, objState] of this.objectiveStates) {
      if (!objState.definition.isOptional &&
        objState.status === ObjectiveStatus.PENDING &&
        objState.definition.sequence > currentSeq) {
        if (!nextObjective || objState.definition.sequence < nextObjective.definition.sequence) {
          nextObjective = objState;
        }
      }
    }

    if (nextObjective) {
      this.activateObjective(nextObjective.definition.id, missionTime);
    } else {
      this.activeObjectiveId = null;
    }
  }

  /**
   * Fail an objective
   */
  private failObjective(objectiveId: string, missionTime: number): void {
    const state = this.objectiveStates.get(objectiveId);
    if (!state) return;

    state.status = ObjectiveStatus.FAILED;
    state.completedTime = missionTime;
    this.failedObjectives.add(objectiveId);

    this.eventQueue.push({
      type: ObjectiveEventType.OBJECTIVE_FAILED,
      objectiveId,
      objective: state,
      message: "OBJECTIVE FAILED"
    });

    // Mission failure for required objectives
    if (!state.definition.isOptional) {
      this.eventQueue.push({
        type: ObjectiveEventType.MISSION_FAILED,
        objectiveId,
        message: "MISSION FAILED"
      });
    }
  }

  /**
   * Complete an optional objective
   */
  private completeOptionalObjective(objectiveId: string, missionTime: number): void {
    const state = this.objectiveStates.get(objectiveId);
    if (!state) return;

    state.status = ObjectiveStatus.OPTIONAL_COMPLETED;
    state.completedTime = missionTime;
    state.progress = state.definition.progressMax;
    this.completedObjectives.add(objectiveId);

    this.eventQueue.push({
      type: ObjectiveEventType.OBJECTIVE_COMPLETED,
      objectiveId,
      objective: state,
      message: `BONUS: ${state.definition.hudTextComplete}`
    });
  }

  /**
   * Fail an optional objective
   */
  private failOptionalObjective(objectiveId: string): void {
    const state = this.objectiveStates.get(objectiveId);
    if (!state) return;

    state.status = ObjectiveStatus.OPTIONAL_FAILED;
    this.failedObjectives.add(objectiveId);

    this.eventQueue.push({
      type: ObjectiveEventType.OBJECTIVE_FAILED,
      objectiveId,
      objective: state,
      message: "BONUS OBJECTIVE FAILED"
    });
  }

  /**
   * Check if all required objectives are complete
   */
  private isAllRequiredComplete(): boolean {
    for (const [, state] of this.objectiveStates) {
      if (!state.definition.isOptional && state.status !== ObjectiveStatus.COMPLETED) {
        return false;
      }
    }
    return this.objectiveStates.size > 0;
  }

  /**
   * Check if mission has failed
   */
  isMissionFailed(): boolean {
    for (const [, state] of this.objectiveStates) {
      if (!state.definition.isOptional && state.status === ObjectiveStatus.FAILED) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the currently active objective
   */
  getActiveObjective(): ObjectiveState | null {
    if (!this.activeObjectiveId) return null;
    return this.objectiveStates.get(this.activeObjectiveId) ?? null;
  }

  /**
   * Get all objectives with a given status
   */
  getObjectivesByStatus(status: ObjectiveStatus): ObjectiveState[] {
    const results: ObjectiveState[] = [];
    for (const [, state] of this.objectiveStates) {
      if (state.status === status) {
        results.push(state);
      }
    }
    return results;
  }

  /**
   * Get all optional objectives
   */
  getOptionalObjectives(): ObjectiveState[] {
    const results: ObjectiveState[] = [];
    for (const [, state] of this.objectiveStates) {
      if (state.definition.isOptional) {
        results.push(state);
      }
    }
    return results;
  }

  /**
   * Get all objectives
   */
  getAllObjectives(): ObjectiveState[] {
    return Array.from(this.objectiveStates.values());
  }

  /**
   * Get an objective by ID
   */
  getObjective(id: string): ObjectiveState | undefined {
    return this.objectiveStates.get(id);
  }

  /**
   * Manually update progress (for special cases)
   */
  setProgress(objectiveId: string, progress: number): void {
    const state = this.objectiveStates.get(objectiveId);
    if (state) {
      state.progress = Math.min(progress, state.definition.progressMax);
    }
  }

  /**
   * Get total credits earned
   */
  getTotalCreditsEarned(): number {
    let total = 0;
    for (const [, state] of this.objectiveStates) {
      if (state.status === ObjectiveStatus.COMPLETED ||
        state.status === ObjectiveStatus.OPTIONAL_COMPLETED) {
        total += state.definition.rewardCredits;
      }
    }
    return total;
  }

  /**
   * Serialize state for save/load
   */
  serialize(): ObjectiveTrackerSaveData {
    const states: ObjectiveTrackerSaveData["objectiveStates"] = [];
    for (const [id, state] of this.objectiveStates) {
      states.push({
        id,
        status: state.status,
        progress: state.progress,
        startTime: state.startTime,
        completedTime: state.completedTime,
        metadata: state.metadata
      });
    }

    return {
      version: 1,
      activeObjectiveId: this.activeObjectiveId,
      completedObjectives: Array.from(this.completedObjectives),
      failedObjectives: Array.from(this.failedObjectives),
      objectiveStates: states
    };
  }

  /**
   * Restore state from save data
   */
  deserialize(data: ObjectiveTrackerSaveData): void {
    this.activeObjectiveId = data.activeObjectiveId;
    this.completedObjectives = new Set(data.completedObjectives);
    this.failedObjectives = new Set(data.failedObjectives);

    for (const savedState of data.objectiveStates) {
      const state = this.objectiveStates.get(savedState.id);
      if (state) {
        state.status = savedState.status;
        state.progress = savedState.progress;
        state.startTime = savedState.startTime;
        state.completedTime = savedState.completedTime;
        state.metadata = savedState.metadata;
      }
    }
  }
}
