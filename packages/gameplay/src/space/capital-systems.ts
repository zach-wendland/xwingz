import { IWorld, addEntity, addComponent, defineQuery, removeEntity, hasComponent } from "bitecs";
import { Quaternion, Vector3 } from "@xwingz/core";
import {
  Transform,
  Velocity,
  Team,
  Health,
  HitRadius,
  Targetable,
} from "./components";
import {
  CapitalShipV2,
  Turret,
  Subsystem,
  TurretProjectile,
  WeakPointV2,
  ShipClass,
  SubsystemType,
  TurretType,
} from "./capital-components";
import { SeededRNG } from "@xwingz/core";
import { spaceCombatIndex } from "./spatial-index";

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export type TurretFireEvent = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  turretType: TurretType;
  team: number;
};

export type SubsystemDestroyedEvent = {
  shipEid: number;
  subsystemType: SubsystemType;
  x: number; y: number; z: number;
};

const turretFireEvents: TurretFireEvent[] = [];
const subsystemDestroyedEvents: SubsystemDestroyedEvent[] = [];

export function consumeTurretFireEvents(): TurretFireEvent[] {
  return turretFireEvents.splice(0, turretFireEvents.length);
}

export function consumeSubsystemDestroyedEvents(): SubsystemDestroyedEvent[] {
  return subsystemDestroyedEvents.splice(0, subsystemDestroyedEvents.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────────

const capitalShipQuery = defineQuery([CapitalShipV2, Transform, Velocity, Team]);
const turretQuery = defineQuery([Turret, Transform]);
const subsystemQuery = defineQuery([Subsystem, Transform]);
const turretProjectileQuery = defineQuery([TurretProjectile, Transform, Velocity]);
const weakPointQuery = defineQuery([WeakPointV2, Transform]);
const fighterTargetQuery = defineQuery([Health, HitRadius, Transform, Team]);

// Note: Spatial hash moved to spatial-index.ts (unified SpaceCombatSpatialIndex)
// Use rebuildSpaceCombatIndex() once per frame, then spaceCombatIndex.queryCombatants()

// ─────────────────────────────────────────────────────────────────────────────
// TEMP VECTORS
// ─────────────────────────────────────────────────────────────────────────────

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();
const tmpForward = new Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface TurretConfig {
  type: TurretType;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  yawMin?: number;
  yawMax?: number;
  pitchMin?: number;
  pitchMax?: number;
  damage?: number;
  range?: number;
  cooldown?: number;
}

export interface SubsystemConfig {
  type: SubsystemType;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  hitRadius?: number;
  maxHp?: number;
}

export interface CapitalShipParams {
  x?: number;
  y?: number;
  z?: number;
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
  team: number;
  shipClass: ShipClass;
  name?: string;
}

export interface SpawnedCapitalShip {
  shipEid: number;
  turretEids: number[];
  subsystemEids: number[];
  weakPointEids: number[];
}

/**
 * Spawn a capital ship with turrets and subsystems based on ship class.
 */
export function spawnCapitalShipV2(
  world: IWorld,
  params: CapitalShipParams
): SpawnedCapitalShip {
  const shipEid = addEntity(world);

  // Core components
  addComponent(world, Transform, shipEid);
  addComponent(world, Velocity, shipEid);
  addComponent(world, Team, shipEid);
  addComponent(world, CapitalShipV2, shipEid);
  addComponent(world, Targetable, shipEid);
  addComponent(world, Health, shipEid);
  addComponent(world, HitRadius, shipEid);

  // Position
  Transform.x[shipEid] = params.x ?? 0;
  Transform.y[shipEid] = params.y ?? 0;
  Transform.z[shipEid] = params.z ?? 0;
  Transform.qx[shipEid] = params.qx ?? 0;
  Transform.qy[shipEid] = params.qy ?? 0;
  Transform.qz[shipEid] = params.qz ?? 0;
  Transform.qw[shipEid] = params.qw ?? 1;

  Velocity.vx[shipEid] = 0;
  Velocity.vy[shipEid] = 0;
  Velocity.vz[shipEid] = 0;

  Team.id[shipEid] = params.team;

  // Ship class stats
  const stats = getShipClassStats(params.shipClass);
  CapitalShipV2.shipClass[shipEid] = params.shipClass;
  CapitalShipV2.length[shipEid] = stats.length;
  CapitalShipV2.hullFore[shipEid] = stats.hullPerSection;
  CapitalShipV2.hullMid[shipEid] = stats.hullPerSection;
  CapitalShipV2.hullAft[shipEid] = stats.hullPerSection;
  CapitalShipV2.hullForeMax[shipEid] = stats.hullPerSection;
  CapitalShipV2.hullMidMax[shipEid] = stats.hullPerSection;
  CapitalShipV2.hullAftMax[shipEid] = stats.hullPerSection;
  CapitalShipV2.shieldFront[shipEid] = stats.shieldMax / 2;
  CapitalShipV2.shieldRear[shipEid] = stats.shieldMax / 2;
  CapitalShipV2.shieldMax[shipEid] = stats.shieldMax;
  CapitalShipV2.shieldRegenRate[shipEid] = stats.shieldRegenRate;
  CapitalShipV2.shieldRegenDelay[shipEid] = 3.0;
  CapitalShipV2.shieldLastHit[shipEid] = 999;
  CapitalShipV2.throttle[shipEid] = 0;
  CapitalShipV2.maxSpeed[shipEid] = stats.maxSpeed;
  CapitalShipV2.accel[shipEid] = stats.accel;
  CapitalShipV2.turnRate[shipEid] = stats.turnRate;
  CapitalShipV2.hangarCapacity[shipEid] = stats.hangarCapacity;
  CapitalShipV2.hangarCurrent[shipEid] = 0;
  CapitalShipV2.spawnCooldown[shipEid] = 0;
  CapitalShipV2.spawnCooldownMax[shipEid] = 15;

  // Total health for targeting display
  Health.hp[shipEid] = stats.hullPerSection * 3;
  Health.maxHp[shipEid] = stats.hullPerSection * 3;
  HitRadius.r[shipEid] = stats.length / 2;

  // Spawn turrets
  const turretConfigs = getTurretLayout(params.shipClass);
  const turretEids: number[] = [];
  for (const cfg of turretConfigs) {
    const tid = spawnTurret(world, shipEid, cfg, params.team);
    turretEids.push(tid);
  }

  // Spawn subsystems
  const subsystemConfigs = getSubsystemLayout(params.shipClass);
  const subsystemEids: number[] = [];
  for (const cfg of subsystemConfigs) {
    const sid = spawnSubsystem(world, shipEid, cfg);
    subsystemEids.push(sid);
  }

  // Spawn weak points (hidden until power destroyed)
  const weakPointEids: number[] = [];
  const weakPoints = getWeakPointLayout(params.shipClass);
  for (const wp of weakPoints) {
    const wid = spawnWeakPoint(world, shipEid, wp);
    weakPointEids.push(wid);
  }

  return { shipEid, turretEids, subsystemEids, weakPointEids };
}

function spawnTurret(world: IWorld, parentEid: number, cfg: TurretConfig, team: number): number {
  const eid = addEntity(world);
  addComponent(world, Turret, eid);
  addComponent(world, Transform, eid);
  addComponent(world, Team, eid);

  Turret.parentEid[eid] = parentEid;
  Turret.offsetX[eid] = cfg.offsetX;
  Turret.offsetY[eid] = cfg.offsetY;
  Turret.offsetZ[eid] = cfg.offsetZ;
  Turret.turretType[eid] = cfg.type;
  Turret.barrelCount[eid] = cfg.type === TurretType.Heavy ? 2 : 1;
  Turret.yaw[eid] = 0;
  Turret.pitch[eid] = 0;
  Turret.yawTarget[eid] = 0;
  Turret.pitchTarget[eid] = 0;
  Turret.yawMin[eid] = cfg.yawMin ?? -Math.PI;
  Turret.yawMax[eid] = cfg.yawMax ?? Math.PI;
  Turret.pitchMin[eid] = cfg.pitchMin ?? -0.17; // -10 deg
  Turret.pitchMax[eid] = cfg.pitchMax ?? 1.05;  // 60 deg
  Turret.rotationSpeed[eid] = getTurretRotationSpeed(cfg.type);
  Turret.cooldown[eid] = cfg.cooldown ?? getTurretCooldown(cfg.type);
  // Use entity ID as seed for deterministic stagger
  const turretRng = new SeededRNG(eid);
  Turret.cooldownRemaining[eid] = turretRng.next() * Turret.cooldown[eid]; // Stagger
  Turret.damage[eid] = cfg.damage ?? getTurretDamage(cfg.type);
  Turret.range[eid] = cfg.range ?? getTurretRange(cfg.type);
  Turret.projectileSpeed[eid] = getTurretProjectileSpeed(cfg.type);
  Turret.targetEid[eid] = -1;
  Turret.targetPriority[eid] = cfg.type === TurretType.PointDefense ? 1 : 0;
  Turret.trackingAccuracy[eid] = 0.7 + turretRng.next() * 0.2;
  Turret.disabled[eid] = 0;

  Team.id[eid] = team;

  // Initial world position (will be updated by transform sync)
  Transform.x[eid] = 0;
  Transform.y[eid] = 0;
  Transform.z[eid] = 0;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  return eid;
}

function spawnSubsystem(world: IWorld, parentEid: number, cfg: SubsystemConfig): number {
  const eid = addEntity(world);
  addComponent(world, Subsystem, eid);
  addComponent(world, Transform, eid);
  addComponent(world, Targetable, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);

  Subsystem.parentEid[eid] = parentEid;
  Subsystem.offsetX[eid] = cfg.offsetX;
  Subsystem.offsetY[eid] = cfg.offsetY;
  Subsystem.offsetZ[eid] = cfg.offsetZ;
  Subsystem.hitRadius[eid] = cfg.hitRadius ?? getSubsystemHitRadius(cfg.type);
  Subsystem.subsystemType[eid] = cfg.type;
  Subsystem.hp[eid] = cfg.maxHp ?? getSubsystemMaxHp(cfg.type);
  Subsystem.maxHp[eid] = cfg.maxHp ?? getSubsystemMaxHp(cfg.type);
  Subsystem.disabled[eid] = 0;

  Health.hp[eid] = Subsystem.hp[eid];
  Health.maxHp[eid] = Subsystem.maxHp[eid];
  HitRadius.r[eid] = Subsystem.hitRadius[eid];

  return eid;
}

function spawnWeakPoint(world: IWorld, parentEid: number, cfg: { offsetX: number; offsetY: number; offsetZ: number; hitRadius: number; multiplier: number }): number {
  const eid = addEntity(world);
  addComponent(world, WeakPointV2, eid);
  addComponent(world, Transform, eid);

  WeakPointV2.parentEid[eid] = parentEid;
  WeakPointV2.offsetX[eid] = cfg.offsetX;
  WeakPointV2.offsetY[eid] = cfg.offsetY;
  WeakPointV2.offsetZ[eid] = cfg.offsetZ;
  WeakPointV2.hitRadius[eid] = cfg.hitRadius;
  WeakPointV2.damageMultiplier[eid] = cfg.multiplier;
  WeakPointV2.revealed[eid] = 0;

  return eid;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHIP CLASS STATS
// ─────────────────────────────────────────────────────────────────────────────

function getShipClassStats(shipClass: ShipClass) {
  switch (shipClass) {
    case ShipClass.Corvette:
      return { length: 12, hullPerSection: 500, shieldMax: 400, shieldRegenRate: 10, maxSpeed: 40, accel: 8, turnRate: 0.08, hangarCapacity: 0 };
    case ShipClass.Frigate:
      return { length: 24, hullPerSection: 1000, shieldMax: 800, shieldRegenRate: 15, maxSpeed: 30, accel: 5, turnRate: 0.05, hangarCapacity: 6 };
    case ShipClass.Cruiser:
      return { length: 72, hullPerSection: 3000, shieldMax: 2000, shieldRegenRate: 25, maxSpeed: 20, accel: 3, turnRate: 0.03, hangarCapacity: 24 };
    case ShipClass.Destroyer:
    default:
      return { length: 128, hullPerSection: 6000, shieldMax: 4000, shieldRegenRate: 40, maxSpeed: 15, accel: 2, turnRate: 0.02, hangarCapacity: 72 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TURRET LAYOUTS
// ─────────────────────────────────────────────────────────────────────────────

function getTurretLayout(shipClass: ShipClass): TurretConfig[] {
  if (shipClass === ShipClass.Destroyer) {
    // Star Destroyer layout
    return [
      // Dorsal heavy turbolasers (main ridge)
      { type: TurretType.Heavy, offsetX: -15, offsetY: 8, offsetZ: -40, yawMin: -2.5, yawMax: 0.5 },
      { type: TurretType.Heavy, offsetX: 15, offsetY: 8, offsetZ: -40, yawMin: -0.5, yawMax: 2.5 },
      { type: TurretType.Heavy, offsetX: -20, offsetY: 6, offsetZ: -20, yawMin: -2.5, yawMax: 0.5 },
      { type: TurretType.Heavy, offsetX: 20, offsetY: 6, offsetZ: -20, yawMin: -0.5, yawMax: 2.5 },
      { type: TurretType.Heavy, offsetX: -25, offsetY: 4, offsetZ: 0, yawMin: -2.5, yawMax: 0.5 },
      { type: TurretType.Heavy, offsetX: 25, offsetY: 4, offsetZ: 0, yawMin: -0.5, yawMax: 2.5 },
      { type: TurretType.Heavy, offsetX: -30, offsetY: 2, offsetZ: 20, yawMin: -2.5, yawMax: 0.5 },
      { type: TurretType.Heavy, offsetX: 30, offsetY: 2, offsetZ: 20, yawMin: -0.5, yawMax: 2.5 },
      // Point defense (anti-fighter)
      { type: TurretType.PointDefense, offsetX: -10, offsetY: 5, offsetZ: -30 },
      { type: TurretType.PointDefense, offsetX: 10, offsetY: 5, offsetZ: -30 },
      { type: TurretType.PointDefense, offsetX: -18, offsetY: 3, offsetZ: -10 },
      { type: TurretType.PointDefense, offsetX: 18, offsetY: 3, offsetZ: -10 },
      { type: TurretType.PointDefense, offsetX: -22, offsetY: 1, offsetZ: 10 },
      { type: TurretType.PointDefense, offsetX: 22, offsetY: 1, offsetZ: 10 },
      // Ion cannons (ventral)
      { type: TurretType.Ion, offsetX: 0, offsetY: -8, offsetZ: 0, pitchMin: -1.2, pitchMax: 0.17 },
      { type: TurretType.Ion, offsetX: 0, offsetY: -6, offsetZ: 30, pitchMin: -1.2, pitchMax: 0.17 },
    ];
  }
  if (shipClass === ShipClass.Cruiser) {
    return [
      { type: TurretType.Heavy, offsetX: -10, offsetY: 5, offsetZ: -20 },
      { type: TurretType.Heavy, offsetX: 10, offsetY: 5, offsetZ: -20 },
      { type: TurretType.Heavy, offsetX: -12, offsetY: 3, offsetZ: 0 },
      { type: TurretType.Heavy, offsetX: 12, offsetY: 3, offsetZ: 0 },
      { type: TurretType.PointDefense, offsetX: -8, offsetY: 4, offsetZ: -10 },
      { type: TurretType.PointDefense, offsetX: 8, offsetY: 4, offsetZ: -10 },
      { type: TurretType.PointDefense, offsetX: -10, offsetY: 2, offsetZ: 10 },
      { type: TurretType.PointDefense, offsetX: 10, offsetY: 2, offsetZ: 10 },
    ];
  }
  if (shipClass === ShipClass.Frigate) {
    return [
      { type: TurretType.Medium, offsetX: 0, offsetY: 3, offsetZ: -8 },
      { type: TurretType.Medium, offsetX: 0, offsetY: 3, offsetZ: 0 },
      { type: TurretType.PointDefense, offsetX: -4, offsetY: 2, offsetZ: -4 },
      { type: TurretType.PointDefense, offsetX: 4, offsetY: 2, offsetZ: -4 },
    ];
  }
  // Corvette
  return [
    { type: TurretType.Medium, offsetX: 0, offsetY: 2, offsetZ: -4 },
    { type: TurretType.PointDefense, offsetX: 0, offsetY: 1, offsetZ: 2 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSYSTEM LAYOUTS
// ─────────────────────────────────────────────────────────────────────────────

function getSubsystemLayout(shipClass: ShipClass): SubsystemConfig[] {
  if (shipClass === ShipClass.Destroyer) {
    return [
      // Bridge tower
      { type: SubsystemType.Bridge, offsetX: 0, offsetY: 18, offsetZ: 35 },
      // Shield generators (twin domes)
      { type: SubsystemType.ShieldGen, offsetX: -6, offsetY: 16, offsetZ: 32 },
      { type: SubsystemType.ShieldGen, offsetX: 6, offsetY: 16, offsetZ: 32 },
      // Engines
      { type: SubsystemType.Engines, offsetX: 0, offsetY: 0, offsetZ: 60 },
      // Targeting system
      { type: SubsystemType.Targeting, offsetX: 0, offsetY: 12, offsetZ: 30 },
      // Power system (ventral)
      { type: SubsystemType.Power, offsetX: 0, offsetY: -6, offsetZ: 20 },
      // Hangar
      { type: SubsystemType.Hangar, offsetX: 0, offsetY: -4, offsetZ: -10 },
    ];
  }
  if (shipClass === ShipClass.Cruiser) {
    return [
      { type: SubsystemType.Bridge, offsetX: 0, offsetY: 10, offsetZ: -25 },
      { type: SubsystemType.ShieldGen, offsetX: -8, offsetY: 5, offsetZ: 0 },
      { type: SubsystemType.ShieldGen, offsetX: 8, offsetY: 5, offsetZ: 0 },
      { type: SubsystemType.Engines, offsetX: 0, offsetY: 0, offsetZ: 30 },
      { type: SubsystemType.Power, offsetX: 0, offsetY: -4, offsetZ: 10 },
    ];
  }
  if (shipClass === ShipClass.Frigate) {
    return [
      { type: SubsystemType.Bridge, offsetX: 0, offsetY: 4, offsetZ: -8 },
      { type: SubsystemType.ShieldGen, offsetX: 0, offsetY: 2, offsetZ: 0 },
      { type: SubsystemType.Engines, offsetX: 0, offsetY: 0, offsetZ: 10 },
    ];
  }
  // Corvette
  return [
    { type: SubsystemType.Bridge, offsetX: 0, offsetY: 2, offsetZ: -4 },
    { type: SubsystemType.Engines, offsetX: 0, offsetY: 0, offsetZ: 5 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// WEAK POINT LAYOUTS
// ─────────────────────────────────────────────────────────────────────────────

function getWeakPointLayout(shipClass: ShipClass): Array<{ offsetX: number; offsetY: number; offsetZ: number; hitRadius: number; multiplier: number }> {
  if (shipClass === ShipClass.Destroyer) {
    return [
      { offsetX: -20, offsetY: 2, offsetZ: 10, hitRadius: 5, multiplier: 2.5 },
      { offsetX: 20, offsetY: 2, offsetZ: 10, hitRadius: 5, multiplier: 2.5 },
      { offsetX: 0, offsetY: -4, offsetZ: 40, hitRadius: 8, multiplier: 3.0 },
      { offsetX: -30, offsetY: 0, offsetZ: 30, hitRadius: 5, multiplier: 2.0 },
      { offsetX: 30, offsetY: 0, offsetZ: 30, hitRadius: 5, multiplier: 2.0 },
    ];
  }
  if (shipClass === ShipClass.Cruiser) {
    return [
      { offsetX: -15, offsetY: 0, offsetZ: 15, hitRadius: 6, multiplier: 2.5 },
      { offsetX: 15, offsetY: 0, offsetZ: 15, hitRadius: 6, multiplier: 2.5 },
      { offsetX: 0, offsetY: -3, offsetZ: 25, hitRadius: 8, multiplier: 3.0 },
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// TURRET STAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getTurretDamage(type: TurretType): number {
  switch (type) {
    case TurretType.PointDefense: return 1;  // Drastically reduced for gameplay balance
    case TurretType.Medium: return 2;        // Drastically reduced for gameplay balance
    case TurretType.Heavy: return 4;         // Drastically reduced for gameplay balance
    case TurretType.Ion: return 3;           // Drastically reduced for gameplay balance
    default: return 1;
  }
}

function getTurretCooldown(type: TurretType): number {
  switch (type) {
    case TurretType.PointDefense: return 0.4;  // Slower (was 0.15)
    case TurretType.Medium: return 0.8;        // Slower (was 0.4)
    case TurretType.Heavy: return 2.0;         // Slower (was 1.2)
    case TurretType.Ion: return 1.5;           // Slower (was 0.8)
    default: return 1.0;
  }
}

function getTurretRange(type: TurretType): number {
  switch (type) {
    case TurretType.PointDefense: return 400;
    case TurretType.Medium: return 600;
    case TurretType.Heavy: return 1000;
    case TurretType.Ion: return 700;
    default: return 500;
  }
}

function getTurretRotationSpeed(type: TurretType): number {
  switch (type) {
    case TurretType.PointDefense: return 2.0;
    case TurretType.Medium: return 1.2;
    case TurretType.Heavy: return 0.5;
    case TurretType.Ion: return 0.8;
    default: return 1.0;
  }
}

function getTurretProjectileSpeed(type: TurretType): number {
  switch (type) {
    case TurretType.PointDefense: return 700;
    case TurretType.Medium: return 600;
    case TurretType.Heavy: return 400;
    case TurretType.Ion: return 500;
    default: return 500;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSYSTEM STAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSubsystemMaxHp(type: SubsystemType): number {
  switch (type) {
    case SubsystemType.Bridge: return 800;
    case SubsystemType.ShieldGen: return 500;
    case SubsystemType.Engines: return 1000;
    case SubsystemType.Targeting: return 400;
    case SubsystemType.Power: return 600;
    case SubsystemType.Hangar: return 700;
    default: return 500;
  }
}

function getSubsystemHitRadius(type: SubsystemType): number {
  switch (type) {
    case SubsystemType.Bridge: return 8;
    case SubsystemType.ShieldGen: return 5;
    case SubsystemType.Engines: return 12;
    case SubsystemType.Targeting: return 4;
    case SubsystemType.Power: return 6;
    case SubsystemType.Hangar: return 10;
    default: return 5;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legacy function - now delegates to unified spatial index.
 * @deprecated Use rebuildSpaceCombatIndex() from spatial-index.ts instead.
 */
export { rebuildFighterSpatialHash } from "./spatial-index";

/**
 * Sync turret/subsystem/weak point world positions to parent capital ship.
 */
export function parentChildTransformSystem(world: IWorld): void {
  const capitals = capitalShipQuery(world);

  for (const shipEid of capitals) {
    tmpQ.set(
      Transform.qx[shipEid] ?? 0,
      Transform.qy[shipEid] ?? 0,
      Transform.qz[shipEid] ?? 0,
      Transform.qw[shipEid] ?? 1
    );

    const shipX = Transform.x[shipEid] ?? 0;
    const shipY = Transform.y[shipEid] ?? 0;
    const shipZ = Transform.z[shipEid] ?? 0;

    // Sync turrets
    const turrets = turretQuery(world);
    for (const tid of turrets) {
      if (Turret.parentEid[tid] !== shipEid) continue;

      tmpV.set(
        Turret.offsetX[tid] ?? 0,
        Turret.offsetY[tid] ?? 0,
        Turret.offsetZ[tid] ?? 0
      );
      tmpV.applyQuaternion(tmpQ);

      Transform.x[tid] = shipX + tmpV.x;
      Transform.y[tid] = shipY + tmpV.y;
      Transform.z[tid] = shipZ + tmpV.z;
      Transform.qx[tid] = tmpQ.x;
      Transform.qy[tid] = tmpQ.y;
      Transform.qz[tid] = tmpQ.z;
      Transform.qw[tid] = tmpQ.w;
    }

    // Sync subsystems
    const subsystems = subsystemQuery(world);
    for (const sid of subsystems) {
      if (Subsystem.parentEid[sid] !== shipEid) continue;

      tmpV.set(
        Subsystem.offsetX[sid] ?? 0,
        Subsystem.offsetY[sid] ?? 0,
        Subsystem.offsetZ[sid] ?? 0
      );
      tmpV.applyQuaternion(tmpQ);

      Transform.x[sid] = shipX + tmpV.x;
      Transform.y[sid] = shipY + tmpV.y;
      Transform.z[sid] = shipZ + tmpV.z;
    }

    // Sync weak points
    const weakPoints = weakPointQuery(world);
    for (const wid of weakPoints) {
      if (WeakPointV2.parentEid[wid] !== shipEid) continue;

      tmpV.set(
        WeakPointV2.offsetX[wid] ?? 0,
        WeakPointV2.offsetY[wid] ?? 0,
        WeakPointV2.offsetZ[wid] ?? 0
      );
      tmpV.applyQuaternion(tmpQ);

      Transform.x[wid] = shipX + tmpV.x;
      Transform.y[wid] = shipY + tmpV.y;
      Transform.z[wid] = shipZ + tmpV.z;
    }
  }
}

/**
 * Capital ship movement (slow, momentum-based).
 */
export function capitalShipMovementSystem(world: IWorld, dt: number): void {
  const capitals = capitalShipQuery(world);

  for (const eid of capitals) {
    const throttle = CapitalShipV2.throttle[eid] ?? 0;
    const maxSpeed = CapitalShipV2.maxSpeed[eid] ?? 15;
    const accel = CapitalShipV2.accel[eid] ?? 2;

    // Get forward direction
    tmpQ.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ);

    // Current velocity
    const vx = Velocity.vx[eid] ?? 0;
    const vy = Velocity.vy[eid] ?? 0;
    const vz = Velocity.vz[eid] ?? 0;
    const currentSpeed = Math.sqrt(vx * vx + vy * vy + vz * vz);

    // Target speed
    const targetSpeed = throttle * maxSpeed;

    // Accelerate/decelerate
    let newSpeed = currentSpeed;
    if (currentSpeed < targetSpeed) {
      newSpeed = Math.min(currentSpeed + accel * dt, targetSpeed);
    } else if (currentSpeed > targetSpeed) {
      newSpeed = Math.max(currentSpeed - accel * dt, targetSpeed);
    }

    // Apply velocity
    Velocity.vx[eid] = tmpForward.x * newSpeed;
    Velocity.vy[eid] = tmpForward.y * newSpeed;
    Velocity.vz[eid] = tmpForward.z * newSpeed;

    // Update position
    Transform.x[eid] = (Transform.x[eid] ?? 0) + Velocity.vx[eid] * dt;
    Transform.y[eid] = (Transform.y[eid] ?? 0) + Velocity.vy[eid] * dt;
    Transform.z[eid] = (Transform.z[eid] ?? 0) + Velocity.vz[eid] * dt;
  }
}

/**
 * Capital ship shield regeneration (arc-based).
 */
export function capitalShipShieldSystem(world: IWorld, dt: number): void {
  const capitals = capitalShipQuery(world);

  for (const eid of capitals) {
    const lastHit = CapitalShipV2.shieldLastHit[eid] ?? 999;
    const delay = CapitalShipV2.shieldRegenDelay[eid] ?? 3;

    CapitalShipV2.shieldLastHit[eid] = lastHit + dt;

    if (lastHit + dt >= delay) {
      const regenRate = CapitalShipV2.shieldRegenRate[eid] ?? 20;
      const shieldMax = CapitalShipV2.shieldMax[eid] ?? 4000;
      const halfMax = shieldMax / 2;

      // Regen front shield
      const front = CapitalShipV2.shieldFront[eid] ?? 0;
      CapitalShipV2.shieldFront[eid] = Math.min(front + regenRate * dt * 0.5, halfMax);

      // Regen rear shield
      const rear = CapitalShipV2.shieldRear[eid] ?? 0;
      CapitalShipV2.shieldRear[eid] = Math.min(rear + regenRate * dt * 0.5, halfMax);
    }
  }
}

/**
 * Turret targeting system - acquires hostile targets.
 */
export function turretTargetingSystem(world: IWorld, _dt: number): void {
  const turrets = turretQuery(world);

  for (const tid of turrets) {
    if (Turret.disabled[tid]) continue;

    const parentEid = Turret.parentEid[tid] ?? -1;
    if (parentEid < 0) continue;
    const parentTeam = Team.id[parentEid] ?? 0;
    const range = Turret.range[tid] ?? 500;

    const tx = Transform.x[tid] ?? 0;
    const ty = Transform.y[tid] ?? 0;
    const tz = Transform.z[tid] ?? 0;

    // Check current target validity
    const currentTarget = Turret.targetEid[tid] ?? -1;
    if (currentTarget >= 0) {
      if (!hasComponent(world, Health, currentTarget)) {
        Turret.targetEid[tid] = -1;
      } else {
        const hp = Health.hp[currentTarget] ?? 0;
        if (hp <= 0) {
          Turret.targetEid[tid] = -1;
        } else {
          // Check range
          const dx = (Transform.x[currentTarget] ?? 0) - tx;
          const dy = (Transform.y[currentTarget] ?? 0) - ty;
          const dz = (Transform.z[currentTarget] ?? 0) - tz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > range * 1.2) {
            Turret.targetEid[tid] = -1;
          }
        }
      }
    }

    // Acquire new target if needed
    if ((Turret.targetEid[tid] ?? -1) < 0) {
      const nearby = spaceCombatIndex.queryCombatants(tx, ty, tz, range);
      let bestTarget = -1;
      let bestDist = Infinity;

      for (const fid of nearby) {
        if (!hasComponent(world, Team, fid)) continue;
        const fTeam = Team.id[fid] ?? 0;
        if (fTeam === parentTeam) continue; // Skip allies

        const hp = Health.hp[fid] ?? 0;
        if (hp <= 0) continue;

        const dx = (Transform.x[fid] ?? 0) - tx;
        const dy = (Transform.y[fid] ?? 0) - ty;
        const dz = (Transform.z[fid] ?? 0) - tz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = fid;
        }
      }

      Turret.targetEid[tid] = bestTarget;
    }
  }
}

/**
 * Turret rotation system - tracks toward current target.
 */
export function turretRotationSystem(world: IWorld, dt: number): void {
  const turrets = turretQuery(world);

  for (const tid of turrets) {
    if (Turret.disabled[tid]) continue;

    const targetEid = Turret.targetEid[tid] ?? -1;
    if (targetEid < 0) continue;

    const tx = Transform.x[tid] ?? 0;
    const ty = Transform.y[tid] ?? 0;
    const tz = Transform.z[tid] ?? 0;

    const targetX = Transform.x[targetEid] ?? 0;
    const targetY = Transform.y[targetEid] ?? 0;
    const targetZ = Transform.z[targetEid] ?? 0;

    // Direction to target in world space
    tmpV.set(targetX - tx, targetY - ty, targetZ - tz).normalize();

    // Get parent rotation
    const parentEid = Turret.parentEid[tid] ?? -1;
    if (parentEid < 0) continue;
    tmpQ.set(
      Transform.qx[parentEid] ?? 0,
      Transform.qy[parentEid] ?? 0,
      Transform.qz[parentEid] ?? 0,
      Transform.qw[parentEid] ?? 1
    );

    // Transform to local space
    tmpV2.copy(tmpV);
    const invQ = tmpQ.clone().invert();
    tmpV2.applyQuaternion(invQ);

    // Calculate desired yaw/pitch
    const desiredYaw = Math.atan2(-tmpV2.x, -tmpV2.z);
    const desiredPitch = Math.atan2(tmpV2.y, Math.sqrt(tmpV2.x * tmpV2.x + tmpV2.z * tmpV2.z));

    // Clamp to limits
    const yawMin = Turret.yawMin[tid] ?? -Math.PI;
    const yawMax = Turret.yawMax[tid] ?? Math.PI;
    const pitchMin = Turret.pitchMin[tid] ?? -0.17;
    const pitchMax = Turret.pitchMax[tid] ?? 1.05;

    const clampedYaw = Math.max(yawMin, Math.min(yawMax, desiredYaw));
    const clampedPitch = Math.max(pitchMin, Math.min(pitchMax, desiredPitch));

    Turret.yawTarget[tid] = clampedYaw;
    Turret.pitchTarget[tid] = clampedPitch;

    // Rotate toward target
    const rotSpeed = Turret.rotationSpeed[tid] ?? 1.0;
    const maxDelta = rotSpeed * dt;

    const currentYaw = Turret.yaw[tid] ?? 0;
    const currentPitch = Turret.pitch[tid] ?? 0;

    const yawDiff = clampedYaw - currentYaw;
    const pitchDiff = clampedPitch - currentPitch;

    Turret.yaw[tid] = currentYaw + Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), maxDelta);
    Turret.pitch[tid] = currentPitch + Math.sign(pitchDiff) * Math.min(Math.abs(pitchDiff), maxDelta);
  }
}

/**
 * Turret firing system - fires when cooldown ready and on target.
 */
export function turretFireSystem(world: IWorld, dt: number): void {
  const turrets = turretQuery(world);

  for (const tid of turrets) {
    if (Turret.disabled[tid]) continue;

    // Update cooldown
    const cd = Turret.cooldownRemaining[tid] ?? 0;
    Turret.cooldownRemaining[tid] = Math.max(0, cd - dt);

    if (Turret.cooldownRemaining[tid] > 0) continue;

    const targetEid = Turret.targetEid[tid] ?? -1;
    if (targetEid < 0) continue;

    // Check if on target (within aim threshold)
    const yaw = Turret.yaw[tid] ?? 0;
    const pitch = Turret.pitch[tid] ?? 0;
    const yawTarget = Turret.yawTarget[tid] ?? 0;
    const pitchTarget = Turret.pitchTarget[tid] ?? 0;

    const aimError = Math.abs(yaw - yawTarget) + Math.abs(pitch - pitchTarget);
    if (aimError > 0.15) continue; // Not aimed well enough

    // Fire!
    Turret.cooldownRemaining[tid] = Turret.cooldown[tid] ?? 0.5;

    const tx = Transform.x[tid] ?? 0;
    const ty = Transform.y[tid] ?? 0;
    const tz = Transform.z[tid] ?? 0;

    // Fire direction (from turret rotation)
    const parentEid = Turret.parentEid[tid] ?? -1;
    if (parentEid < 0) continue;
    tmpQ.set(
      Transform.qx[parentEid] ?? 0,
      Transform.qy[parentEid] ?? 0,
      Transform.qz[parentEid] ?? 0,
      Transform.qw[parentEid] ?? 1
    );

    // Apply turret local rotation
    const turretQ = new Quaternion();
    // Yaw around Y, then pitch around X
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    // Combined YXZ order quaternion
    turretQ.set(
      cy * sp,        // x
      sy * cp,        // y
      -sy * sp,       // z
      cy * cp         // w
    );
    tmpQ.multiply(turretQ);

    tmpForward.set(0, 0, -1).applyQuaternion(tmpQ);

    // Add accuracy scatter (seeded by turret ID for determinism)
    const accuracy = Turret.trackingAccuracy[tid] ?? 0.8;
    const scatter = (1 - accuracy) * 0.1;
    const scatterRng = new SeededRNG(tid * 10000 + (Turret.cooldownRemaining[tid] | 0));
    tmpForward.x += (scatterRng.next() - 0.5) * scatter;
    tmpForward.y += (scatterRng.next() - 0.5) * scatter;
    tmpForward.z += (scatterRng.next() - 0.5) * scatter;
    tmpForward.normalize();

    const speed = Turret.projectileSpeed[tid] ?? 500;

    // Spawn projectile
    const pid = addEntity(world);
    addComponent(world, TurretProjectile, pid);
    addComponent(world, Transform, pid);
    addComponent(world, Velocity, pid);

    Transform.x[pid] = tx;
    Transform.y[pid] = ty;
    Transform.z[pid] = tz;
    Transform.qx[pid] = 0;
    Transform.qy[pid] = 0;
    Transform.qz[pid] = 0;
    Transform.qw[pid] = 1;

    Velocity.vx[pid] = tmpForward.x * speed;
    Velocity.vy[pid] = tmpForward.y * speed;
    Velocity.vz[pid] = tmpForward.z * speed;

    TurretProjectile.life[pid] = 3.0;
    TurretProjectile.ownerEid[pid] = tid;
    TurretProjectile.parentShipEid[pid] = parentEid;
    TurretProjectile.damage[pid] = Turret.damage[tid] ?? 10;
    TurretProjectile.turretType[pid] = Turret.turretType[tid] ?? 0;

    // Fire event for rendering
    const team = Team.id[parentEid] ?? 0;
    turretFireEvents.push({
      x: tx, y: ty, z: tz,
      vx: tmpForward.x * speed,
      vy: tmpForward.y * speed,
      vz: tmpForward.z * speed,
      turretType: Turret.turretType[tid] ?? 0,
      team,
    });
  }
}

/**
 * Turret projectile movement and collision.
 */
export function turretProjectileSystem(world: IWorld, dt: number): void {
  const projectiles = turretProjectileQuery(world);

  for (const pid of projectiles) {
    // Update life
    const life = TurretProjectile.life[pid] ?? 0;
    TurretProjectile.life[pid] = life - dt;

    if (TurretProjectile.life[pid] <= 0) {
      removeEntity(world, pid);
      continue;
    }

    // Move
    const vx = Velocity.vx[pid] ?? 0;
    const vy = Velocity.vy[pid] ?? 0;
    const vz = Velocity.vz[pid] ?? 0;

    Transform.x[pid] = (Transform.x[pid] ?? 0) + vx * dt;
    Transform.y[pid] = (Transform.y[pid] ?? 0) + vy * dt;
    Transform.z[pid] = (Transform.z[pid] ?? 0) + vz * dt;

    // Collision check (using unified spatial index)
    const px = Transform.x[pid] ?? 0;
    const py = Transform.y[pid] ?? 0;
    const pz = Transform.z[pid] ?? 0;

    const parentShipEid = TurretProjectile.parentShipEid[pid] ?? -1;
    const parentTeam = parentShipEid >= 0 ? (Team.id[parentShipEid] ?? 0) : 0;

    const nearby = spaceCombatIndex.queryCombatants(px, py, pz, 30);

    for (const fid of nearby) {
      if (!hasComponent(world, Team, fid)) continue;
      const fTeam = Team.id[fid] ?? 0;
      if (fTeam === parentTeam) continue; // Skip allies

      const fx = Transform.x[fid] ?? 0;
      const fy = Transform.y[fid] ?? 0;
      const fz = Transform.z[fid] ?? 0;
      const r = HitRadius.r[fid] ?? 5;

      const dx = px - fx;
      const dy = py - fy;
      const dz = pz - fz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < r + 2) {
        // Hit!
        const damage = TurretProjectile.damage[pid] ?? 10;
        Health.hp[fid] = (Health.hp[fid] ?? 0) - damage;
        removeEntity(world, pid);
        break;
      }
    }
  }
}

/**
 * Subsystem effects - apply debuffs when subsystems are disabled.
 */
export function subsystemEffectsSystem(world: IWorld, _dt: number): void {
  const subsystems = subsystemQuery(world);

  for (const sid of subsystems) {
    const hp = Subsystem.hp[sid] ?? 0;
    const wasDisabled = Subsystem.disabled[sid] === 1;
    const isDisabled = hp <= 0;

    if (isDisabled && !wasDisabled) {
      // Just got disabled
      Subsystem.disabled[sid] = 1;

      const parentEid = Subsystem.parentEid[sid] ?? -1;
      const type = Subsystem.subsystemType[sid] ?? 0;

      if (parentEid < 0) continue;

      // Emit event
      subsystemDestroyedEvents.push({
        shipEid: parentEid,
        subsystemType: type as SubsystemType,
        x: Transform.x[sid] ?? 0,
        y: Transform.y[sid] ?? 0,
        z: Transform.z[sid] ?? 0,
      });

      // Apply effect based on type
      switch (type) {
        case SubsystemType.ShieldGen:
          // Halve shield regen rate
          CapitalShipV2.shieldRegenRate[parentEid] = (CapitalShipV2.shieldRegenRate[parentEid] ?? 40) * 0.5;
          break;
        case SubsystemType.Targeting:
          // Reduce all turret accuracy on this ship
          const turrets = turretQuery(world);
          for (const tid of turrets) {
            if (Turret.parentEid[tid] === parentEid) {
              Turret.trackingAccuracy[tid] = (Turret.trackingAccuracy[tid] ?? 0.8) * 0.5;
            }
          }
          break;
        case SubsystemType.Power:
          // Reveal weak points
          const weakPoints = weakPointQuery(world);
          for (const wid of weakPoints) {
            if (WeakPointV2.parentEid[wid] === parentEid) {
              WeakPointV2.revealed[wid] = 1;
            }
          }
          break;
        case SubsystemType.Engines:
          // Immobilize ship
          CapitalShipV2.maxSpeed[parentEid] = 0;
          CapitalShipV2.turnRate[parentEid] = 0;
          break;
        case SubsystemType.Hangar:
          // Disable fighter spawning
          CapitalShipV2.hangarCapacity[parentEid] = 0;
          break;
      }
    }
  }

  // Sync subsystem HP to Health component
  for (const sid of subsystems) {
    Health.hp[sid] = Subsystem.hp[sid] ?? 0;
  }
}

/**
 * Remove a capital ship and all its child entities.
 */
export function removeCapitalShipV2(world: IWorld, shipEid: number): void {
  // Remove turrets
  const turrets = turretQuery(world);
  for (const tid of turrets) {
    if (Turret.parentEid[tid] === shipEid) {
      removeEntity(world, tid);
    }
  }

  // Remove subsystems
  const subsystems = subsystemQuery(world);
  for (const sid of subsystems) {
    if (Subsystem.parentEid[sid] === shipEid) {
      removeEntity(world, sid);
    }
  }

  // Remove weak points
  const weakPoints = weakPointQuery(world);
  for (const wid of weakPoints) {
    if (WeakPointV2.parentEid[wid] === shipEid) {
      removeEntity(world, wid);
    }
  }

  // Remove ship
  removeEntity(world, shipEid);
}
