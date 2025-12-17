/**
 * FlightShared - Shared utilities for flight mode scenarios
 */

import * as THREE from "three";
import {
  addComponent,
  addEntity,
  removeEntity,
  hasComponent,
  type IWorld
} from "bitecs";
import { createProceduralShip, type ShipType, AssetLoader, KENNEY_ASSETS } from "@xwingz/render";
import {
  createRng,
  getEncounter,
  getFighterArchetype,
  getMission,
  type SystemDef
} from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  computeInterceptTime,
  FighterBrain,
  getProjectiles,
  getTargetables,
  Health,
  HitRadius,
  LaserWeapon,
  Projectile,
  Shield,
  Ship,
  spawnPlayerShip,
  Targetable,
  Team,
  Transform,
  Velocity,
  getTorpedoState
} from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import { disposeObject } from "../../rendering/MeshManager";
import {
  ExplosionManager,
  getBoltGeometry,
  getBoltMaterial,
  makeBoltGlow,
  buildStarfield
} from "../../rendering/effects";
import { computePlayerStats } from "../../state/UpgradeManager";
import { clamp, type FlightHudElements, type ScreenPoint, type MissionRuntime, type TargetBracketState } from "./FlightScenarioTypes";

// Local copies of const enums (can't import const enums with verbatimModuleSyntax)
export const SubsystemType = {
  Bridge: 0,
  ShieldGen: 1,
  Engines: 2,
  Targeting: 3,
  Power: 4,
  Hangar: 5
} as const;

export const TurretType = {
  PointDefense: 0,
  Medium: 1,
  Heavy: 2,
  Ion: 3
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Ship Building
// ─────────────────────────────────────────────────────────────────────────────

const SHIP_TYPE_MAP: Record<string, ShipType> = {
  "tie_ln": "tie_ln",
  "tie_fighter": "tie_fighter",
  "tie_interceptor": "tie_interceptor",
  "xwing": "xwing",
  "ywing": "ywing",
  "awing": "awing",
};

export function buildEnemyMesh(archetypeId: string): THREE.Object3D {
  const shipType = SHIP_TYPE_MAP[archetypeId] ?? "tie_ln";
  return createProceduralShip({ type: shipType, enableShadows: true });
}

export function buildAllyMesh(slot = 0): THREE.Group {
  const tint = slot % 3 === 0 ? 0x9bb7ff : slot % 3 === 1 ? 0xbfffd0 : 0xffd29b;
  return createProceduralShip({ type: "xwing", tint, enableShadows: true });
}

export function buildPlayerMesh(): THREE.Group {
  return createProceduralShip({ type: "xwing_player", enableShadows: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Turret & Subsystem Meshes
// ─────────────────────────────────────────────────────────────────────────────

export function buildTurretMesh(
  turretType: number,
  assetLoader: AssetLoader,
  assetsReady: boolean
): THREE.Group {
  const scale = turretType === TurretType.Heavy ? 1.5 :
                turretType === TurretType.Medium ? 1.0 : 0.6;

  const useDoubleTurret = turretType === TurretType.Medium || turretType === TurretType.Heavy;
  const assetKey = useDoubleTurret ? KENNEY_ASSETS.TURRET_DOUBLE : KENNEY_ASSETS.TURRET_SINGLE;

  if (assetsReady && assetLoader.isCached(assetKey)) {
    const model = assetLoader.clone(assetKey);
    model.scale.setScalar(scale * 2.5);
    model.rotation.x = -Math.PI / 2;
    return model;
  }

  return buildProceduralTurretMesh(turretType, scale);
}

function buildProceduralTurretMesh(turretType: number, scale: number): THREE.Group {
  const group = new THREE.Group();

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f5c,
    metalness: 0.4,
    roughness: 0.6
  });
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d36,
    metalness: 0.5,
    roughness: 0.5
  });

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5 * scale, 2 * scale, 1 * scale, 8),
    baseMat
  );
  base.castShadow = true;
  group.add(base);

  const barrelGeo = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 4 * scale, 6);
  const barrelCount = turretType === TurretType.PointDefense ? 2 :
                      turretType === TurretType.Medium ? 2 : 1;

  for (let i = 0; i < barrelCount; i++) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set((i - (barrelCount - 1) / 2) * 0.8 * scale, 0.5 * scale, -2 * scale);
    barrel.castShadow = true;
    group.add(barrel);
  }

  return group;
}

