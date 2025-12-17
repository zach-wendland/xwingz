/**
 * AnnouncementSystem - Central announcement overlay for objective events
 */

export const AnnouncementType = {
  NEW_OBJECTIVE: "NEW_OBJECTIVE",
  OBJECTIVE_COMPLETE: "OBJECTIVE_COMPLETE",
  OBJECTIVE_FAILED: "OBJECTIVE_FAILED",
  MILESTONE: "MILESTONE",
  PHASE_TRANSITION: "PHASE_TRANSITION",
  MISSION_COMPLETE: "MISSION_COMPLETE",
  MISSION_FAILED: "MISSION_FAILED"
} as const;

export type AnnouncementType = typeof AnnouncementType[keyof typeof AnnouncementType];

export interface Announcement {
  type: AnnouncementType;
  title: string;
  subtitle?: string;
  duration: number;
  priority: number;
}

const ANNOUNCEMENT_STYLES = `
.announcement-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 120px;
  pointer-events: none;
  z-index: 200;
}

.announcement {
  font-family: 'Orbitron', 'Segoe UI', sans-serif;
  text-align: center;
  opacity: 0;
  transform: translateY(-30px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.announcement.visible {
  opacity: 1;
  transform: translateY(0);
}

.announcement.exit {
  opacity: 0;
  transform: translateY(-20px);
}

.announcement-title {
  font-size: 28px;
  font-weight: bold;
  letter-spacing: 4px;
  text-transform: uppercase;
  text-shadow: 0 0 20px currentColor, 0 0 40px currentColor;
  margin-bottom: 8px;
}

.announcement-subtitle {
  font-size: 14px;
  letter-spacing: 2px;
  opacity: 0.8;
}

/* Type-specific styles */
.announcement.NEW_OBJECTIVE .announcement-title {
  color: #ffd700;
}

.announcement.OBJECTIVE_COMPLETE .announcement-title {
  color: #44ff44;
}

.announcement.OBJECTIVE_COMPLETE::before {
  content: "✓";
  display: block;
  font-size: 48px;
  color: #44ff44;
  text-shadow: 0 0 30px #44ff44;
  margin-bottom: 10px;
  animation: checkmark-pop 0.4s ease-out;
}

@keyframes checkmark-pop {
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); opacity: 1; }
}

.announcement.OBJECTIVE_FAILED .announcement-title {
  color: #ff4444;
}

.announcement.OBJECTIVE_FAILED::before {
  content: "✕";
  display: block;
  font-size: 48px;
  color: #ff4444;
  text-shadow: 0 0 30px #ff4444;
  margin-bottom: 10px;
  animation: x-shake 0.5s ease-out;
}

@keyframes x-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-10px); }
  40%, 80% { transform: translateX(10px); }
}

.announcement.MILESTONE .announcement-title {
  color: #88ccff;
  font-size: 20px;
}

.announcement.PHASE_TRANSITION .announcement-title {
  color: #ffd700;
  font-size: 32px;
  animation: phase-reveal 0.8s ease-out;
}

@keyframes phase-reveal {
  0% {
    clip-path: inset(0 100% 0 0);
  }
  100% {
    clip-path: inset(0 0 0 0);
  }
}

.announcement.MISSION_COMPLETE {
  background: radial-gradient(ellipse at center, rgba(0,100,0,0.4) 0%, transparent 70%);
  padding: 40px;
}

.announcement.MISSION_COMPLETE .announcement-title {
  color: #44ff44;
  font-size: 36px;
  animation: victory-glow 1s ease-in-out infinite alternate;
}

@keyframes victory-glow {
  0% { text-shadow: 0 0 20px #44ff44, 0 0 40px #44ff44; }
  100% { text-shadow: 0 0 30px #44ff44, 0 0 60px #44ff44, 0 0 80px #44ff44; }
}

.announcement.MISSION_FAILED {
  background: radial-gradient(ellipse at center, rgba(100,0,0,0.4) 0%, transparent 70%);
  padding: 40px;
}

.announcement.MISSION_FAILED .announcement-title {
  color: #ff4444;
  font-size: 36px;
}
`;

