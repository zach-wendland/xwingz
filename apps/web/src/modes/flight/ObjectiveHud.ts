/**
 * ObjectiveHud - HUD components for rendering objective progress
 */

import {
  type ObjectiveTracker,
  type ObjectiveState,
  ObjectiveStatus,
  ProgressIndicatorType
} from "@xwingz/gameplay";

const OBJECTIVE_HUD_STYLES = `
.objective-hud {
  position: fixed;
  top: 80px;
  left: 20px;
  font-family: 'Orbitron', 'Segoe UI', sans-serif;
  color: #ffd700;
  text-shadow: 0 0 5px rgba(255, 215, 0, 0.5);
  z-index: 100;
  pointer-events: none;
}

.objective-active {
  background: linear-gradient(90deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 80%, transparent 100%);
  padding: 10px 60px 10px 15px;
  border-left: 3px solid #ffd700;
  margin-bottom: 8px;
  font-size: 14px;
  letter-spacing: 1px;
}

.objective-active .label {
  color: #888;
  font-size: 10px;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.objective-active .text {
  color: #fff;
  font-weight: bold;
}

.objective-active .progress-container {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-numeric {
  font-size: 18px;
  font-weight: bold;
  color: #ffd700;
}

.progress-numeric.pulse {
  animation: progress-pulse 0.3s ease-out;
}

@keyframes progress-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.2); color: #fff; }
  100% { transform: scale(1); }
}

.progress-bar {
  width: 150px;
  height: 6px;
  background: rgba(255,255,255,0.2);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffd700, #ffaa00);
  transition: width 0.3s ease-out;
}

.progress-circular {
  display: flex;
  gap: 4px;
}

.progress-circular-segment {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255,215,0,0.3);
  border-radius: 50%;
  transition: all 0.3s ease;
}

.progress-circular-segment.filled {
  background: #ffd700;
  border-color: #ffd700;
  box-shadow: 0 0 8px rgba(255,215,0,0.6);
}

.progress-checkpoint {
  display: flex;
  gap: 2px;
  align-items: center;
}

.progress-checkpoint-segment {
  width: 30px;
  height: 4px;
  background: rgba(255,255,255,0.2);
}

.progress-checkpoint-segment.filled {
  background: #ffd700;
}

.progress-checkpoint-diamond {
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  background: rgba(255,255,255,0.3);
  margin: 0 2px;
}

.progress-checkpoint-diamond.active {
  background: #ffd700;
  box-shadow: 0 0 8px rgba(255,215,0,0.6);
}

.objective-pending {
  background: rgba(0,0,0,0.4);
  padding: 6px 40px 6px 12px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #666;
  border-left: 2px solid #444;
}

.objective-completed {
  background: rgba(0,80,0,0.3);
  padding: 6px 40px 6px 12px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #4a4;
  border-left: 2px solid #4a4;
  text-decoration: line-through;
}

.objective-failed {
  background: rgba(80,0,0,0.3);
  padding: 6px 40px 6px 12px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #a44;
  border-left: 2px solid #a44;
  text-decoration: line-through;
}

.objective-optional {
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(0,80,160,0.3);
  border-left: 2px solid #4af;
  font-size: 11px;
}

.objective-optional .label {
  color: #4af;
  font-size: 9px;
  text-transform: uppercase;
}

.objective-optional .text {
  color: #8cf;
}

.objective-optional .progress-numeric {
  color: #4af;
  font-size: 14px;
}

.objective-optional.failed {
  opacity: 0.4;
  border-left-color: #666;
}

.objective-optional.completed {
  border-left-color: #4f4;
}

.objective-optional.completed .label {
  color: #4f4;
}
`;

export class ObjectiveHud {
  private container: HTMLElement;
  private objectiveList: HTMLDivElement;
  private styleElement: HTMLStyleElement | null = null;
  private lastProgressValues: Map<string, number> = new Map();
  private lastStateFingerprint = "";

  constructor(container: HTMLElement) {
    this.container = container;
    this.objectiveList = document.createElement("div");
    this.objectiveList.className = "objective-hud";
    this.createDomElements();
  }