export function buildSubsystemMesh(type: number): THREE.Group {
  const group = new THREE.Group();

  const colors: Record<number, number> = {
    [SubsystemType.Bridge]: 0xff3344,
    [SubsystemType.ShieldGen]: 0x44aaff,
    [SubsystemType.Engines]: 0xff8833,
    [SubsystemType.Targeting]: 0xffff44,
    [SubsystemType.Power]: 0x44ff44,
    [SubsystemType.Hangar]: 0xaa44ff
  };

  const color = colors[type] ?? 0xffffff;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 8, 8),
    new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.7
    })
  );
  group.add(sphere);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.15, 8, 16),
    new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8
    })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Management
// ─────────────────────────────────────────────────────────────────────────────

export function spawnPlayer(
  ctx: ModeContext,
  scene: THREE.Scene,
  existingShipEid: number | null,
  existingShipMesh: THREE.Object3D | null
): { shipEid: number; shipMesh: THREE.Group } {
  if (existingShipEid !== null) {
    removeEntity(ctx.world, existingShipEid);
  }
  if (existingShipMesh) {
    scene.remove(existingShipMesh);
    disposeObject(existingShipMesh);
  }

  const shipEid = spawnPlayerShip(ctx.world);
  const shipMesh = buildPlayerMesh();
  scene.add(shipMesh);

  return { shipEid, shipMesh };
}

