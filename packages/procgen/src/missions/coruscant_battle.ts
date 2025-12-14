/**
 * Battle of Coruscant - Iconic ROTS Opening Mission
 *
 * Multi-phase mission recreating the epic space battle from
 * Star Wars Episode III: Revenge of the Sith (19 BBY).
 *
 * Based on canonical sources:
 * - https://starwars.fandom.com/wiki/Battle_of_Coruscant
 * - https://starwars.fandom.com/wiki/Vulture-class_starfighter/Legends
 * - https://starwars.fandom.com/wiki/Droid_tri-fighter
 * - https://starwars.fandom.com/wiki/Pistoeka_sabotage_droid
 */

import type { FactionId } from "@xwingz/data";
import type { Seed } from "../seed";

// ============================================================================
// MISSION TYPE DEFINITIONS
// ============================================================================

export type MissionPhaseId =
  | "briefing"
  | "launch"
  | "capital_assault"
  | "cruiser_defense"
  | "buzzdroid_emergency"
  | "invisible_hand_assault"
  | "victory"
  | "defeat";

export type WaveSpawnConfig = {
  archetypeId: CoruscantFighterArchetypeId;
  count: number;
  formation: "swarm" | "wedge" | "line" | "scattered";
  spawnPosition: { x: [number, number]; y: [number, number]; z: [number, number] };
  delaySeconds: number;
  targetPriority: "player" | "allies" | "capital_ship" | "nearest";
  aggressionOverride?: number;
};

export type MissionPhase = {
  id: MissionPhaseId;
  name: string;
  description: string;
  objectives: MissionObjective[];
  waves: WaveSpawnConfig[];
  dialogue: DialogueTrigger[];
  durationSeconds?: number; // Optional time limit for phase
  environmentEffects?: EnvironmentEffect[];
  onEnter?: PhaseTransitionAction[];
  onExit?: PhaseTransitionAction[];
  victoryCondition: VictoryCondition;
  failureCondition: FailureCondition;
};

export type MissionObjective = {
  id: string;
  type: "destroy" | "defend" | "survive" | "reach" | "escort";
  target: string;
  count?: number;
  timeLimit?: number;
  optional?: boolean;
  description: string;
  hudText: string;
};

export type DialogueTrigger = {
  id: string;
  trigger: "phase_start" | "time" | "enemy_count" | "ally_damaged" | "player_damaged" | "objective_complete";
  triggerValue?: number;
  speaker: string;
  callsign?: string;
  text: string;
  durationSeconds: number;
  priority: "critical" | "high" | "normal" | "ambient";
};

export type EnvironmentEffect = {
  type: "debris_field" | "capital_ship_fire" | "explosion_chain" | "hyperspace_arrival";
  intensity: number;
  position?: { x: number; y: number; z: number };
  radius?: number;
};

export type PhaseTransitionAction = {
  type: "spawn_capital_ship" | "destroy_entity" | "heal_allies" | "trigger_event" | "play_effect";
  params: Record<string, unknown>;
};

export type VictoryCondition = {
  type: "all_enemies_destroyed" | "objective_complete" | "survive_time" | "reach_target";
  params?: Record<string, unknown>;
};

export type FailureCondition = {
  type: "player_destroyed" | "ally_destroyed" | "objective_failed" | "time_expired";
  target?: string;
  threshold?: number;
};

// ============================================================================
// SEPARATIST FIGHTER ARCHETYPES (Clone Wars Era)
// ============================================================================

export type CoruscantFighterArchetypeId =
  | "eta2_jedi_interceptor"  // Player ship
  | "arc170"                  // Republic heavy fighter
  | "v19_torrent"             // Clone escort fighter
  | "vwing"                   // Republic interceptor
  | "vulture_droid"           // CIS standard fighter
  | "tri_fighter"             // CIS advanced fighter
  | "hyena_bomber"            // CIS bomber
  | "droid_gunship";          // CIS heavy support

export type CoruscantFighterArchetype = {
  id: CoruscantFighterArchetypeId;
  name: string;
  faction: "republic" | "separatist";
  tags: string[];

  // Flight characteristics
  maxSpeed: number;
  accel: number;
  turnRate: number;

  // Weapons
  weaponCooldown: number;
  projectileSpeed: number;
  damage: number;
  burstSize?: number;
  secondaryWeapon?: "proton_torpedo" | "discord_missile" | "concussion_missile";
  secondaryAmmo?: number;

  // Durability
  hp: number;
  shieldHp: number;
  shieldRegenRate: number;
  hitRadius: number;

  // AI behavior
  aggression: number;
  evadeBias: number;
  formationTendency: number;

  // Visual/mesh identifier
  meshId: string;

  // Special abilities
  abilities?: SpecialAbility[];
};

export type SpecialAbility = {
  id: "buzzdroid_launch" | "strafe_run" | "evasive_roll" | "linked_fire";
  cooldown: number;
  params?: Record<string, unknown>;
};

/**
 * Clone Wars era fighter definitions for Battle of Coruscant.
 * Stats balanced relative to existing game archetypes.
 */