  private createDomElements(): void {
    // Add styles if not already present
    if (!document.getElementById("objective-hud-styles")) {
      this.styleElement = document.createElement("style");
      this.styleElement.id = "objective-hud-styles";
      this.styleElement.textContent = OBJECTIVE_HUD_STYLES;
      document.head.appendChild(this.styleElement);
    }

    this.container.appendChild(this.objectiveList);
  }

  /**
   * Build a fingerprint of the current state for change detection
   */
  private buildStateFingerprint(tracker: ObjectiveTracker): string {
    const active = tracker.getActiveObjective();
    const pending = tracker.getObjectivesByStatus(ObjectiveStatus.PENDING).slice(0, 2);
    const completed = tracker.getObjectivesByStatus(ObjectiveStatus.COMPLETED).slice(-2);
    const optional = tracker.getOptionalObjectives();

    // Build a compact fingerprint from objective IDs, statuses, and progress
    const parts: string[] = [];

    if (active) {
      parts.push(`A:${active.definition.id}:${active.progress}:${active.status}`);
    }
    for (const obj of pending) {
      parts.push(`P:${obj.definition.id}`);
    }
    for (const obj of completed) {
      parts.push(`C:${obj.definition.id}`);
    }
    for (const obj of optional) {
      parts.push(`O:${obj.definition.id}:${obj.progress}:${obj.status}`);
    }

    return parts.join("|");
  }

  /**
   * Update the HUD based on tracker state
   * Uses fingerprinting to skip DOM updates when state hasn't changed
   */
  update(tracker: ObjectiveTracker, _dt: number): void {
    // Check if state has changed
    const fingerprint = this.buildStateFingerprint(tracker);
    if (fingerprint === this.lastStateFingerprint) {
      return; // No changes, skip DOM update
    }
    this.lastStateFingerprint = fingerprint;

    // Clear and rebuild (only when state changed)
    this.objectiveList.innerHTML = "";

    // Render active objective first
    const active = tracker.getActiveObjective();
    if (active) {
      this.renderActiveObjective(active);
    }

    // Render pending objectives
    const pending = tracker.getObjectivesByStatus(ObjectiveStatus.PENDING);
    for (const obj of pending.slice(0, 2)) { // Show next 2 pending
      this.renderPendingObjective(obj);
    }

    // Render completed objectives (last 2)
    const completed = tracker.getObjectivesByStatus(ObjectiveStatus.COMPLETED);
    for (const obj of completed.slice(-2)) {
      this.renderCompletedObjective(obj);
    }

    // Render optional objectives
    const optional = tracker.getOptionalObjectives();
    for (const obj of optional) {
      this.renderOptionalObjective(obj);
    }
  }

  private renderActiveObjective(objective: ObjectiveState): void {
    const div = document.createElement("div");
    div.className = "objective-active";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = "CURRENT OBJECTIVE";
    div.appendChild(label);

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = objective.definition.hudTextActive;
    div.appendChild(text);

    // Add progress indicator
    const progressContainer = document.createElement("div");
    progressContainer.className = "progress-container";

    const progressEl = this.renderProgressIndicator(
      objective.definition.progressType,
      objective.progress,
      objective.definition.progressMax,
      objective.definition.id
    );
    if (progressEl) {
      progressContainer.appendChild(progressEl);
    }

    div.appendChild(progressContainer);
    this.objectiveList.appendChild(div);
  }

  private renderPendingObjective(objective: ObjectiveState): void {
    const div = document.createElement("div");
    div.className = "objective-pending";
    div.textContent = objective.definition.hudText;
    this.objectiveList.appendChild(div);
  }

  private renderCompletedObjective(objective: ObjectiveState): void {
    const div = document.createElement("div");
    div.className = "objective-completed";
    div.textContent = `✓ ${objective.definition.name}`;
    this.objectiveList.appendChild(div);
  }