export function applyUpgradesToPlayer(
  _world: IWorld,
  shipEid: number,
  upgrades: { engine: number; maneuver: number; shields: number; lasers: number; hull: number },
  refill = false
): void {
  const stats = computePlayerStats(upgrades);

  Ship.maxSpeed[shipEid] = stats.maxSpeed;
  Ship.accel[shipEid] = stats.accel;
  Ship.turnRate[shipEid] = stats.turnRate;

  LaserWeapon.damage[shipEid] = stats.damage;
  LaserWeapon.cooldown[shipEid] = stats.weaponCooldown;
  LaserWeapon.projectileSpeed[shipEid] = stats.projectileSpeed;
  LaserWeapon.cooldownRemaining[shipEid] = Math.min(
    LaserWeapon.cooldownRemaining[shipEid] ?? 0,
    stats.weaponCooldown
  );

  Shield.maxSp[shipEid] = stats.maxSp;
  Shield.regenRate[shipEid] = stats.regen;
  if (refill) Shield.sp[shipEid] = stats.maxSp;

  Health.maxHp[shipEid] = stats.maxHp;
  if (refill) Health.hp[shipEid] = stats.maxHp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy Spawning
// ─────────────────────────────────────────────────────────────────────────────

export function spawnEnemyFighters(
  ctx: ModeContext,
  scene: THREE.Scene,
  system: SystemDef,
  encounterKey: string,
  existingTargetEids: number[],
  existingTargetMeshes: Map<number, THREE.Object3D>
): { targetEids: number[]; targetMeshes: Map<number, THREE.Object3D> } {
  // Clear existing
  for (const eid of existingTargetEids) {
    removeEntity(ctx.world, eid);
  }
  for (const mesh of existingTargetMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }

  const targetEids: number[] = [];
  const targetMeshes = new Map<number, THREE.Object3D>();

  const encounter = getEncounter(system, encounterKey);
  const rng = createRng(encounter.seed);

  for (let i = 0; i < encounter.count; i++) {
    const archetypeId = encounter.archetypes[i] ?? "z95";
    const archetype = getFighterArchetype(archetypeId);

    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(encounter.spawnRing.min, encounter.spawnRing.max);
    const y = rng.range(-140, 140);
    const pos = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r - rng.range(300, 800));

    const eid = addEntity(ctx.world);
    addComponent(ctx.world, Transform, eid);
    addComponent(ctx.world, Velocity, eid);
    addComponent(ctx.world, AngularVelocity, eid);
    addComponent(ctx.world, Team, eid);
    addComponent(ctx.world, Ship, eid);
    addComponent(ctx.world, LaserWeapon, eid);
    addComponent(ctx.world, Targetable, eid);
    addComponent(ctx.world, Health, eid);
    addComponent(ctx.world, HitRadius, eid);
    addComponent(ctx.world, Shield, eid);
    addComponent(ctx.world, FighterBrain, eid);
    addComponent(ctx.world, AIControlled, eid);

    Transform.x[eid] = pos.x;
    Transform.y[eid] = pos.y;
    Transform.z[eid] = pos.z;
    Transform.qx[eid] = 0;
    Transform.qy[eid] = 0;
    Transform.qz[eid] = 0;
    Transform.qw[eid] = 1;

    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;
    Velocity.vz[eid] = 0;

    AngularVelocity.wx[eid] = 0;
    AngularVelocity.wy[eid] = 0;
    AngularVelocity.wz[eid] = 0;

    Team.id[eid] = 1;

    Ship.throttle[eid] = rng.range(0.6, 0.9);
    Ship.maxSpeed[eid] = archetype.maxSpeed;
    Ship.accel[eid] = archetype.accel;
    Ship.turnRate[eid] = archetype.turnRate;

    LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
    LaserWeapon.cooldownRemaining[eid] = rng.range(0, archetype.weaponCooldown);
    LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
    LaserWeapon.damage[eid] = archetype.damage;

    Health.hp[eid] = archetype.hp;
    Health.maxHp[eid] = archetype.hp;
    HitRadius.r[eid] = archetype.hitRadius;

    Shield.maxSp[eid] = archetypeId === "tie_ln" ? 10 : 25;
    Shield.sp[eid] = Shield.maxSp[eid];
    Shield.regenRate[eid] = 4;
    Shield.lastHit[eid] = 999;

    FighterBrain.state[eid] = 0;
    FighterBrain.stateTime[eid] = 0;
    FighterBrain.aggression[eid] = archetype.aggression;
    FighterBrain.evadeBias[eid] = archetype.evadeBias;
    FighterBrain.targetEid[eid] = -1;

    const mesh = buildEnemyMesh(archetypeId);
    mesh.position.copy(pos);
    scene.add(mesh);
    targetMeshes.set(eid, mesh);
    targetEids.push(eid);
  }

  return { targetEids, targetMeshes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Projectile Management
// ─────────────────────────────────────────────────────────────────────────────

const tmpProjVel = new THREE.Vector3();
const boltForward = new THREE.Vector3(0, 0, 1);
const tmpExplosionPos = new THREE.Vector3();

export function syncProjectiles(
  ctx: ModeContext,
  scene: THREE.Scene,
  projectileMeshes: Map<number, THREE.Mesh>,
  explosions: ExplosionManager | null,
  shipEid: number | null
): void {
  const ps = getProjectiles(ctx.world);
  const alive = new Set(ps);
  const boltGeo = getBoltGeometry();

  for (const eid of ps) {
    let mesh = projectileMeshes.get(eid);
    if (!mesh) {
      const owner = Projectile.owner[eid] ?? -1;
      const ownerTeam = owner >= 0 && hasComponent(ctx.world, Team, owner) ? (Team.id[owner] ?? -1) : -1;
      const friendly = ownerTeam === 0;
      mesh = new THREE.Mesh(boltGeo, getBoltMaterial(friendly));
      mesh.rotation.x = Math.PI / 2;
      mesh.renderOrder = 8;
      mesh.add(makeBoltGlow(friendly ? 0xff6666 : 0x77ff88));
      scene.add(mesh);
      projectileMeshes.set(eid, mesh);

      if (owner === shipEid) {
        explosions?.spawn(
          tmpExplosionPos.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0),
          0xff6666,
          0.12,
          2.2
        );
      }
    }
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);

    tmpProjVel.set(Velocity.vx[eid] ?? 0, Velocity.vy[eid] ?? 0, Velocity.vz[eid] ?? 0);
    if (tmpProjVel.lengthSq() > 1e-4) {
      tmpProjVel.normalize();
      mesh.quaternion.setFromUnitVectors(boltForward, tmpProjVel);
    }
  }

  for (const [eid, mesh] of projectileMeshes) {
    if (alive.has(eid)) continue;
    scene.remove(mesh);
    disposeObject(mesh);
    projectileMeshes.delete(eid);
  }
}