export const CORUSCANT_FIGHTER_ARCHETYPES: CoruscantFighterArchetype[] = [
  // ========== REPUBLIC FORCES ==========
  {
    id: "eta2_jedi_interceptor",
    name: "Eta-2 Actis Interceptor",
    faction: "republic",
    tags: ["player", "jedi", "interceptor", "agile"],
    maxSpeed: 310,
    accel: 180,
    turnRate: 1.85,
    weaponCooldown: 0.09,
    projectileSpeed: 1000,
    damage: 12,
    burstSize: 2,
    secondaryWeapon: "proton_torpedo",
    secondaryAmmo: 4,
    hp: 100,
    shieldHp: 50,
    shieldRegenRate: 8,
    hitRadius: 8,
    aggression: 0.7,
    evadeBias: 0.6,
    formationTendency: 0.3,
    meshId: "eta2_interceptor",
    abilities: [{ id: "evasive_roll", cooldown: 8 }]
  },
  {
    id: "arc170",
    name: "ARC-170 Starfighter",
    faction: "republic",
    tags: ["fighter", "heavy", "clone", "bomber_escort"],
    maxSpeed: 240,
    accel: 110,
    turnRate: 1.0,
    weaponCooldown: 0.12,
    projectileSpeed: 920,
    damage: 14,
    burstSize: 4,
    secondaryWeapon: "proton_torpedo",
    secondaryAmmo: 6,
    hp: 160,
    shieldHp: 80,
    shieldRegenRate: 6,
    hitRadius: 14,
    aggression: 0.65,
    evadeBias: 0.35,
    formationTendency: 0.7,
    meshId: "arc170"
  },
  {
    id: "v19_torrent",
    name: "V-19 Torrent Starfighter",
    faction: "republic",
    tags: ["fighter", "escort", "clone"],
    maxSpeed: 265,
    accel: 130,
    turnRate: 1.35,
    weaponCooldown: 0.14,
    projectileSpeed: 880,
    damage: 9,
    burstSize: 2,
    secondaryWeapon: "concussion_missile",
    secondaryAmmo: 4,
    hp: 90,
    shieldHp: 45,
    shieldRegenRate: 5,
    hitRadius: 10,
    aggression: 0.6,
    evadeBias: 0.5,
    formationTendency: 0.8,
    meshId: "v19_torrent"
  },
  {
    id: "vwing",
    name: "Alpha-3 Nimbus V-wing",
    faction: "republic",
    tags: ["interceptor", "fast", "clone"],
    maxSpeed: 295,
    accel: 160,
    turnRate: 1.65,
    weaponCooldown: 0.11,
    projectileSpeed: 950,
    damage: 8,
    burstSize: 2,
    hp: 70,
    shieldHp: 35,
    shieldRegenRate: 6,
    hitRadius: 8,
    aggression: 0.75,
    evadeBias: 0.55,
    formationTendency: 0.6,
    meshId: "vwing"
  },

  // ========== SEPARATIST FORCES ==========
  {
    id: "vulture_droid",
    name: "Vulture-class Droid Starfighter",
    faction: "separatist",
    tags: ["droid", "fighter", "swarm", "expendable"],
    maxSpeed: 275,
    accel: 145,
    turnRate: 1.45,
    weaponCooldown: 0.16,
    projectileSpeed: 850,
    damage: 7,
    burstSize: 2,
    hp: 45,
    shieldHp: 0,  // No shields - canonical
    shieldRegenRate: 0,
    hitRadius: 9,
    aggression: 0.8,
    evadeBias: 0.25,
    formationTendency: 0.9,
    meshId: "vulture_droid"
  },
  {
    id: "tri_fighter",
    name: "Droid Tri-Fighter",
    faction: "separatist",
    tags: ["droid", "fighter", "elite", "dogfighter"],
    maxSpeed: 290,
    accel: 155,
    turnRate: 1.7,
    weaponCooldown: 0.13,
    projectileSpeed: 900,
    damage: 10,
    burstSize: 3,
    secondaryWeapon: "discord_missile",
    secondaryAmmo: 2,
    hp: 55,
    shieldHp: 0,
    shieldRegenRate: 0,
    hitRadius: 7,
    aggression: 0.85,
    evadeBias: 0.4,
    formationTendency: 0.5,
    meshId: "tri_fighter",
    abilities: [{ id: "buzzdroid_launch", cooldown: 30, params: { count: 4 } }]
  },
  {
    id: "hyena_bomber",
    name: "Hyena-class Bomber",
    faction: "separatist",
    tags: ["droid", "bomber", "heavy", "anti_capital"],
    maxSpeed: 210,
    accel: 95,
    turnRate: 0.85,
    weaponCooldown: 0.22,
    projectileSpeed: 780,
    damage: 8,
    burstSize: 2,
    secondaryWeapon: "proton_torpedo",
    secondaryAmmo: 8,
    hp: 80,
    shieldHp: 0,
    shieldRegenRate: 0,
    hitRadius: 12,
    aggression: 0.5,
    evadeBias: 0.2,
    formationTendency: 0.95,
    meshId: "hyena_bomber"
  },
  {
    id: "droid_gunship",
    name: "HMP Droid Gunship",
    faction: "separatist",
    tags: ["droid", "gunship", "heavy", "suppression"],
    maxSpeed: 180,
    accel: 70,
    turnRate: 0.6,
    weaponCooldown: 0.08,
    projectileSpeed: 750,
    damage: 5,
    burstSize: 6,
    secondaryWeapon: "concussion_missile",
    secondaryAmmo: 12,
    hp: 200,
    shieldHp: 0,
    shieldRegenRate: 0,
    hitRadius: 18,
    aggression: 0.4,
    evadeBias: 0.1,
    formationTendency: 0.3,
    meshId: "droid_gunship"
  }
];

// ============================================================================
// CAPITAL SHIP DEFINITIONS
// ============================================================================

export type CapitalShipId =
  | "venator_star_destroyer"
  | "providence_destroyer"
  | "invisible_hand"
  | "munificent_frigate"
  | "recusant_destroyer";

export type CapitalShip = {
  id: CapitalShipId;
  name: string;
  faction: "republic" | "separatist";
  hp: number;
  shieldHp: number;
  length: number; // meters, for scale reference
  turrets: TurretConfig[];
  hangarCapacity: number;
  weakPoints?: WeakPoint[];
  meshId: string;
};

export type TurretConfig = {
  type: "light" | "medium" | "heavy" | "flak";
  count: number;
  damage: number;
  range: number;
  fireRate: number;
  trackingSpeed: number;
};

