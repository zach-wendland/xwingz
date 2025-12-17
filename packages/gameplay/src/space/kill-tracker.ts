/**
 * KillTracker - Centralized kill tracking for mission objectives
 */

import type { KillTrackingData } from "./objective-types";

export class KillTracker {
  private killsByType: Map<string, number> = new Map();
  private killsByWave: Map<number, number> = new Map();
  private totalKills = 0;
  private currentStreak = 0;
  private streakValid = true;
  private streakShieldThreshold = 80; // Reset streak if shield drops below this

  constructor(shieldThreshold = 80) {
    this.streakShieldThreshold = shieldThreshold;
  }

  /**
   * Record a kill
   */
  recordKill(entityType: string, wave = 0): void {
    // Update by type
    const typeCount = this.killsByType.get(entityType) ?? 0;
    this.killsByType.set(entityType, typeCount + 1);

    // Update by wave
    if (wave > 0) {
      const waveCount = this.killsByWave.get(wave) ?? 0;
      this.killsByWave.set(wave, waveCount + 1);
    }

    // Update total
    this.totalKills++;

    // Update streak (only if still valid)
    if (this.streakValid) {
      this.currentStreak++;
    }
  }

  /**
   * Check if player shield dropped below threshold
   * Call this when player takes damage
   */
  checkShieldForStreak(shieldPercent: number): boolean {
    if (shieldPercent < this.streakShieldThreshold && this.streakValid) {
      this.streakValid = false;
      return false; // Streak was invalidated
    }
    return this.streakValid;
  }

  /**
   * Get kills of a specific type
   */
  getKillsOfType(entityType: string): number {
    return this.killsByType.get(entityType) ?? 0;
  }

  /**
   * Get total kills of multiple types
   */
  getKillsOfTypes(entityTypes: string[]): number {
    let total = 0;
    for (const type of entityTypes) {
      total += this.killsByType.get(type) ?? 0;
    }
    return total;
  }

  /**
   * Get kills in a specific wave
   */
  getKillsInWave(wave: number): number {
    return this.killsByWave.get(wave) ?? 0;
  }

  /**
   * Get current kill streak
   */
  getStreak(): number {
    return this.streakValid ? this.currentStreak : 0;
  }

  /**
   * Check if streak is still valid
   */
  isStreakValid(): boolean {
    return this.streakValid;
  }

  /**
   * Reset the streak (e.g., when starting new objective)
   */
  resetStreak(): void {
    this.currentStreak = 0;
    this.streakValid = true;
  }

  /**
   * Get total kills
   */
  getTotalKills(): number {
    return this.totalKills;
  }

  /**
   * Get tracking data for ObjectiveContext
   */
  getTrackingData(): KillTrackingData {
    return {
      byType: new Map(this.killsByType),
      byWave: new Map(this.killsByWave),
      total: this.totalKills,
      streak: this.currentStreak,
      streakValid: this.streakValid
    };
  }

  /**
   * Reset all tracking state
   */
  reset(): void {
    this.killsByType.clear();
    this.killsByWave.clear();
    this.totalKills = 0;
    this.currentStreak = 0;
    this.streakValid = true;
  }
}