export function clearProjectiles(
  ctx: ModeContext,
  scene: THREE.Scene,
  projectileMeshes: Map<number, THREE.Mesh>
): void {
  const ps = getProjectiles(ctx.world);
  for (const eid of ps) removeEntity(ctx.world, eid);
  for (const mesh of projectileMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  projectileMeshes.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Target Management
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncTargetsResult {
  targetEids: number[];
  killedCount: number;
}

export function syncTargets(
  ctx: ModeContext,
  scene: THREE.Scene,
  targetMeshes: Map<number, THREE.Object3D>,
  explosions: ExplosionManager | null
): SyncTargetsResult {
  const aliveTargets = getTargetables(ctx.world);
  const aliveSet = new Set(aliveTargets);
  let killed = 0;

  for (const [eid, mesh] of targetMeshes) {
    if (aliveSet.has(eid)) continue;
    killed += 1;
    explosions?.spawn(tmpExplosionPos.copy(mesh.position));
    scene.remove(mesh);
    disposeObject(mesh);
    targetMeshes.delete(eid);
  }

  for (const eid of aliveTargets) {
    const mesh = targetMeshes.get(eid);
    if (!mesh) continue;
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
    mesh.quaternion.set(
      Transform.qx[eid] ?? 0,
      Transform.qy[eid] ?? 0,
      Transform.qz[eid] ?? 0,
      Transform.qw[eid] ?? 1
    );
  }

  return { targetEids: aliveTargets, killedCount: killed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Starfield
// ─────────────────────────────────────────────────────────────────────────────

export function createStarfield(seed: bigint): THREE.Points {
  return buildStarfield(seed);
}

export function disposeStarfield(scene: THREE.Scene, starfield: THREE.Points | null): void {
  if (starfield) {
    scene.remove(starfield);
    starfield.geometry.dispose();
    (starfield.material as THREE.Material).dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD Utilities
// ─────────────────────────────────────────────────────────────────────────────

const tmpNdc = new THREE.Vector3();

export function projectToScreen(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  pos: THREE.Vector3,
  out: ScreenPoint
): ScreenPoint {
  const v = tmpNdc.copy(pos).project(camera);
  const w = renderer.domElement.clientWidth || window.innerWidth;
  const h = renderer.domElement.clientHeight || window.innerHeight;

  let nx = v.x;
  let ny = v.y;
  const behind = v.z > 1;
  if (behind) {
    nx = -nx;
    ny = -ny;
  }

  const onScreen = !behind && v.z > -1 && v.z < 1 && nx > -1 && nx < 1 && ny > -1 && ny < 1;

  const margin = 0.92;
  const cx = clamp(nx, -margin, margin);
  const cy = clamp(ny, -margin, margin);
  out.x = (cx * 0.5 + 0.5) * w;
  out.y = (-cy * 0.5 + 0.5) * h;
  out.onScreen = onScreen;
  out.behind = behind;
  return out;
}

export function updatePlayerHudValues(
  els: FlightHudElements,
  shipEid: number | null,
  ctx: ModeContext
): void {
  if (shipEid === null) {
    els.speed.textContent = "0";
    els.throttle.textContent = "0%";
    els.shield.textContent = "0/0";
    els.hp.textContent = "0/0";
    els.torpedo.textContent = "0/0";
    return;
  }

  const v = Math.hypot(
    Velocity.vx[shipEid],
    Velocity.vy[shipEid],
    Velocity.vz[shipEid]
  ) || 0;
  const t = Ship.throttle[shipEid] || 0;
  const sp = Shield.sp[shipEid] ?? 0;
  const maxSp = Shield.maxSp[shipEid] ?? 0;
  const hpSelf = Health.hp[shipEid] ?? 0;
  const maxHpSelf = Health.maxHp[shipEid] ?? 0;

  els.speed.textContent = v.toFixed(0);
  els.throttle.textContent = `${Math.round(t * 100)}%`;
  els.shield.textContent = `${sp.toFixed(0)}/${maxSp.toFixed(0)}`;
  els.hp.textContent = `${hpSelf.toFixed(0)}/${maxHpSelf.toFixed(0)}`;

  const torpState = getTorpedoState(ctx.world);
  if (torpState) {
    const lockStr =
      torpState.lockProgress >= 1
        ? "LOCKED"
        : torpState.lockProgress > 0
          ? `${Math.round(torpState.lockProgress * 100)}%`
          : "";
    els.torpedo.textContent = `${torpState.ammo}/${torpState.maxAmmo}${lockStr ? " " + lockStr : ""}`;
    els.torpedo.style.color = torpState.lockProgress >= 1 ? "#ff4444" : "#88ff88";
  } else {
    els.torpedo.textContent = "0/0";
    els.torpedo.style.color = "#88ff88";
  }
}

export function updateSystemInfo(
  els: FlightHudElements,
  system: SystemDef | null,
  credits: number
): void {
  if (system) {
    els.system.textContent = system.id;
    els.faction.textContent = system.controllingFaction;
  }
  els.credits.textContent = credits.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Target Bracket
// ─────────────────────────────────────────────────────────────────────────────

const tmpHudTargetPos = new THREE.Vector3();
const tmpHudLeadPos = new THREE.Vector3();
const tmpHudQ = new THREE.Quaternion();
const tmpHudForward = new THREE.Vector3();
const tmpHudDir = new THREE.Vector3();
const tmpTargetScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };
const tmpLeadScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };

export function updateTargetBracket(
  ctx: ModeContext,
  els: FlightHudElements,
  shipEid: number,
  teid: number,
  state: TargetBracketState,
  dtSeconds: number
): TargetBracketState {
  if (teid !== state.lockTargetEid) {
    state = { lockValue: 0, lockTargetEid: teid };
  }

  const sx = Transform.x[shipEid] ?? 0;
  const sy = Transform.y[shipEid] ?? 0;
  const sz = Transform.z[shipEid] ?? 0;

  const tx = Transform.x[teid] ?? 0;
  const ty = Transform.y[teid] ?? 0;
  const tz = Transform.z[teid] ?? 0;

  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const hp = Health.hp[teid] ?? 0;
  els.target.textContent = `TGT ${teid}  ${dist.toFixed(0)}m  HP ${hp.toFixed(0)}`;

  // Bracket on target
  const screen = projectToScreen(ctx.camera, ctx.renderer, tmpHudTargetPos.set(tx, ty, tz), tmpTargetScreen);
  els.bracket.classList.remove("hidden");
  els.bracket.classList.toggle("offscreen", !screen.onScreen);
  els.bracket.classList.toggle("behind", screen.behind);
  els.bracket.style.left = `${screen.x}px`;
  els.bracket.style.top = `${screen.y}px`;

  // Lead pip
  const projSpeed = LaserWeapon.projectileSpeed[shipEid] ?? 900;
  const tvx = Velocity.vx[teid] ?? 0;
  const tvy = Velocity.vy[teid] ?? 0;
  const tvz = Velocity.vz[teid] ?? 0;
  const svx = Velocity.vx[shipEid] ?? 0;
  const svy = Velocity.vy[shipEid] ?? 0;
  const svz = Velocity.vz[shipEid] ?? 0;
  const rvx = tvx - svx;
  const rvy = tvy - svy;
  const rvz = tvz - svz;
  const leadTime = computeInterceptTime(dx, dy, dz, rvx, rvy, rvz, projSpeed) ?? dist / projSpeed;
  const leadPos = tmpHudLeadPos.set(tx + tvx * leadTime, ty + tvy * leadTime, tz + tvz * leadTime);
  const leadScreen = projectToScreen(ctx.camera, ctx.renderer, leadPos, tmpLeadScreen);
  els.lead.classList.toggle("hidden", !leadScreen.onScreen);
  if (leadScreen.onScreen) {
    els.lead.style.left = `${leadScreen.x}px`;
    els.lead.style.top = `${leadScreen.y}px`;
  }

  // Lock meter
  const q = tmpHudQ.set(
    Transform.qx[shipEid] ?? 0,
    Transform.qy[shipEid] ?? 0,
    Transform.qz[shipEid] ?? 0,
    Transform.qw[shipEid] ?? 1
  );
  const forward = tmpHudForward.set(0, 0, -1).applyQuaternion(q).normalize();
  const dir = tmpHudDir.set(dx, dy, dz).normalize();
  const dot = forward.dot(dir);
  const radius = HitRadius.r[teid] ?? 8;
  const sizeAngle = Math.atan2(radius, dist);
  const baseCone = 0.07;
  const cone = baseCone + sizeAngle;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const inCone = screen.onScreen && angle < cone && dist < 900;

  const lockGain = 1.8;
  const lockDecay = 0.6;
  let newLockValue = state.lockValue + (inCone ? lockGain : -lockDecay) * dtSeconds;
  newLockValue = Math.min(1, Math.max(0, newLockValue));

  const pct = Math.round(newLockValue * 100);
  els.lock.textContent = newLockValue >= 1 ? "LOCK" : `LOCK ${pct}%`;

  return { lockValue: newLockValue, lockTargetEid: teid };
}

export function clearTargetBracket(els: FlightHudElements): void {
  els.target.textContent = "NO TARGET";
  els.bracket.classList.add("hidden");
  els.lead.classList.add("hidden");
  els.lock.textContent = "LOCK 0%";
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission
// ─────────────────────────────────────────────────────────────────────────────

export function createMission(system: SystemDef, tier: number): MissionRuntime {
  const def = getMission(system, tier);
  return {
    def: {
      id: def.id,
      title: def.title,
      goalKills: def.goalKills,
      rewardCredits: def.rewardCredits
    },
    kills: 0,
    wave: 0,
    completed: false,
    message: "",
    messageTimer: 0
  };
}