export type WeakPoint = {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  damageMultiplier: number;
  description: string;
};

export const CORUSCANT_CAPITAL_SHIPS: CapitalShip[] = [
  {
    id: "venator_star_destroyer",
    name: "Venator-class Star Destroyer",
    faction: "republic",
    hp: 15000,
    shieldHp: 8000,
    length: 1137,
    turrets: [
      { type: "heavy", count: 8, damage: 200, range: 3000, fireRate: 0.3, trackingSpeed: 0.2 },
      { type: "medium", count: 16, damage: 80, range: 2000, fireRate: 0.8, trackingSpeed: 0.5 },
      { type: "flak", count: 32, damage: 15, range: 800, fireRate: 3.0, trackingSpeed: 1.5 }
    ],
    hangarCapacity: 420,
    meshId: "venator"
  },
  {
    id: "providence_destroyer",
    name: "Providence-class Carrier/Destroyer",
    faction: "separatist",
    hp: 12000,
    shieldHp: 6000,
    length: 1088,
    turrets: [
      { type: "heavy", count: 14, damage: 180, range: 2800, fireRate: 0.35, trackingSpeed: 0.25 },
      { type: "medium", count: 34, damage: 60, range: 1800, fireRate: 1.0, trackingSpeed: 0.6 },
      { type: "flak", count: 48, damage: 12, range: 600, fireRate: 4.0, trackingSpeed: 2.0 }
    ],
    hangarCapacity: 240,
    meshId: "providence"
  },
  {
    id: "invisible_hand",
    name: "Invisible Hand",
    faction: "separatist",
    hp: 18000,
    shieldHp: 10000,
    length: 1088,
    turrets: [
      { type: "heavy", count: 18, damage: 220, range: 3200, fireRate: 0.3, trackingSpeed: 0.2 },
      { type: "medium", count: 40, damage: 70, range: 2000, fireRate: 0.9, trackingSpeed: 0.55 },
      { type: "flak", count: 60, damage: 14, range: 700, fireRate: 3.5, trackingSpeed: 1.8 }
    ],
    hangarCapacity: 300,
    weakPoints: [
      {
        id: "bridge",
        position: { x: 0, y: 85, z: -380 },
        radius: 25,
        damageMultiplier: 3.0,
        description: "Bridge command tower"
      },
      {
        id: "hangar_shield",
        position: { x: 0, y: -20, z: 100 },
        radius: 40,
        damageMultiplier: 2.0,
        description: "Main hangar shield generator"
      },
      {
        id: "engine_array",
        position: { x: 0, y: 0, z: 500 },
        radius: 60,
        damageMultiplier: 2.5,
        description: "Main engine cluster"
      }
    ],
    meshId: "invisible_hand"
  },
  {
    id: "munificent_frigate",
    name: "Munificent-class Star Frigate",
    faction: "separatist",
    hp: 6000,
    shieldHp: 3000,
    length: 825,
    turrets: [
      { type: "heavy", count: 2, damage: 250, range: 3500, fireRate: 0.2, trackingSpeed: 0.15 },
      { type: "medium", count: 12, damage: 50, range: 1500, fireRate: 1.2, trackingSpeed: 0.7 },
      { type: "flak", count: 20, damage: 10, range: 500, fireRate: 4.5, trackingSpeed: 2.2 }
    ],
    hangarCapacity: 40,
    meshId: "munificent"
  },
  {
    id: "recusant_destroyer",
    name: "Recusant-class Light Destroyer",
    faction: "separatist",
    hp: 8000,
    shieldHp: 4000,
    length: 1187,
    turrets: [
      { type: "heavy", count: 5, damage: 160, range: 2600, fireRate: 0.4, trackingSpeed: 0.3 },
      { type: "medium", count: 20, damage: 55, range: 1600, fireRate: 1.1, trackingSpeed: 0.65 },
      { type: "flak", count: 28, damage: 11, range: 550, fireRate: 4.2, trackingSpeed: 2.0 }
    ],
    hangarCapacity: 80,
    meshId: "recusant"
  }
];

// ============================================================================
// BUZZ DROID HAZARD SYSTEM
// ============================================================================

export type BuzzDroidSwarm = {
  id: string;
  count: number;
  attachedToEid: number;
  damagePerSecond: number;
  timeAttached: number;

  // Systems being damaged
  targetingSystems: boolean;  // Disables targeting
  shieldSystems: boolean;     // Prevents shield regen
  weaponSystems: boolean;     // Reduces fire rate
  flightSystems: boolean;     // Reduces maneuverability
};

export type BuzzDroidConfig = {
  damagePerSecond: number;
  systemDisableChance: number;
  detachDamageThreshold: number;  // Damage needed to shake them off
  barrelRollDetachChance: number; // Chance to detach via evasive maneuver
  allyAssistRange: number;        // Range at which ally can shoot them off
};

export const BUZZDROID_CONFIG: BuzzDroidConfig = {
  damagePerSecond: 8,
  systemDisableChance: 0.15,
  detachDamageThreshold: 25,
  barrelRollDetachChance: 0.4,
  allyAssistRange: 150
};

// ============================================================================
// MISSION DEFINITION
// ============================================================================

export type CoruscantMissionDef = {
  id: string;
  seed: Seed;
  title: string;
  subtitle: string;
  era: "clone_wars";
  description: string;
  briefing: BriefingSection[];
  phases: MissionPhase[];
  difficulty: "easy" | "normal" | "hard" | "legendary";

  // Environment
  backdrop: CoruscantBackdrop;
  capitalShipPositions: CapitalShipPlacement[];
  debrisFields: DebrisField[];

  // Rewards
  baseCredits: number;
  bonusObjectives: BonusObjective[];

  // Player loadout
  playerShip: CoruscantFighterArchetypeId;
  wingmen: WingmanConfig[];
};

