/**
 * UpgradeManager - Handles ship upgrade definitions, costs, and purchasing
 */

import type { Upgrades, Profile } from "./ProfileManager";
import { getFighterArchetype } from "@xwingz/procgen";

export type UpgradeId = keyof Upgrades;

export type UpgradeDef = {
  id: UpgradeId;
  name: string;
  summary: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
};

export const UPGRADE_DEFS: UpgradeDef[] = [
  { id: "engine", name: "ENGINES", summary: "+SPD/+ACC", baseCost: 220, growth: 1.55, maxLevel: 10 },
  { id: "maneuver", name: "MANEUVER", summary: "+TURN", baseCost: 200, growth: 1.55, maxLevel: 10 },
  { id: "shields", name: "SHIELDS", summary: "+MAX/+REGEN", baseCost: 240, growth: 1.6, maxLevel: 10 },
  { id: "lasers", name: "LASERS", summary: "+DMG/+ROF", baseCost: 280, growth: 1.6, maxLevel: 10 },
  { id: "hull", name: "HULL", summary: "+HP", baseCost: 200, growth: 1.55, maxLevel: 10 }
];

/**
 * Calculate the cost to purchase the next level of an upgrade.
 * Returns null if already at max level.
 */
export function getUpgradeCost(upgrades: Upgrades, def: UpgradeDef): number | null {
  const level = upgrades[def.id];
  if (level >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

/**
 * Attempt to purchase an upgrade.
 * Returns true if purchase succeeded, false if not enough credits or max level.
 */
export function buyUpgrade(profile: Profile, def: UpgradeDef): boolean {
  const cost = getUpgradeCost(profile.upgrades, def);
  if (cost === null) return false;
  if (profile.credits < cost) return false;

  profile.credits -= cost;
  profile.upgrades[def.id] += 1;
  return true;
}

/**
 * Computed player ship stats based on current upgrade levels.
 */
export type PlayerStats = {
  maxSpeed: number;
  accel: number;
  turnRate: number;
  maxShield: number;
  shieldRegen: number;
  maxHp: number;
  damage: number;
  weaponCooldown: number;
};

/**
 * Compute player ship stats from upgrade levels.
 */
export function computePlayerStats(upgrades: Upgrades): PlayerStats {
  const base = getFighterArchetype("xwing_player");
  const engineLvl = upgrades.engine;
  const maneuverLvl = upgrades.maneuver;
  const shieldLvl = upgrades.shields;
  const laserLvl = upgrades.lasers;
  const hullLvl = upgrades.hull;

  return {
    maxSpeed: base.maxSpeed * (1 + engineLvl * 0.06),
    accel: base.accel * (1 + engineLvl * 0.08),
    turnRate: base.turnRate * (1 + maneuverLvl * 0.08),
    maxShield: 60 + shieldLvl * 14,
    shieldRegen: 6 + shieldLvl * 0.8,
    maxHp: base.hp + hullLvl * 16,
    damage: base.damage * (1 + laserLvl * 0.08),
    weaponCooldown: Math.max(0.06, base.weaponCooldown * (1 - laserLvl * 0.03))
  };
}
