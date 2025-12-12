import "./style.css";
import { createGame } from "@xwingz/core";
import { createBasicRenderer } from "@xwingz/render";
import {
  GalaxyCache,
  createRng,
  deriveSeed,
  getEncounter,
  getFighterArchetype,
  type Vec3i,
  type SystemDef
} from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  computeInterceptTime,
  createSpaceInput,
  dogfightAISystem,
  getPlayerShip,
  getProjectiles,
  getTargetables,
  aiWeaponSystem,
  spaceflightSystem,
  spawnPlayerShip,
  targetingSystem,
  weaponSystem,
  projectileSystem,
  shieldRegenSystem,
  FighterBrain,
  Shield,
  Health,
  HitRadius,
  LaserWeapon,
  Ship,
  Targetable,
  Targeting,
  Transform,
  Velocity
} from "@xwingz/gameplay";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { addComponent, addEntity, removeEntity } from "bitecs";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

root.innerHTML = `
  <canvas id="game-canvas"></canvas>
  <div id="hud"></div>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
if (!canvas) throw new Error("canvas not found");

const { renderer, scene, camera } = createBasicRenderer(canvas);
camera.position.set(0, 200, 600);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 50;
controls.maxDistance = 5000;

const hud = document.querySelector<HTMLDivElement>("#hud")!;

const globalSeed = 42n;
const cache = new GalaxyCache({ globalSeed }, { maxSectors: 256 });

type Mode = "map" | "flight";
let mode: Mode = "map";

// ---- Galaxy map state ----
let centerSector: Vec3i = [0, 0, 0];
let radius = 2;
let systemsPoints: THREE.Points | null = null;
let selectedSystem: SystemDef | null = null;
let selectedMarker: THREE.Mesh | null = null;
const GALAXY_SCALE = 1000;

const factionColors: Record<string, number> = {
  republic: 0x5aa2ff,
  empire: 0xff4a4a,
  hutts: 0x7cff5a,
  pirates: 0xffb347,
  independent: 0xb9b9b9,
  sith_cult: 0xad5aff,
  jedi_remnant: 0x77ffd4
};

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 25; // forgiving selection radius
const mouse = new THREE.Vector2();

function rebuildGalaxy() {
  selectedSystem = null;
  if (selectedMarker) selectedMarker.visible = false;
  if (systemsPoints) {
    scene.remove(systemsPoints);
    systemsPoints.geometry.dispose();
    (systemsPoints.material as THREE.Material).dispose();
    systemsPoints = null;
  }

  const sectors = cache.sectorsInRadius(centerSector, radius);
  const systems = sectors.flatMap((sector) =>
    sector.systems.map((_, i) => cache.system(sector.coord, i))
  );

  const positions = new Float32Array(systems.length * 3);
  const colors = new Float32Array(systems.length * 3);
  const scale = GALAXY_SCALE;

  systems.forEach((sys, idx) => {
    positions[idx * 3 + 0] = sys.galaxyPos[0] * scale;
    positions[idx * 3 + 1] = sys.galaxyPos[1] * scale;
    positions[idx * 3 + 2] = sys.galaxyPos[2] * scale;

    const c = factionColors[sys.controllingFaction] ?? 0xffffff;
    colors[idx * 3 + 0] = ((c >> 16) & 255) / 255;
    colors[idx * 3 + 1] = ((c >> 8) & 255) / 255;
    colors[idx * 3 + 2] = (c & 255) / 255;
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({ vertexColors: true, size: 6, sizeAttenuation: true });
  systemsPoints = new THREE.Points(geo, mat);
  systemsPoints.userData.systems = systems;
  scene.add(systemsPoints);

  if (!selectedMarker) {
    const mGeo = new THREE.SphereGeometry(14, 10, 10);
    const mMat = new THREE.MeshBasicMaterial({ color: 0x7cff7c, wireframe: true });
    selectedMarker = new THREE.Mesh(mGeo, mMat);
    selectedMarker.visible = false;
    scene.add(selectedMarker);
  }

  hud.className = "hud-map";
  hud.innerText =
    `xwingz – galaxy map\n` +
    `Seed: ${globalSeed.toString()}\n` +
    `Center sector: [${centerSector.join(", ")}], radius ${radius}\n` +
    `Systems: ${systems.length}\n` +
    `WASD/Arrows move sector | Q/E Z-axis | +/- radius | click system | Enter to fly`;
}

// ---- Flight state ----
const input = createSpaceInput(window);
let currentSystem: SystemDef | null = null;
let jumpIndex = 0;
let starfield: THREE.Points | null = null;
let shipEid: number | null = null;
let shipMesh: THREE.Object3D | null = null;
const projectileMeshes = new Map<number, THREE.Mesh>();
const targetMeshes = new Map<number, THREE.Object3D>();
let targetEids: number[] = [];
let lockValue = 0;
let lockTargetEid = -1;
const boltForward = new THREE.Vector3(0, 0, 1);

type FlightHudElements = {
  speed: HTMLDivElement;
  throttle: HTMLDivElement;
  system: HTMLDivElement;
  faction: HTMLDivElement;
  target: HTMLDivElement;
  lock: HTMLDivElement;
  bracket: HTMLDivElement;
  lead: HTMLDivElement;
};
let flightHud: FlightHudElements | null = null;

type ScreenPoint = { x: number; y: number; onScreen: boolean; behind: boolean };
const tmpNdc = new THREE.Vector3();
const tmpHudTargetPos = new THREE.Vector3();
const tmpHudLeadPos = new THREE.Vector3();
const tmpHudQ = new THREE.Quaternion();
const tmpHudForward = new THREE.Vector3();
const tmpHudDir = new THREE.Vector3();
const tmpTargetScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };
const tmpLeadScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };
const tmpCamOffset = new THREE.Vector3();
const tmpLookOffset = new THREE.Vector3();
const tmpLookAt = new THREE.Vector3();
const tmpExplosionPos = new THREE.Vector3();

type ExplosionFx = { mesh: THREE.Mesh; age: number; duration: number };
const explosions: ExplosionFx[] = [];
const explosionPool: ExplosionFx[] = [];
const explosionGeo = new THREE.SphereGeometry(1, 14, 14);

function buildLocalStarfield(seed: bigint) {
  if (starfield) {
    scene.remove(starfield);
    starfield.geometry.dispose();
    (starfield.material as THREE.Material).dispose();
    starfield = null;
  }
  const rng = createRng(seed);
  const count = 2500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 400 + rng.range(0, 6000);
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(rng.range(-1, 1));
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0x88aaff, size: 1.1, sizeAttenuation: true });
  starfield = new THREE.Points(geo, mat);
  scene.add(starfield);
}

function buildShipMesh() {
  const group = new THREE.Group();

  const bodyGeo = new THREE.CylinderGeometry(0.6, 0.9, 5, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xbfc7d9, metalness: 0.3, roughness: 0.6 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const wingGeo = new THREE.BoxGeometry(4.5, 0.15, 1.2);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b8 });
  const wingTop = new THREE.Mesh(wingGeo, wingMat);
  wingTop.position.y = 0.6;
  const wingBottom = new THREE.Mesh(wingGeo, wingMat);
  wingBottom.position.y = -0.6;
  group.add(wingTop, wingBottom);

  const noseGeo = new THREE.ConeGeometry(0.6, 2.5, 8);
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.position.z = -3.6;
  nose.rotation.x = Math.PI;
  group.add(nose);

  return group;
}

function buildEnemyMesh(id: string) {
  if (id === "tie_ln") {
    const group = new THREE.Group();
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.25, roughness: 0.6 })
    );
    group.add(cockpit);
    const panelGeo = new THREE.BoxGeometry(0.6, 6.5, 6.5);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c23, metalness: 0.2, roughness: 0.7 });
    const left = new THREE.Mesh(panelGeo, panelMat);
    left.position.x = -4.2;
    const right = new THREE.Mesh(panelGeo, panelMat);
    right.position.x = 4.2;
    group.add(left, right);
    return group;
  }

  const group = buildShipMesh();
  group.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.material) {
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(0x8a8f9d);
    }
  });
  group.scale.setScalar(0.8);
  return group;
}

function spawnEnemyFighters(system: SystemDef) {
  // clear existing AI targets
  for (const eid of targetEids) {
    removeEntity(game.world, eid);
  }
  for (const mesh of targetMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  targetEids = [];
  targetMeshes.clear();

  const encounter = getEncounter(system);
  const rng = createRng(encounter.seed);

  for (let i = 0; i < encounter.count; i++) {
    const archetypeId = encounter.archetypes[i] ?? "z95";
    const archetype = getFighterArchetype(archetypeId);

    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(encounter.spawnRing.min, encounter.spawnRing.max);
    const y = rng.range(-140, 140);
    const pos = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r - rng.range(300, 800));

    const eid = addEntity(game.world);
    addComponent(game.world, Transform, eid);
    addComponent(game.world, Velocity, eid);
    addComponent(game.world, AngularVelocity, eid);
    addComponent(game.world, Ship, eid);
    addComponent(game.world, LaserWeapon, eid);
    addComponent(game.world, Targetable, eid);
    addComponent(game.world, Health, eid);
    addComponent(game.world, HitRadius, eid);
    addComponent(game.world, Shield, eid);
    addComponent(game.world, FighterBrain, eid);
    addComponent(game.world, AIControlled, eid);

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
}

function syncTargets() {
  const aliveTargets = getTargetables(game.world);
  const aliveSet = new Set(aliveTargets);

  for (const [eid, mesh] of targetMeshes) {
    if (aliveSet.has(eid)) continue;
    spawnExplosion(tmpExplosionPos.copy(mesh.position));
    scene.remove(mesh);
    disposeObject(mesh);
    targetMeshes.delete(eid);
  }

  targetEids = aliveTargets;
  for (const eid of aliveTargets) {
    const mesh = targetMeshes.get(eid);
    if (!mesh) continue;
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
    const qx = Transform.qx[eid] ?? 0;
    const qy = Transform.qy[eid] ?? 0;
    const qz = Transform.qz[eid] ?? 0;
    const qw = Transform.qw[eid] ?? 1;
    mesh.quaternion.set(qx, qy, qz, qw);
  }
}

function syncProjectiles() {
  const ps = getProjectiles(game.world);
  const alive = new Set(ps);

  for (const eid of ps) {
    let mesh = projectileMeshes.get(eid);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xff4444 })
      );
      mesh.rotation.x = Math.PI / 2;
      scene.add(mesh);
      projectileMeshes.set(eid, mesh);
    }
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);

    const dv = new THREE.Vector3(Velocity.vx[eid] ?? 0, Velocity.vy[eid] ?? 0, Velocity.vz[eid] ?? 0);
    if (dv.lengthSq() > 1e-4) {
      dv.normalize();
      mesh.quaternion.setFromUnitVectors(boltForward, dv);
    }
  }

  for (const [eid, mesh] of projectileMeshes) {
    if (alive.has(eid)) continue;
    scene.remove(mesh);
    disposeObject(mesh);
    projectileMeshes.delete(eid);
  }
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as any;
    if (mat && typeof mat.dispose === "function") mat.dispose();
  });
}

function resetExplosions() {
  for (const fx of explosions) {
    scene.remove(fx.mesh);
    explosionPool.push(fx);
  }
  explosions.length = 0;
}

function spawnExplosion(pos: THREE.Vector3, color = 0xffaa55) {
  const fx =
    explosionPool.pop() ??
    (() => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(explosionGeo, mat);
      mesh.renderOrder = 10;
      return { mesh, age: 0, duration: 0.7 } satisfies ExplosionFx;
    })();

  fx.age = 0;
  fx.duration = 0.7;
  fx.mesh.position.copy(pos);
  fx.mesh.scale.setScalar(1);
  const mat = fx.mesh.material as THREE.MeshBasicMaterial;
  mat.color.setHex(color);
  mat.opacity = 1;

  scene.add(fx.mesh);
  explosions.push(fx);
}

function updateExplosions(dt: number) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const fx = explosions[i]!;
    fx.age += dt;
    const t = fx.age / fx.duration;
    const scale = 1 + t * 8;
    fx.mesh.scale.setScalar(scale);
    const mat = fx.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, 1 - t);
    if (t >= 1) {
      scene.remove(fx.mesh);
      explosions.splice(i, 1);
      explosionPool.push(fx);
    }
  }
}

function setupFlightHud() {
  hud.className = "hud-xwing";
  hud.innerHTML = `
    <div class="hud-reticle">
      <div class="reticle-circle"></div>
      <div class="reticle-cross"></div>
    </div>
    <div class="hud-top">
      <div id="hud-target" class="hud-target">NO TARGET</div>
      <div id="hud-lock" class="hud-lock">LOCK 0%</div>
    </div>
    <div id="hud-bracket" class="hud-bracket hidden"></div>
    <div id="hud-lead" class="hud-lead hidden"></div>
    <div class="hud-left">
      <div class="hud-label">SPD</div>
      <div id="hud-speed" class="hud-value">0</div>
      <div class="hud-label">THR</div>
      <div id="hud-throttle" class="hud-value">0%</div>
    </div>
    <div class="hud-right">
      <div class="hud-label">SYS</div>
      <div id="hud-system" class="hud-value"></div>
      <div class="hud-label">FAC</div>
      <div id="hud-faction" class="hud-value"></div>
    </div>
    <div class="hud-bottom">
      <div class="hud-label">HYPERSPACE: H</div>
      <div class="hud-label">TARGET: T</div>
      <div class="hud-label">MAP: M</div>
      <div class="hud-label">BOOST: SHIFT</div>
      <div class="hud-label">BRAKE: X</div>
    </div>
  `;

  const q = <T extends HTMLElement>(sel: string) => {
    const el = hud.querySelector<T>(sel);
    if (!el) throw new Error(`HUD element not found: ${sel}`);
    return el;
  };
  flightHud = {
    speed: q<HTMLDivElement>("#hud-speed"),
    throttle: q<HTMLDivElement>("#hud-throttle"),
    system: q<HTMLDivElement>("#hud-system"),
    faction: q<HTMLDivElement>("#hud-faction"),
    target: q<HTMLDivElement>("#hud-target"),
    lock: q<HTMLDivElement>("#hud-lock"),
    bracket: q<HTMLDivElement>("#hud-bracket"),
    lead: q<HTMLDivElement>("#hud-lead")
  };
}

function enterFlightMode(system: SystemDef) {
  mode = "flight";
  currentSystem = system;
  jumpIndex = 0;

  controls.enabled = false;
  resetExplosions();
  scene.clear();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(200, 400, 150);
  scene.add(sun);
  scene.add(new THREE.PointLight(0x88aaff, 0.6, 0, 2));

  buildLocalStarfield(system.seed);

  // Clear any leftover projectiles from prior flights.
  for (const eid of projectileMeshes.keys()) {
    removeEntity(game.world, eid);
  }
  projectileMeshes.clear();

  if (shipEid !== null) {
    removeEntity(game.world, shipEid);
  }
  if (shipMesh) {
    scene.remove(shipMesh);
    shipMesh = null;
  }

  shipEid = spawnPlayerShip(game.world);
  shipMesh = buildShipMesh();
  shipMesh.scale.setScalar(2.5);
  scene.add(shipMesh);

  spawnEnemyFighters(system);

  camera.position.set(0, 6, 20);
  camera.lookAt(0, 0, -50);

  setupFlightHud();
  updateFlightHud();
}

function enterMapMode() {
  mode = "map";
  controls.enabled = true;
  flightHud = null;
  resetExplosions();

  // Remove flight-only ECS entities and meshes.
  for (const eid of projectileMeshes.keys()) {
    removeEntity(game.world, eid);
  }
  projectileMeshes.clear();

  for (const eid of targetEids) {
    removeEntity(game.world, eid);
  }
  targetEids = [];
  for (const mesh of targetMeshes.values()) {
    disposeObject(mesh);
  }
  targetMeshes.clear();

  scene.clear();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  camera.position.set(0, 200, 600);
  rebuildGalaxy();
}

function projectToScreen(pos: THREE.Vector3, out: ScreenPoint) {
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

function updateFlightHud(dtSeconds = 1 / 60) {
  const els = flightHud;
  if (!shipEid || !els) return;
  const v =
    Math.hypot(Velocity.vx[shipEid], Velocity.vy[shipEid], Velocity.vz[shipEid]) || 0;
  const t = Ship.throttle[shipEid] || 0;

  els.speed.textContent = v.toFixed(0);
  els.throttle.textContent = `${Math.round(t * 100)}%`;
  if (currentSystem) {
    els.system.textContent = currentSystem.id;
    els.faction.textContent = currentSystem.controllingFaction;
  }

  const teid = Targeting.targetEid[shipEid] ?? -1;
  if (teid !== lockTargetEid) {
    lockTargetEid = teid;
    lockValue = 0;
  }

  if (teid >= 0 && Transform.x[teid] !== undefined) {
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

    // Bracket on target.
    const screen = projectToScreen(tmpHudTargetPos.set(tx, ty, tz), tmpTargetScreen);
    els.bracket.classList.remove("hidden");
    els.bracket.classList.toggle("offscreen", !screen.onScreen);
    els.bracket.classList.toggle("behind", screen.behind);
    els.bracket.style.left = `${screen.x}px`;
    els.bracket.style.top = `${screen.y}px`;

    // Lead pip.
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
    const leadScreen = projectToScreen(leadPos, tmpLeadScreen);
    els.lead.classList.toggle("hidden", !leadScreen.onScreen);
    if (leadScreen.onScreen) {
      els.lead.style.left = `${leadScreen.x}px`;
      els.lead.style.top = `${leadScreen.y}px`;
    }

    // Lock meter: fill when target is in front cone and range.
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
    const baseCone = 0.07; // ~4 degrees
    const cone = baseCone + sizeAngle;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const inCone = screen.onScreen && angle < cone && dist < 900;

    const lockGain = 0.9;
    const lockDecay = 1.3;
    lockValue += (inCone ? lockGain : -lockDecay) * dtSeconds;
    lockValue = Math.min(1, Math.max(0, lockValue));

    const pct = Math.round(lockValue * 100);
    els.lock.textContent = lockValue >= 1 ? "LOCK" : `LOCK ${pct}%`;
  } else {
    els.target.textContent = "NO TARGET";
    els.bracket.classList.add("hidden");
    els.lead.classList.add("hidden");
    lockValue = 0;
    lockTargetEid = -1;
    els.lock.textContent = "LOCK 0%";
  }
}

function hyperspaceJump() {
  if (!currentSystem) return;

  const neighbors = cache
    .sectorsInRadius(currentSystem.sectorCoord, 1)
    .flatMap((sector) => sector.systems.map((_, i) => cache.system(sector.coord, i)))
    .filter((s) => s.id !== currentSystem!.id);

  if (neighbors.length === 0) return;

  const jumpSeed = deriveSeed(currentSystem.seed, "jump", jumpIndex++);
  const rng = createRng(jumpSeed);
  const next = rng.pick(neighbors);
  currentSystem = next;

  buildLocalStarfield(next.seed);
  spawnEnemyFighters(next);
  if (shipEid !== null) {
    Transform.x[shipEid] = 0;
    Transform.y[shipEid] = 0;
    Transform.z[shipEid] = 0;
    Velocity.vx[shipEid] = 0;
    Velocity.vy[shipEid] = 0;
    Velocity.vz[shipEid] = 0;
  }
  updateFlightHud();
}

// ---- Input handlers (map only) ----
window.addEventListener("keydown", (e) => {
  if (mode !== "map") return;
  const [x, y, z] = centerSector;
  switch (e.key) {
    case "w":
    case "ArrowUp":
      centerSector = [x, y + 1, z];
      rebuildGalaxy();
      break;
    case "s":
    case "ArrowDown":
      centerSector = [x, y - 1, z];
      rebuildGalaxy();
      break;
    case "a":
    case "ArrowLeft":
      centerSector = [x - 1, y, z];
      rebuildGalaxy();
      break;
    case "d":
    case "ArrowRight":
      centerSector = [x + 1, y, z];
      rebuildGalaxy();
      break;
    case "q":
      centerSector = [x, y, z - 1];
      rebuildGalaxy();
      break;
    case "e":
      centerSector = [x, y, z + 1];
      rebuildGalaxy();
      break;
    case "+":
    case "=":
      radius = Math.min(6, radius + 1);
      rebuildGalaxy();
      break;
    case "-":
    case "_":
      radius = Math.max(0, radius - 1);
      rebuildGalaxy();
      break;
    case "Enter":
      if (selectedSystem) enterFlightMode(selectedSystem);
      break;
  }
});

window.addEventListener("pointermove", (ev) => {
  if (mode !== "map") return;
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener("click", (ev) => {
  if (mode !== "map" || !systemsPoints) return;
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(systemsPoints);
  if (hits.length === 0) return;
  const hit = hits[0];
  const idx = hit.index ?? -1;
  const systems = systemsPoints.userData.systems as SystemDef[];
  const sys = systems[idx];
  if (!sys) return;

  selectedSystem = sys;
  if (selectedMarker) {
    selectedMarker.visible = true;
    selectedMarker.position.set(
      sys.galaxyPos[0] * GALAXY_SCALE,
      sys.galaxyPos[1] * GALAXY_SCALE,
      sys.galaxyPos[2] * GALAXY_SCALE
    );
  }
  hud.innerText =
    `xwingz – galaxy map\n` +
    `Seed: ${globalSeed.toString()}\n` +
    `Center sector: [${centerSector.join(", ")}], radius ${radius}\n` +
    `Systems: ${systems.length}\n\n` +
    `Selected ${sys.id}\n` +
    `Star: ${sys.starClass} | planets: ${sys.planetCount}\n` +
    `Archetype: ${sys.archetypeId}\n` +
    `Faction: ${sys.controllingFaction}\n` +
    `Economy: wealth ${sys.economy.wealth.toFixed(2)}, industry ${sys.economy.industry.toFixed(2)}, security ${sys.economy.security.toFixed(2)}\n` +
    `Press Enter to fly here`;
});

// ---- Main tick ----
enterMapMode();

const game = createGame({ globalSeed });
game.setTick((dt) => {
  if (mode === "map") {
    controls.update();
    renderer.render(scene, camera);
    return;
  }

  // Flight mode
  input.update();
  targetingSystem(game.world, input.state);
  dogfightAISystem(game.world, dt);
  spaceflightSystem(game.world, input.state, dt);
  weaponSystem(game.world, input.state, dt);
  aiWeaponSystem(game.world, dt);
  projectileSystem(game.world, dt);
  shieldRegenSystem(game.world, dt);

  const player = getPlayerShip(game.world);
  if (player !== null && shipMesh) {
    shipMesh.position.set(Transform.x[player], Transform.y[player], Transform.z[player]);
    shipMesh.quaternion.set(Transform.qx[player], Transform.qy[player], Transform.qz[player], Transform.qw[player]);

    const q = shipMesh.quaternion;
    const pos = shipMesh.position;
    const camOffset = tmpCamOffset.set(0, 5, 18).applyQuaternion(q);
    const lookOffset = tmpLookOffset.set(0, 0, -40).applyQuaternion(q);
    camera.position.copy(pos).add(camOffset);
    camera.lookAt(tmpLookAt.copy(pos).add(lookOffset));
  }

  syncTargets();
  if (targetEids.length === 0 && currentSystem) {
    spawnEnemyFighters(currentSystem);
  }
  syncProjectiles();

  if (input.state.hyperspace) hyperspaceJump();
  if (input.state.toggleMap) enterMapMode();

  updateFlightHud(dt);
  updateExplosions(dt);
  renderer.render(scene, camera);
});
game.start();

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