export type BriefingSection = {
  speaker: string;
  portrait?: string;
  text: string;
  durationSeconds: number;
};

export type CoruscantBackdrop = {
  planetVisible: boolean;
  planetPosition: { x: number; y: number; z: number };
  cityLightsIntensity: number;  // 0-1, the famous Coruscant night lights
  atmosphericHaze: number;
  sunDirection: { x: number; y: number; z: number };
  battleDensity: number;  // Background explosions, laser fire
};

export type CapitalShipPlacement = {
  shipId: CapitalShipId;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  team: number;
  isObjective: boolean;
  displayName?: string;
};

export type DebrisField = {
  center: { x: number; y: number; z: number };
  radius: number;
  density: number;
  debrisTypes: ("hull_fragment" | "antenna" | "turret" | "escape_pod")[];
  damageOnCollision: number;
};

export type BonusObjective = {
  id: string;
  description: string;
  condition: "no_ally_deaths" | "time_limit" | "destroy_all" | "no_damage";
  value?: number;
  creditBonus: number;
};

export type WingmanConfig = {
  callsign: string;
  archetypeId: CoruscantFighterArchetypeId;
  personality: "aggressive" | "defensive" | "balanced";
  dialogue: string[];
};

// ============================================================================
// BATTLE OF CORUSCANT MISSION CONFIGURATION
// ============================================================================

