/**
 * RadioChatterSystem - Text-based radio chatter display system
 */

export const RadioSpeaker = {
  PLAYER: "PLAYER",
  WINGMAN: "WINGMAN",
  COMMAND: "COMMAND",
  IMPERIAL: "IMPERIAL",
  GUNNER: "GUNNER",
  ESCORT: "ESCORT"
} as const;

export type RadioSpeaker = typeof RadioSpeaker[keyof typeof RadioSpeaker];

export interface RadioMessage {
  speaker: RadioSpeaker;
  callsign: string;
  text: string;
  priority: number;
  duration: number;
}

const SPEAKER_STYLES: Record<RadioSpeaker, { color: string; prefix: string }> = {
  [RadioSpeaker.PLAYER]: { color: "#ff6644", prefix: "RED 5:" },
  [RadioSpeaker.WINGMAN]: { color: "#ffaa44", prefix: "RED {n}:" },
  [RadioSpeaker.COMMAND]: { color: "#ffffff", prefix: "COMMAND:" },
  [RadioSpeaker.IMPERIAL]: { color: "#4488ff", prefix: "IMP:" },
  [RadioSpeaker.GUNNER]: { color: "#88ff88", prefix: "GUNNER:" },
  [RadioSpeaker.ESCORT]: { color: "#ff88ff", prefix: "LEIA:" }
};

const RADIO_STYLES = `
.radio-chatter {
  position: fixed;
  bottom: 120px;
  left: 20px;
  font-family: 'Orbitron', 'Segoe UI', sans-serif;
  font-size: 13px;
  z-index: 100;
  pointer-events: none;
  max-width: 400px;
}

.radio-message {
  background: linear-gradient(90deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 80%, transparent 100%);
  padding: 8px 40px 8px 12px;
  border-left: 3px solid currentColor;
  margin-bottom: 4px;
  opacity: 0;
  transform: translateX(-20px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.radio-message.visible {
  opacity: 1;
  transform: translateX(0);
}

.radio-message.exit {
  opacity: 0;
  transform: translateX(-20px);
}

.radio-callsign {
  font-weight: bold;
  margin-right: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.radio-text {
  color: #ccc;
}

/* Speaker-specific colors */
.radio-message.PLAYER { border-color: #ff6644; }
.radio-message.PLAYER .radio-callsign { color: #ff6644; }

.radio-message.WINGMAN { border-color: #ffaa44; }
.radio-message.WINGMAN .radio-callsign { color: #ffaa44; }

.radio-message.COMMAND { border-color: #ffffff; }
.radio-message.COMMAND .radio-callsign { color: #ffffff; }

.radio-message.IMPERIAL { border-color: #4488ff; }
.radio-message.IMPERIAL .radio-callsign { color: #4488ff; }

.radio-message.GUNNER { border-color: #88ff88; }
.radio-message.GUNNER .radio-callsign { color: #88ff88; }

.radio-message.ESCORT { border-color: #ff88ff; }
.radio-message.ESCORT .radio-callsign { color: #ff88ff; }

/* Radio static effect */
.radio-message::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(255,255,255,0.02) 2px,
    rgba(255,255,255,0.02) 4px
  );
  pointer-events: none;
}
`;

export class RadioChatterSystem {
  private container: HTMLElement;
  private radioContainer: HTMLDivElement;
  private queue: RadioMessage[] = [];
  private currentMessage: RadioMessage | null = null;
  private messageElement: HTMLDivElement | null = null;
  private displayTimer = 0;
  private gapTimer = 0;
  private styleElement: HTMLStyleElement | null = null;
  private wingmanCounter = 2; // Rotates through RED 2, 3, 4, etc.

  private readonly DEFAULT_DURATION = 3;
  private readonly MAX_QUEUE_SIZE = 5;
  private readonly MIN_GAP = 0.5;

  constructor(container: HTMLElement) {
    this.container = container;
    this.radioContainer = document.createElement("div");
    this.radioContainer.className = "radio-chatter";
    this.createDomElements();
  }

  private createDomElements(): void {
    // Add styles if not already present
    if (!document.getElementById("radio-chatter-styles")) {
      this.styleElement = document.createElement("style");
      this.styleElement.id = "radio-chatter-styles";
      this.styleElement.textContent = RADIO_STYLES;
      document.head.appendChild(this.styleElement);
    }

    this.container.appendChild(this.radioContainer);
  }

  /**
   * Queue a single message
   */
  queueMessage(message: RadioMessage): void {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      // Remove lowest priority
      this.queue.sort((a, b) => b.priority - a.priority);
      this.queue.pop();
    }

    this.queue.push(message);
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Queue multiple messages from the same speaker
   */
  queueMessages(texts: string[], speaker: RadioSpeaker, priority = 5): void {
    for (const text of texts) {
      this.queueMessage({
        speaker,
        callsign: this.getCallsign(speaker),
        text,
        priority,
        duration: this.DEFAULT_DURATION
      });
    }
  }