export class AnnouncementSystem {
  private container: HTMLElement;
  private overlay: HTMLDivElement;
  private currentAnnouncement: Announcement | null = null;
  private queue: Announcement[] = [];
  private displayTimer = 0;
  private announcementDiv: HTMLDivElement | null = null;
  private styleElement: HTMLStyleElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.overlay = document.createElement("div");
    this.overlay.className = "announcement-overlay";
    this.createDomElements();
  }

  private createDomElements(): void {
    // Add styles if not already present
    if (!document.getElementById("announcement-styles")) {
      this.styleElement = document.createElement("style");
      this.styleElement.id = "announcement-styles";
      this.styleElement.textContent = ANNOUNCEMENT_STYLES;
      document.head.appendChild(this.styleElement);
    }

    this.container.appendChild(this.overlay);
  }

  /**
   * Add an announcement to the queue
   */
  announce(announcement: Announcement): void {
    // If higher priority, interrupt current
    if (this.currentAnnouncement && announcement.priority > this.currentAnnouncement.priority) {
      this.hide();
      this.show(announcement);
      return;
    }

    // If nothing showing, show immediately
    if (!this.currentAnnouncement) {
      this.show(announcement);
      return;
    }

    // Add to queue (sorted by priority)
    this.queue.push(announcement);
    this.queue.sort((a, b) => b.priority - a.priority);

    // Limit queue size
    if (this.queue.length > 5) {
      this.queue.pop();
    }
  }

  /**
   * Per-frame update
   */
  tick(dt: number): void {
    if (this.currentAnnouncement) {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) {
        this.hide();

        // Show next in queue after short delay
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          setTimeout(() => this.show(next), 200);
        }
      }
    }
  }

  /**
   * Display an announcement
   */
  private show(announcement: Announcement): void {
    this.currentAnnouncement = announcement;
    this.displayTimer = announcement.duration;

    // Create announcement element
    this.announcementDiv = document.createElement("div");
    this.announcementDiv.className = `announcement ${announcement.type}`;

    const title = document.createElement("div");
    title.className = "announcement-title";
    title.textContent = announcement.title;
    this.announcementDiv.appendChild(title);

    if (announcement.subtitle) {
      const subtitle = document.createElement("div");
      subtitle.className = "announcement-subtitle";
      subtitle.textContent = announcement.subtitle;
      this.announcementDiv.appendChild(subtitle);
    }

    this.overlay.appendChild(this.announcementDiv);

    // Trigger enter animation
    requestAnimationFrame(() => {
      if (this.announcementDiv) {
        this.announcementDiv.classList.add("visible");
      }
    });
  }

  /**
   * Hide current announcement
   */
  private hide(): void {
    if (this.announcementDiv) {
      this.announcementDiv.classList.remove("visible");
      this.announcementDiv.classList.add("exit");

      const div = this.announcementDiv;
      setTimeout(() => div.remove(), 400);
      this.announcementDiv = null;
    }

    this.currentAnnouncement = null;
    this.displayTimer = 0;
  }

  /**
   * Clear all announcements
   */
  clear(): void {
    this.hide();
    this.queue = [];
  }

  /**
   * Clean up DOM elements
   */
  dispose(): void {
    this.hide();
    this.overlay.remove();
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper factory functions
// ─────────────────────────────────────────────────────────────────────────────

export function newObjectiveAnnouncement(title: string, subtitle?: string): Announcement {
  return {
    type: AnnouncementType.NEW_OBJECTIVE,
    title,
    subtitle,
    duration: 3.5,
    priority: 5
  };
}

export function objectiveCompleteAnnouncement(title: string): Announcement {
  return {
    type: AnnouncementType.OBJECTIVE_COMPLETE,
    title,
    duration: 2.5,
    priority: 6
  };
}

export function objectiveFailedAnnouncement(title: string): Announcement {
  return {
    type: AnnouncementType.OBJECTIVE_FAILED,
    title,
    duration: 3.0,
    priority: 8
  };
}

export function milestoneAnnouncement(text: string): Announcement {
  return {
    type: AnnouncementType.MILESTONE,
    title: text,
    duration: 2.0,
    priority: 3
  };
}

export function phaseTransitionAnnouncement(phaseName: string): Announcement {
  return {
    type: AnnouncementType.PHASE_TRANSITION,
    title: phaseName,
    duration: 4.0,
    priority: 7
  };
}

export function missionCompleteAnnouncement(): Announcement {
  return {
    type: AnnouncementType.MISSION_COMPLETE,
    title: "MISSION COMPLETE",
    duration: 5.0,
    priority: 10
  };
}

export function missionFailedAnnouncement(reason?: string): Announcement {
  return {
    type: AnnouncementType.MISSION_FAILED,
    title: "MISSION FAILED",
    subtitle: reason,
    duration: 5.0,
    priority: 10
  };
}