export function createCoruscantBattleMission(seed: Seed, difficulty: "easy" | "normal" | "hard" | "legendary" = "normal"): CoruscantMissionDef {
  const difficultyScalars = {
    easy: { enemyCount: 0.6, enemyHp: 0.8, allyCount: 1.3, allyHp: 1.2 },
    normal: { enemyCount: 1.0, enemyHp: 1.0, allyCount: 1.0, allyHp: 1.0 },
    hard: { enemyCount: 1.4, enemyHp: 1.2, allyCount: 0.8, allyHp: 0.9 },
    legendary: { enemyCount: 1.8, enemyHp: 1.5, allyCount: 0.6, allyHp: 0.8 }
  };
  const scale = difficultyScalars[difficulty];

  return {
    id: "coruscant_battle",
    seed,
    title: "Battle of Coruscant",
    subtitle: "The Republic's Darkest Hour",
    era: "clone_wars",
    description: "General Grievous has launched a massive assault on Coruscant itself. The Chancellor has been kidnapped. Break through the Separatist blockade and rescue the Supreme Chancellor from the Invisible Hand.",

    briefing: [
      {
        speaker: "Admiral Yularen",
        portrait: "yularen",
        text: "All squadrons, this is Admiral Yularen aboard the Resolute. The Separatists have caught us off guard. General Grievous's fleet has engaged our defense fleet in orbit.",
        durationSeconds: 6
      },
      {
        speaker: "Admiral Yularen",
        portrait: "yularen",
        text: "The Chancellor's diplomatic shuttle was intercepted. Intelligence confirms he is being held aboard Grievous's flagship, the Invisible Hand.",
        durationSeconds: 5
      },
      {
        speaker: "Obi-Wan Kenobi",
        portrait: "obiwan",
        text: "Anakin, we need to punch through their fighter screen and disable the Invisible Hand before they can jump to hyperspace.",
        durationSeconds: 4
      },
      {
        speaker: "Anakin Skywalker",
        portrait: "anakin",
        text: "Lock S-foils in attack position. Clone Flight Seven, on my wing. Let's remind these clankers why they should have stayed in the Outer Rim.",
        durationSeconds: 5
      }
    ],

    phases: [
      // ======== PHASE 1: CAPITAL SHIP ENGAGEMENT ========
      {
        id: "capital_assault",
        name: "Break the Blockade",
        description: "Engage Separatist capital ships and clear a path to the Invisible Hand.",
        objectives: [
          {
            id: "destroy_munificent_1",
            type: "destroy",
            target: "munificent_alpha",
            description: "Destroy the Munificent-class frigate blocking approach vector",
            hudText: "DESTROY: Banking Clan Frigate"
          },
          {
            id: "protect_venator",
            type: "defend",
            target: "resolute",
            description: "Protect the Resolute from bomber attacks",
            hudText: "DEFEND: Resolute (Shield: {hp}%)"
          }
        ],
        waves: [
          {
            archetypeId: "vulture_droid",
            count: Math.round(12 * scale.enemyCount),
            formation: "swarm",
            spawnPosition: { x: [-800, 800], y: [-200, 200], z: [-3000, -2500] },
            delaySeconds: 0,
            targetPriority: "nearest"
          },
          {
            archetypeId: "tri_fighter",
            count: Math.round(6 * scale.enemyCount),
            formation: "wedge",
            spawnPosition: { x: [-400, 400], y: [100, 300], z: [-2800, -2400] },
            delaySeconds: 15,
            targetPriority: "player"
          },
          {
            archetypeId: "hyena_bomber",
            count: Math.round(4 * scale.enemyCount),
            formation: "line",
            spawnPosition: { x: [-600, 600], y: [-100, 100], z: [-3200, -2800] },
            delaySeconds: 30,
            targetPriority: "capital_ship"
          },
          {
            archetypeId: "vulture_droid",
            count: Math.round(8 * scale.enemyCount),
            formation: "scattered",
            spawnPosition: { x: [-1000, 1000], y: [-300, 300], z: [-2600, -2200] },
            delaySeconds: 45,
            targetPriority: "allies"
          }
        ],
        dialogue: [
          {
            id: "phase1_start",
            trigger: "phase_start",
            speaker: "Clone Pilot",
            callsign: "Oddball",
            text: "General Skywalker, enemy fighters inbound! Vulture droids at mark three-five!",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "bomber_warning",
            trigger: "time",
            triggerValue: 28,
            speaker: "Clone Pilot",
            callsign: "Hawk",
            text: "Hyena bombers targeting the Resolute! Intercept those clankers!",
            durationSeconds: 3,
            priority: "critical"
          },
          {
            id: "tri_fighters_spotted",
            trigger: "time",
            triggerValue: 14,
            speaker: "Obi-Wan Kenobi",
            text: "Tri-fighters incoming. They're more maneuverable than vulture droids - watch your six.",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "halfway_encouragement",
            trigger: "enemy_count",
            triggerValue: 15,
            speaker: "Anakin Skywalker",
            text: "That's it, keep up the pressure! We're cutting right through them!",
            durationSeconds: 2,
            priority: "normal"
          }
        ],
        environmentEffects: [
          { type: "capital_ship_fire", intensity: 0.7 },
          { type: "explosion_chain", intensity: 0.4, position: { x: 500, y: 100, z: -1500 }, radius: 300 }
        ],
        victoryCondition: { type: "all_enemies_destroyed" },
        failureCondition: { type: "ally_destroyed", target: "resolute", threshold: 0.3 }
      },

      // ======== PHASE 2: CRUISER DEFENSE ========
      {
        id: "cruiser_defense",
        name: "Hold the Line",
        description: "Defend Republic cruisers while they reposition for the assault on the Invisible Hand.",
        objectives: [
          {
            id: "survive_assault",
            type: "survive",
            target: "player",
            timeLimit: 90,
            description: "Survive the Separatist counterattack",
            hudText: "SURVIVE: {time} seconds remaining"
          },
          {
            id: "protect_cruisers",
            type: "defend",
            target: "republic_cruisers",
            count: 2,
            description: "At least 2 Republic cruisers must survive",
            hudText: "PROTECT: Republic Cruisers ({count}/3)"
          }
        ],
        waves: [
          {
            archetypeId: "vulture_droid",
            count: Math.round(16 * scale.enemyCount),
            formation: "swarm",
            spawnPosition: { x: [-1200, 1200], y: [-400, 400], z: [-2000, -1600] },
            delaySeconds: 0,
            targetPriority: "capital_ship"
          },
          {
            archetypeId: "tri_fighter",
            count: Math.round(8 * scale.enemyCount),
            formation: "wedge",
            spawnPosition: { x: [-500, 500], y: [200, 400], z: [-1800, -1400] },
            delaySeconds: 20,
            targetPriority: "player",
            aggressionOverride: 0.9
          },
          {
            archetypeId: "droid_gunship",
            count: Math.round(2 * scale.enemyCount),
            formation: "line",
            spawnPosition: { x: [-300, 300], y: [-50, 50], z: [-2200, -1800] },
            delaySeconds: 40,
            targetPriority: "allies"
          },
          {
            archetypeId: "vulture_droid",
            count: Math.round(12 * scale.enemyCount),
            formation: "scattered",
            spawnPosition: { x: [-1000, 1000], y: [-200, 200], z: [-1600, -1200] },
            delaySeconds: 60,
            targetPriority: "nearest"
          },
          {
            archetypeId: "hyena_bomber",
            count: Math.round(6 * scale.enemyCount),
            formation: "wedge",
            spawnPosition: { x: [-800, 800], y: [100, 300], z: [-2000, -1600] },
            delaySeconds: 75,
            targetPriority: "capital_ship"
          }
        ],
        dialogue: [
          {
            id: "phase2_start",
            trigger: "phase_start",
            speaker: "Admiral Yularen",
            text: "All fighters, the fleet is repositioning. Buy us 90 seconds to bring our heavy guns to bear!",
            durationSeconds: 4,
            priority: "critical"
          },
          {
            id: "gunship_warning",
            trigger: "time",
            triggerValue: 38,
            speaker: "Clone Pilot",
            callsign: "Axe",
            text: "Droid gunships! Those things will shred our wingmen - focus fire!",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "cruiser_damaged",
            trigger: "ally_damaged",
            speaker: "Clone Commander",
            text: "The Integrity is taking heavy fire! We need fighter cover NOW!",
            durationSeconds: 3,
            priority: "critical"
          },
          {
            id: "halfway_phase2",
            trigger: "time",
            triggerValue: 45,
            speaker: "Obi-Wan Kenobi",
            text: "Halfway there. Keep them off the cruisers!",
            durationSeconds: 2,
            priority: "normal"
          },
          {
            id: "final_push",
            trigger: "time",
            triggerValue: 80,
            speaker: "Admiral Yularen",
            text: "Ten seconds! All batteries preparing to fire!",
            durationSeconds: 2,
            priority: "high"
          }
        ],
        durationSeconds: 90,
        victoryCondition: { type: "survive_time", params: { seconds: 90 } },
        failureCondition: { type: "ally_destroyed", target: "republic_cruisers", threshold: 2 }
      },

      // ======== PHASE 3: BUZZ DROID EMERGENCY ========
      {
        id: "buzzdroid_emergency",
        name: "Buzz Droid Attack",
        description: "Discord missiles have deployed buzz droids on your ship! Shake them off before critical systems fail.",
        objectives: [
          {
            id: "remove_buzzdroids",
            type: "survive",
            target: "player",
            description: "Remove buzz droids from your fighter",
            hudText: "EMERGENCY: Buzz Droids Attached! (Barrel roll or call for assistance)"
          },
          {
            id: "help_obiwan",
            type: "escort",
            target: "obiwan_ship",
            optional: true,
            description: "Help Obi-Wan remove his buzz droids",
            hudText: "ASSIST: General Kenobi (Optional)"
          }
        ],
        waves: [
          {
            archetypeId: "tri_fighter",
            count: Math.round(4 * scale.enemyCount),
            formation: "scattered",
            spawnPosition: { x: [-300, 300], y: [-100, 100], z: [-800, -400] },
            delaySeconds: 5,
            targetPriority: "player"
          }
        ],
        dialogue: [
          {
            id: "buzzdroid_hit",
            trigger: "phase_start",
            speaker: "R2-D2",
            text: "*frantic beeping*",
            durationSeconds: 2,
            priority: "critical"
          },
          {
            id: "anakin_reacts",
            trigger: "time",
            triggerValue: 1,
            speaker: "Anakin Skywalker",
            text: "I'm hit! Buzz droids!",
            durationSeconds: 2,
            priority: "critical"
          },
          {
            id: "obiwan_hit_too",
            trigger: "time",
            triggerValue: 3,
            speaker: "Obi-Wan Kenobi",
            text: "They're all over me! R4, do something! ...R4?",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "r4_destroyed",
            trigger: "time",
            triggerValue: 6,
            speaker: "Obi-Wan Kenobi",
            text: "Oh dear. Anakin, I could use some help here.",
            durationSeconds: 2,
            priority: "high"
          },
          {
            id: "barrel_roll_hint",
            trigger: "time",
            triggerValue: 8,
            speaker: "Clone Pilot",
            callsign: "Oddball",
            text: "General, try a barrel roll! Might shake some of those things loose!",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "r2_saves_day",
            trigger: "time",
            triggerValue: 15,
            speaker: "Anakin Skywalker",
            text: "Get 'em R2! Good job, buddy!",
            durationSeconds: 2,
            priority: "normal"
          }
        ],
        environmentEffects: [
          { type: "debris_field", intensity: 0.3 }
        ],
        onEnter: [
          { type: "trigger_event", params: { event: "attach_buzzdroids_to_player", count: 4 } },
          { type: "trigger_event", params: { event: "attach_buzzdroids_to_obiwan", count: 6 } }
        ],
        victoryCondition: { type: "objective_complete", params: { objective: "remove_buzzdroids" } },
        failureCondition: { type: "player_destroyed" }
      },

      // ======== PHASE 4: ASSAULT ON THE INVISIBLE HAND ========
      {
        id: "invisible_hand_assault",
        name: "The Invisible Hand",
        description: "Disable the Invisible Hand's hangar shields to allow boarding. General Grievous must not escape.",
        objectives: [
          {
            id: "destroy_shield_generator",
            type: "destroy",
            target: "hangar_shield_generator",
            description: "Destroy the hangar shield generator",
            hudText: "DESTROY: Hangar Shield Generator"
          },
          {
            id: "clear_hangar_approach",
            type: "destroy",
            target: "hangar_defenders",
            count: Math.round(8 * scale.enemyCount),
            description: "Clear the hangar approach of enemy fighters",
            hudText: "CLEAR: Hangar Approach ({kills}/{target})"
          },
          {
            id: "prevent_escape",
            type: "defend",
            target: "invisible_hand",
            timeLimit: 180,
            description: "Prevent the Invisible Hand from escaping to hyperspace",
            hudText: "OBJECTIVE: Prevent Escape ({time}s)"
          }
        ],
        waves: [
          {
            archetypeId: "vulture_droid",
            count: Math.round(8 * scale.enemyCount),
            formation: "swarm",
            spawnPosition: { x: [-400, 400], y: [-150, 150], z: [-1200, -800] },
            delaySeconds: 0,
            targetPriority: "player"
          },
          {
            archetypeId: "tri_fighter",
            count: Math.round(6 * scale.enemyCount),
            formation: "wedge",
            spawnPosition: { x: [-300, 300], y: [50, 200], z: [-1000, -600] },
            delaySeconds: 10,
            targetPriority: "player",
            aggressionOverride: 0.95
          },
          {
            archetypeId: "vulture_droid",
            count: Math.round(10 * scale.enemyCount),
            formation: "scattered",
            spawnPosition: { x: [-600, 600], y: [-200, 200], z: [-900, -500] },
            delaySeconds: 25,
            targetPriority: "allies"
          },
          {
            archetypeId: "tri_fighter",
            count: Math.round(4 * scale.enemyCount),
            formation: "line",
            spawnPosition: { x: [-200, 200], y: [100, 250], z: [-700, -400] },
            delaySeconds: 45,
            targetPriority: "player"
          },
          {
            archetypeId: "droid_gunship",
            count: Math.round(2 * scale.enemyCount),
            formation: "line",
            spawnPosition: { x: [-150, 150], y: [-50, 50], z: [-600, -300] },
            delaySeconds: 60,
            targetPriority: "nearest"
          },
          // Continuous reinforcements
          {
            archetypeId: "vulture_droid",
            count: Math.round(6 * scale.enemyCount),
            formation: "swarm",
            spawnPosition: { x: [-500, 500], y: [-100, 100], z: [-800, -400] },
            delaySeconds: 90,
            targetPriority: "nearest"
          },
          {
            archetypeId: "tri_fighter",
            count: Math.round(4 * scale.enemyCount),
            formation: "wedge",
            spawnPosition: { x: [-250, 250], y: [0, 150], z: [-600, -300] },
            delaySeconds: 120,
            targetPriority: "player"
          }
        ],
        dialogue: [
          {
            id: "phase4_start",
            trigger: "phase_start",
            speaker: "Obi-Wan Kenobi",
            text: "There's the Invisible Hand. Anakin, we need to take out those hangar shields.",
            durationSeconds: 3,
            priority: "critical"
          },
          {
            id: "grievous_taunt",
            trigger: "time",
            triggerValue: 5,
            speaker: "General Grievous",
            text: "Jedi! You will not take me! All batteries - FIRE!",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "shield_gen_spotted",
            trigger: "time",
            triggerValue: 12,
            speaker: "Anakin Skywalker",
            text: "I see the shield generator - it's exposed on the ventral hull. Cover me!",
            durationSeconds: 3,
            priority: "high"
          },
          {
            id: "heavy_resistance",
            trigger: "time",
            triggerValue: 40,
            speaker: "Clone Pilot",
            callsign: "Hawk",
            text: "Heavy resistance! They're throwing everything at us!",
            durationSeconds: 2,
            priority: "normal"
          },
          {
            id: "shield_down",
            trigger: "objective_complete",
            speaker: "Obi-Wan Kenobi",
            text: "Shields are down! The hangar is open - move in!",
            durationSeconds: 3,
            priority: "critical"
          },
          {
            id: "almost_there",
            trigger: "enemy_count",
            triggerValue: 5,
            speaker: "Anakin Skywalker",
            text: "Almost there! Just a few more and we're clear!",
            durationSeconds: 2,
            priority: "normal"
          }
        ],
        environmentEffects: [
          { type: "capital_ship_fire", intensity: 0.9 },
          { type: "debris_field", intensity: 0.5 },
          { type: "explosion_chain", intensity: 0.6, position: { x: 0, y: -50, z: -200 }, radius: 200 }
        ],
        victoryCondition: { type: "all_enemies_destroyed" },
        failureCondition: { type: "time_expired", threshold: 180 }
      },

      // ======== VICTORY PHASE ========
      {
        id: "victory",
        name: "Victory",
        description: "The hangar is clear. Proceed with the rescue operation.",
        objectives: [],
        waves: [],
        dialogue: [
          {
            id: "mission_complete",
            trigger: "phase_start",
            speaker: "Anakin Skywalker",
            text: "We're in! Time to rescue the Chancellor.",
            durationSeconds: 3,
            priority: "critical"
          },
          {
            id: "landing_call",
            trigger: "time",
            triggerValue: 3,
            speaker: "Obi-Wan Kenobi",
            text: "Set down in the hangar. And try not to crash this time.",
            durationSeconds: 3,
            priority: "normal"
          },
          {
            id: "clone_support",
            trigger: "time",
            triggerValue: 6,
            speaker: "Admiral Yularen",
            text: "Excellent work, Generals. The fleet will maintain pressure while you complete the rescue.",
            durationSeconds: 4,
            priority: "high"
          }
        ],
        victoryCondition: { type: "objective_complete" },
        failureCondition: { type: "player_destroyed" }
      }
    ],

    difficulty,

    backdrop: {
      planetVisible: true,
      planetPosition: { x: 0, y: -8000, z: -5000 },
      cityLightsIntensity: 0.85,
      atmosphericHaze: 0.3,
      sunDirection: { x: 0.5, y: 0.3, z: -0.8 },
      battleDensity: 0.8
    },

    capitalShipPositions: [
      // Republic Fleet
      {
        shipId: "venator_star_destroyer",
        position: { x: 0, y: 0, z: 500 },
        rotation: { x: 0, y: Math.PI, z: 0 },
        team: 0,
        isObjective: true,
        displayName: "Resolute"
      },
      {
        shipId: "venator_star_destroyer",
        position: { x: -800, y: 100, z: 300 },
        rotation: { x: 0.05, y: Math.PI + 0.2, z: 0.02 },
        team: 0,
        isObjective: true,
        displayName: "Integrity"
      },
      {
        shipId: "venator_star_destroyer",
        position: { x: 700, y: -50, z: 400 },
        rotation: { x: -0.03, y: Math.PI - 0.15, z: 0.01 },
        team: 0,
        isObjective: true,
        displayName: "Guarlara"
      },
      // Separatist Fleet
      {
        shipId: "invisible_hand",
        position: { x: 0, y: 200, z: -2000 },
        rotation: { x: 0, y: 0, z: 0 },
        team: 1,
        isObjective: true,
        displayName: "Invisible Hand"
      },
      {
        shipId: "providence_destroyer",
        position: { x: -600, y: 100, z: -1800 },
        rotation: { x: 0, y: 0.1, z: 0 },
        team: 1,
        isObjective: false
      },
      {
        shipId: "providence_destroyer",
        position: { x: 500, y: -100, z: -1900 },
        rotation: { x: 0, y: -0.1, z: 0 },
        team: 1,
        isObjective: false
      },
      {
        shipId: "munificent_frigate",
        position: { x: -300, y: 50, z: -1500 },
        rotation: { x: 0, y: 0.05, z: 0 },
        team: 1,
        isObjective: true,
        displayName: "Banking Clan Frigate"
      },
      {
        shipId: "recusant_destroyer",
        position: { x: 400, y: -80, z: -1600 },
        rotation: { x: 0, y: -0.05, z: 0 },
        team: 1,
        isObjective: false
      },
      {
        shipId: "munificent_frigate",
        position: { x: -900, y: 200, z: -2200 },
        rotation: { x: 0.02, y: 0.15, z: 0 },
        team: 1,
        isObjective: false
      }
    ],

    debrisFields: [
      {
        center: { x: -200, y: 50, z: -800 },
        radius: 400,
        density: 0.6,
        debrisTypes: ["hull_fragment", "antenna", "turret"],
        damageOnCollision: 15
      },
      {
        center: { x: 350, y: -30, z: -1200 },
        radius: 300,
        density: 0.4,
        debrisTypes: ["hull_fragment", "escape_pod"],
        damageOnCollision: 10
      },
      {
        center: { x: 0, y: 100, z: -1700 },
        radius: 500,
        density: 0.7,
        debrisTypes: ["hull_fragment", "antenna", "turret", "escape_pod"],
        damageOnCollision: 20
      }
    ],

    baseCredits: 2500,
    bonusObjectives: [
      {
        id: "no_ally_deaths",
        description: "Complete mission with no allied casualties",
        condition: "no_ally_deaths",
        creditBonus: 1000
      },
      {
        id: "speed_run",
        description: "Complete mission in under 8 minutes",
        condition: "time_limit",
        value: 480,
        creditBonus: 750
      },
      {
        id: "ace_pilot",
        description: "Destroy 50+ enemy fighters",
        condition: "destroy_all",
        value: 50,
        creditBonus: 500
      },
      {
        id: "untouchable",
        description: "Take no hull damage (shields only)",
        condition: "no_damage",
        creditBonus: 1500
      }
    ],

    playerShip: "eta2_jedi_interceptor",
    wingmen: [
      {
        callsign: "Obi-Wan",
        archetypeId: "eta2_jedi_interceptor",
        personality: "balanced",
        dialogue: [
          "I have a bad feeling about this.",
          "Stay focused, Anakin.",
          "Good shot!",
          "Watch your back!",
          "This is getting out of hand."
        ]
      },
      {
        callsign: "Oddball",
        archetypeId: "arc170",
        personality: "aggressive",
        dialogue: [
          "Oddball here, I'm on your wing!",
          "Splash one!",
          "Taking heavy fire!",
          "That's another one down!",
          "For the Republic!"
        ]
      },
      {
        callsign: "Hawk",
        archetypeId: "v19_torrent",
        personality: "defensive",
        dialogue: [
          "Hawk standing by.",
          "I'll cover you, General!",
          "Enemy on your six!",
          "Moving to intercept.",
          "Good kill!"
        ]
      },
      {
        callsign: "Axe",
        archetypeId: "vwing",
        personality: "aggressive",
        dialogue: [
          "Axe, locked and loaded!",
          "Got one!",
          "They're everywhere!",
          "Engaging!",
          "These clankers don't stand a chance!"
        ]
      }
    ]
  };
}