  /**
   * Queue a single text message with default settings
   */
  say(text: string, speaker: RadioSpeaker, priority = 5): void {
    this.queueMessage({
      speaker,
      callsign: this.getCallsign(speaker),
      text,
      priority,
      duration: this.DEFAULT_DURATION
    });
  }

  /**
   * Queue wingman chatter with rotating callsigns
   */
  wingmanSay(text: string, priority = 5): void {
    const callsign = `RED ${this.wingmanCounter}:`;
    this.wingmanCounter++;
    if (this.wingmanCounter > 5) this.wingmanCounter = 2;

    this.queueMessage({
      speaker: RadioSpeaker.WINGMAN,
      callsign,
      text,
      priority,
      duration: this.DEFAULT_DURATION
    });
  }

  /**
   * Per-frame update
   */
  tick(dt: number): void {
    // Handle gap between messages
    if (this.gapTimer > 0) {
      this.gapTimer -= dt;
      return;
    }

    // Handle current message display
    if (this.currentMessage) {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) {
        this.hideMessage();
        this.gapTimer = this.MIN_GAP;
      }
      return;
    }

    // Show next message from queue
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.showMessage(next);
    }
  }

  /**
   * Display a message
   */
  private showMessage(message: RadioMessage): void {
    this.currentMessage = message;
    this.displayTimer = message.duration;

    this.messageElement = document.createElement("div");
    this.messageElement.className = `radio-message ${message.speaker}`;

    const callsign = document.createElement("span");
    callsign.className = "radio-callsign";
    callsign.textContent = message.callsign;
    this.messageElement.appendChild(callsign);

    const text = document.createElement("span");
    text.className = "radio-text";
    text.textContent = message.text;
    this.messageElement.appendChild(text);

    this.radioContainer.appendChild(this.messageElement);

    // Trigger enter animation
    requestAnimationFrame(() => {
      if (this.messageElement) {
        this.messageElement.classList.add("visible");
      }
    });
  }

  /**
   * Hide current message
   */
  private hideMessage(): void {
    if (this.messageElement) {
      this.messageElement.classList.remove("visible");
      this.messageElement.classList.add("exit");

      const el = this.messageElement;
      setTimeout(() => el.remove(), 300);
      this.messageElement = null;
    }

    this.currentMessage = null;
    this.displayTimer = 0;
  }

  /**
   * Get callsign for speaker type
   */
  private getCallsign(speaker: RadioSpeaker): string {
    const style = SPEAKER_STYLES[speaker];
    if (speaker === RadioSpeaker.WINGMAN) {
      return `RED ${this.wingmanCounter}:`;
    }
    return style.prefix;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.hideMessage();
    this.queue = [];
  }

  /**
   * Clean up DOM elements
   */
  dispose(): void {
    this.clear();
    this.radioContainer.remove();
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset radio chatter lines
// ─────────────────────────────────────────────────────────────────────────────

export const YAVIN_RADIO = {
  scramble: [
    "Red Five standing by",
    "Red Three standing by",
    "Red Two standing by",
    "All wings report in"
  ],
  wave1: [
    "Incoming fighters, twelve o'clock!",
    "I've got one on my tail!",
    "Good shot, Red Five!"
  ],
  wave2: [
    "Bombers incoming! Priority targets!",
    "They're targeting the temple!",
    "We've taken a hit! Temple shields at 80%!"
  ],
  wave3: [
    "This is it! They're throwing everything at us!",
    "Watch your six!",
    "Keep them away from the temple!"
  ],
  milestone25: "Stay on them!",
  milestone50: "Halfway there!",
  milestone75: "Almost got 'em!",
  killConfirm: "Good shot!"
};

export const STAR_DESTROYER_RADIO = {
  approach: [
    "All wings, engage the fighter screen!",
    "Watch those TIE Interceptors!",
    "Keep them off the bombers!"
  ],
  shields: [
    "Target those shield generators!",
    "Concentrate all fire on the command tower!",
    "First generator down! One more to go!"
  ],
  subsystems: [
    "Shields are down! Target their systems!",
    "Go for the engines!",
    "Bridge is exposed!"
  ],
  final: [
    "She's going down!",
    "All wings pull back!",
    "That's a kill! Star Destroyer destroyed!"
  ],
  imperial: [
    "We've lost targeting control!",
    "Damage report! Hull breaches on multiple decks!"
  ]
};

export const HOTH_RADIO = {
  escort: [
    "Stay close!",
    "I can handle myself, flyboy!",
    "Now move!"
  ],
  combat: [
    "Company!",
    "Get down!",
    "Here they come!"
  ],
  clear: [
    "Clear!",
    "Nice shooting.",
    "Let's keep moving."
  ],
  c3po: [
    "Oh my! This is madness!",
    "We're doomed!",
    "I do believe we're being shot at!"
  ],
  falcon: [
    "There she is!",
    "That's the Falcon?!",
    "She'll make point five past lightspeed. Now RUN!"
  ]
};