  private renderOptionalObjective(objective: ObjectiveState): void {
    const div = document.createElement("div");
    div.className = "objective-optional";

    if (objective.status === ObjectiveStatus.OPTIONAL_FAILED) {
      div.classList.add("failed");
    } else if (objective.status === ObjectiveStatus.OPTIONAL_COMPLETED) {
      div.classList.add("completed");
    }

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = "BONUS";
    div.appendChild(label);

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = objective.definition.hudText;
    div.appendChild(text);

    // Progress for active optional objectives
    if (objective.status === ObjectiveStatus.OPTIONAL_AVAILABLE &&
      objective.definition.progressType !== ProgressIndicatorType.NONE) {
      const progressEl = this.renderProgressIndicator(
        objective.definition.progressType,
        objective.progress,
        objective.definition.progressMax,
        objective.definition.id
      );
      if (progressEl) {
        div.appendChild(progressEl);
      }
    }

    this.objectiveList.appendChild(div);
  }

  private renderProgressIndicator(
    type: ProgressIndicatorType,
    progress: number,
    max: number,
    objectiveId: string
  ): HTMLElement | null {
    switch (type) {
      case ProgressIndicatorType.NUMERIC_COUNTER:
        return this.renderNumericCounter(progress, max, objectiveId);

      case ProgressIndicatorType.PROGRESS_BAR:
        return this.renderProgressBar(progress, max);

      case ProgressIndicatorType.CIRCULAR_PROGRESS:
        return this.renderCircularProgress(max, progress);

      case ProgressIndicatorType.CHECKPOINT_MARKERS:
        return this.renderCheckpointMarkers(max, progress);

      case ProgressIndicatorType.NONE:
      default:
        return null;
    }
  }

  private renderNumericCounter(current: number, max: number, objectiveId: string): HTMLElement {
    const span = document.createElement("span");
    span.className = "progress-numeric";
    span.textContent = `${current}/${max}`;

    // Pulse animation on change
    const lastValue = this.lastProgressValues.get(objectiveId) ?? 0;
    if (current > lastValue) {
      span.classList.add("pulse");
      setTimeout(() => span.classList.remove("pulse"), 300);
    }
    this.lastProgressValues.set(objectiveId, current);

    return span;
  }

  private renderProgressBar(current: number, max: number): HTMLElement {
    const container = document.createElement("div");
    container.className = "progress-bar";

    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${(current / max) * 100}%`;

    container.appendChild(fill);
    return container;
  }

  private renderCircularProgress(segments: number, filled: number): HTMLElement {
    const container = document.createElement("div");
    container.className = "progress-circular";

    for (let i = 0; i < segments; i++) {
      const segment = document.createElement("div");
      segment.className = "progress-circular-segment";
      if (i < filled) {
        segment.classList.add("filled");
      }
      container.appendChild(segment);
    }

    return container;
  }

  private renderCheckpointMarkers(checkpoints: number, completed: number): HTMLElement {
    const container = document.createElement("div");
    container.className = "progress-checkpoint";

    for (let i = 0; i < checkpoints; i++) {
      // Diamond marker
      const diamond = document.createElement("div");
      diamond.className = "progress-checkpoint-diamond";
      if (i <= completed) {
        diamond.classList.add("active");
      }
      container.appendChild(diamond);

      // Segment between checkpoints
      if (i < checkpoints - 1) {
        const segment = document.createElement("div");
        segment.className = "progress-checkpoint-segment";
        if (i < completed) {
          segment.classList.add("filled");
        }
        container.appendChild(segment);
      }
    }

    return container;
  }

  /**
   * Trigger a pulse animation on progress update
   */
  triggerPulse(_objectiveId: string): void {
    const numericEls = this.objectiveList.querySelectorAll(".progress-numeric");
    for (const el of numericEls) {
      if (el.textContent?.includes("/")) {
        el.classList.add("pulse");
        setTimeout(() => el.classList.remove("pulse"), 300);
      }
    }
  }

  /**
   * Clean up DOM elements
   */
  dispose(): void {
    this.objectiveList.remove();
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
    this.lastProgressValues.clear();
  }
}