// ============================================================================
// HELPER FUNCTIONS FOR MISSION RUNTIME
// ============================================================================

/**
 * Get fighter archetype by ID with type safety
 */
export function getCoruscantFighterArchetype(id: CoruscantFighterArchetypeId): CoruscantFighterArchetype {
  const archetype = CORUSCANT_FIGHTER_ARCHETYPES.find(a => a.id === id);
  if (!archetype) {
    throw new Error(`Unknown Coruscant fighter archetype: ${id}`);
  }
  return archetype;
}

/**
 * Get capital ship config by ID
 */
export function getCapitalShip(id: CapitalShipId): CapitalShip {
  const ship = CORUSCANT_CAPITAL_SHIPS.find(s => s.id === id);
  if (!ship) {
    throw new Error(`Unknown capital ship: ${id}`);
  }
  return ship;
}

/**
 * Calculate spawn position from range config
 */
export function calculateSpawnPosition(
  config: WaveSpawnConfig["spawnPosition"],
  index: number,
  total: number,
  formation: WaveSpawnConfig["formation"],
  rng: { range: (min: number, max: number) => number }
): { x: number; y: number; z: number } {
  const baseX = rng.range(config.x[0], config.x[1]);
  const baseY = rng.range(config.y[0], config.y[1]);
  const baseZ = rng.range(config.z[0], config.z[1]);

  switch (formation) {
    case "swarm":
      // Random scatter around base position
      return {
        x: baseX + rng.range(-80, 80),
        y: baseY + rng.range(-40, 40),
        z: baseZ + rng.range(-60, 60)
      };

    case "wedge":
      // V-formation
      const wedgeAngle = (index - total / 2) * 0.3;
      const wedgeDepth = Math.abs(index - total / 2) * 30;
      return {
        x: baseX + Math.sin(wedgeAngle) * 50 * index,
        y: baseY + rng.range(-10, 10),
        z: baseZ + wedgeDepth
      };

    case "line":
      // Side-by-side line formation
      const lineSpacing = 60;
      const lineOffset = (index - total / 2) * lineSpacing;
      return {
        x: baseX + lineOffset,
        y: baseY + rng.range(-5, 5),
        z: baseZ
      };

    case "scattered":
    default:
      // Wide scatter
      return {
        x: baseX + rng.range(-150, 150),
        y: baseY + rng.range(-80, 80),
        z: baseZ + rng.range(-100, 100)
      };
  }
}

