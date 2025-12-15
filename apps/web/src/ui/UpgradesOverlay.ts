/**
 * UpgradesOverlay - Handles the upgrade purchase UI overlay
 */

import type { Profile } from "../state/ProfileManager";
import { UPGRADE_DEFS, getUpgradeCost, buyUpgrade } from "../state/UpgradeManager";

export type UpgradesOverlayCallbacks = {
  onPurchase?: () => void;  // Called after successful purchase
  onClose?: () => void;     // Called when overlay closes
};

/**
 * Manages the upgrades overlay UI
 */
export class UpgradesOverlay {
  private overlay: HTMLDivElement;
  private profile: Profile;
  private callbacks: UpgradesOverlayCallbacks;
  private _isOpen = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(overlay: HTMLDivElement, profile: Profile, callbacks: UpgradesOverlayCallbacks = {}) {
    this.overlay = overlay;
    this.profile = profile;
    this.callbacks = callbacks;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.render();
    this.overlay.classList.remove("hidden");
    this.attachKeyHandler();
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
    this.detachKeyHandler();
    this.callbacks.onClose?.();
  }

  toggle(): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Update profile reference (if profile changes)
   */
  setProfile(profile: Profile): void {
    this.profile = profile;
    if (this._isOpen) {
      this.render();
    }
  }

  private render(): void {
    const lines = UPGRADE_DEFS.map((def, idx) => {
      const level = this.profile.upgrades[def.id];
      const cost = getUpgradeCost(this.profile.upgrades, def);
      const statusText = cost === null
        ? "MAX"
        : cost > this.profile.credits
          ? `NEED ${cost}`
          : `BUY ${cost}`;

      return `<div class="overlay-row">${idx + 1}) ${def.name}  LV ${level}/${def.maxLevel}  <span class="muted">${def.summary}</span>  <span class="right">${statusText} CR</span></div>`;
    }).join("");

    this.overlay.innerHTML = `
      <div class="overlay-panel">
        <div class="overlay-title">HANGAR UPGRADES</div>
        <div class="overlay-sub">Credits: ${this.profile.credits} • Tier: ${this.profile.missionTier}</div>
        <div class="overlay-list">${lines}</div>
        <div class="overlay-hint">Press 1–5 to buy • U/Esc to close</div>
      </div>
    `;
  }

  private attachKeyHandler(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Number keys 1-5 to buy upgrades
      const num = parseInt(e.key);
      if (num >= 1 && num <= 5) {
        const def = UPGRADE_DEFS[num - 1];
        if (def && buyUpgrade(this.profile, def)) {
          this.callbacks.onPurchase?.();
          this.render();
        }
        return;
      }

      // U or Escape to close
      if (e.key === "u" || e.key === "U" || e.key === "Escape") {
        this.close();
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  private detachKeyHandler(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.detachKeyHandler();
    this.overlay.innerHTML = "";
  }
}