/**
 * Determine initial heading based on target priority and known positions
 */
export function calculateInitialHeading(
  spawnPos: { x: number; y: number; z: number },
  targetPriority: WaveSpawnConfig["targetPriority"],
  playerPos: { x: number; y: number; z: number },
  capitalShipPos?: { x: number; y: number; z: number }
): { qx: number; qy: number; qz: number; qw: number } {
  let targetPos: { x: number; y: number; z: number };

  switch (targetPriority) {
    case "player":
      targetPos = playerPos;
      break;
    case "capital_ship":
      targetPos = capitalShipPos ?? playerPos;
      break;
    case "allies":
    case "nearest":
    default:
      targetPos = playerPos; // Will be re-evaluated by AI
  }

  // Calculate direction to target
  const dx = targetPos.x - spawnPos.x;
  const dy = targetPos.y - spawnPos.y;
  const dz = targetPos.z - spawnPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < 0.001) {
    return { qx: 0, qy: 0, qz: 0, qw: 1 };
  }

  // Calculate yaw angle (rotation around Y axis)
  const yaw = Math.atan2(dx, -dz);

  // Simple quaternion from yaw (sufficient for initial heading)
  const halfYaw = yaw / 2;
  return {
    qx: 0,
    qy: Math.sin(halfYaw),
    qz: 0,
    qw: Math.cos(halfYaw)
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  MissionPhase as CoruscantMissionPhase,
  MissionObjective as CoruscantMissionObjective,
  DialogueTrigger as CoruscantDialogueTrigger,
  WaveSpawnConfig as CoruscantWaveSpawnConfig
};
