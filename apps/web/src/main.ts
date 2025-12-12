import "./style.css";
import { createGame } from "@xwingz/core";
import { createBasicRenderer } from "@xwingz/render";
import {
  GalaxyCache,
  createRng,
  deriveSeed,
  getEncounter,
  getFighterArchetype,
  getMission,
  type MissionDef,
  type Vec3i,
  type SystemDef
} from "@xwingz/procgen";
import {
  AIControlled,
  AngularVelocity,
  computeInterceptTime,
  createSpaceInput,
  type SpaceInputState,
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
  consumeImpactEvents,
  FighterBrain,
  Shield,
  Health,
  HitRadius,
  Team,
  Projectile,
  LaserWeapon,
  Ship,
  Targetable,
  Targeting,
  Transform,
  Velocity
} from "@xwingz/gameplay";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

root.innerHTML = `
  <canvas id="game-canvas"></canvas>
  <div id="hud"></div>
  <div id="overlay" class="overlay hidden"></div>
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
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;

const globalSeed = 42n;
const cache = new GalaxyCache({ globalSeed }, { maxSectors: 256 });

const YAVIN_DEFENSE_SYSTEM: SystemDef = {
  id: "yavin_4",
  seed: deriveSeed(globalSeed, "story", "yavin_4"),
  sectorId: "story",
  sectorCoord: [0, 0, 0],
  localPos: [0, 0, 0],
  galaxyPos: [0, 0, 0],
  archetypeId: "rebel_base",
  tags: ["jungle", "rebel_base", "massassi_temple"],
  starClass: "g",
  planetCount: 1,
  poiDensity: 1,
  controllingFaction: "republic",
  economy: { wealth: 0.55, industry: 0.6, security: 0.85 },
  storyAnchorChance: 1
};

type Mode = "map" | "flight";
let mode: Mode = "map";

// ---- Galaxy map state ----
let centerSector: Vec3i = [0, 0, 0];
let radius = 2;
let systemsPlanets: THREE.InstancedMesh | null = null;
let systemsAtmos: THREE.InstancedMesh | null = null;
let mapStarfield: THREE.Points | null = null;
let selectedSystem: SystemDef | null = null;
let selectedMarker: THREE.Mesh | null = null;
const GALAXY_SCALE = 1000;

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 25; // forgiving selection radius
const mouse = new THREE.Vector2();
const tmpMapMat = new THREE.Matrix4();

type PlanetStyleId = "desert" | "ice" | "jungle" | "ocean" | "volcanic" | "city" | "gas" | "barren" | "mystic";
type PlanetStyle = { id: PlanetStyleId; base: number; atmos: number; roughness: number };
const PLANET_STYLES: PlanetStyle[] = [
  { id: "desert", base: 0xcaa26a, atmos: 0xffd19a, roughness: 0.95 },
  { id: "ice", base: 0xa6c9ff, atmos: 0xcfe6ff, roughness: 0.9 },
  { id: "jungle", base: 0x2f6b42, atmos: 0x7cffc0, roughness: 0.98 },
  { id: "ocean", base: 0x1a4ea8, atmos: 0x66aaff, roughness: 0.75 },
  { id: "volcanic", base: 0x3b2622, atmos: 0xff7744, roughness: 0.95 },
  { id: "city", base: 0x6e7786, atmos: 0xaad4ff, roughness: 0.65 },
  { id: "gas", base: 0x7c61c8, atmos: 0xd2b7ff, roughness: 0.6 },
  { id: "barren", base: 0x6c5a4e, atmos: 0xb9b9b9, roughness: 0.98 },
  { id: "mystic", base: 0x3b1c6b, atmos: 0xad5aff, roughness: 0.7 }
];

function pickPlanetStyle(sys: SystemDef): PlanetStyle {
  if (sys.id === "yavin_4") return PLANET_STYLES.find((s) => s.id === "jungle")!;
  const tags = new Set(sys.tags ?? []);
  if (tags.has("jungle")) return PLANET_STYLES.find((s) => s.id === "jungle")!;
  if (tags.has("haunted") || tags.has("anomaly")) return PLANET_STYLES.find((s) => s.id === "mystic")!;

  if (sys.starClass === "black_hole" || sys.starClass === "neutron") return PLANET_STYLES.find((s) => s.id === "mystic")!;
  if (sys.controllingFaction === "empire") return PLANET_STYLES.find((s) => s.id === "city")!;
  if (sys.archetypeId?.includes("trade") || sys.archetypeId?.includes("core")) return PLANET_STYLES.find((s) => s.id === "city")!;
  if (sys.archetypeId?.includes("dead")) return PLANET_STYLES.find((s) => s.id === "ice")!;

  const rng = createRng(deriveSeed(sys.seed, "map_planet_style"));
  const table: PlanetStyleId[] = ["desert", "ice", "jungle", "ocean", "volcanic", "barren", "gas"];
  const pick = table[Math.floor(rng.range(0, table.length))] ?? "barren";
  return PLANET_STYLES.find((s) => s.id === pick)!;
}

function createMapNoiseTexture(seed: bigint) {
  const w = 256;
  const h = 128;
  const smallW = 64;
  const smallH = 32;
  const rng = createRng(seed);

  const small = document.createElement("canvas");
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext("2d");
  if (!sctx) throw new Error("noise ctx missing");
  const img = sctx.createImageData(smallW, smallH);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(255 * (0.45 + rng.range(-0.25, 0.25)));
    img.data[i + 0] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("noise ctx missing");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, w, h);

  // Add some large-scale banding and storms to read as planet surface.
  ctx.globalCompositeOperation = "overlay";
  for (let i = 0; i < 6; i++) {
    const y = rng.range(0, h);
    const bandH = rng.range(10, 28);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.05, 0.12)})`;
    ctx.fillRect(0, y, w, bandH);
  }
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const mapPlanetNoise = createMapNoiseTexture(deriveSeed(globalSeed, "map_planet_noise_v0"));

function rebuildGalaxy() {
  selectedSystem = null;
  if (selectedMarker) selectedMarker.visible = false;
  if (mapStarfield) {
    scene.remove(mapStarfield);
    mapStarfield.geometry.dispose();
    (mapStarfield.material as THREE.Material).dispose();
    mapStarfield = null;
  }
  if (systemsPlanets) {
    scene.remove(systemsPlanets);
    systemsPlanets.geometry.dispose();
    (systemsPlanets.material as THREE.Material).dispose();
    systemsPlanets = null;
  }
  if (systemsAtmos) {
    scene.remove(systemsAtmos);
    systemsAtmos.geometry.dispose();
    (systemsAtmos.material as THREE.Material).dispose();
    systemsAtmos = null;
  }

  const sectors = cache.sectorsInRadius(centerSector, radius);
  const systems = sectors.flatMap((sector) =>
    sector.systems.map((_, i) => cache.system(sector.coord, i))
  );

  const scale = GALAXY_SCALE;

  const planetGeo = new THREE.SphereGeometry(1, 22, 22);
  const atmosGeo = new THREE.SphereGeometry(1.05, 18, 18);
  const planetMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0
  });
  planetMat.bumpMap = mapPlanetNoise;
  planetMat.bumpScale = 0.55;
  planetMat.roughnessMap = mapPlanetNoise;
  const atmosMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide
  });

  systemsPlanets = new THREE.InstancedMesh(planetGeo, planetMat, systems.length);
  systemsAtmos = new THREE.InstancedMesh(atmosGeo, atmosMat, systems.length);
  const planets = systemsPlanets;
  const atmos = systemsAtmos;

  const radii: number[] = new Array(systems.length);
  const tmpPos = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpColor = new THREE.Color();

  systems.forEach((sys, idx) => {
    tmpPos.set(sys.galaxyPos[0] * scale, sys.galaxyPos[1] * scale, sys.galaxyPos[2] * scale);

    const rng = createRng(deriveSeed(sys.seed, "map_planet_v0"));
    const style = pickPlanetStyle(sys);
    const r = sys.id === "yavin_4" ? 22 : rng.range(10, 20);
    radii[idx] = r;

    tmpQ.identity();
    tmpS.setScalar(r);
    tmpMapMat.compose(tmpPos, tmpQ, tmpS);
    planets.setMatrixAt(idx, tmpMapMat);

    tmpS.setScalar(r * 1.08);
    tmpMapMat.compose(tmpPos, tmpQ, tmpS);
    atmos.setMatrixAt(idx, tmpMapMat);

    tmpColor.setHex(style.base);
    tmpColor.offsetHSL(rng.range(-0.03, 0.03), rng.range(-0.06, 0.06), rng.range(-0.08, 0.08));
    planets.setColorAt(idx, tmpColor);

    tmpColor.setHex(style.atmos);
    tmpColor.offsetHSL(rng.range(-0.04, 0.04), rng.range(-0.08, 0.08), rng.range(-0.08, 0.1));
    atmos.setColorAt(idx, tmpColor);
  });

  systemsPlanets.instanceMatrix.needsUpdate = true;
  systemsAtmos.instanceMatrix.needsUpdate = true;
  if (systemsPlanets.instanceColor) systemsPlanets.instanceColor.needsUpdate = true;
  if (systemsAtmos.instanceColor) systemsAtmos.instanceColor.needsUpdate = true;

  systemsPlanets.userData.systems = systems;
  systemsPlanets.userData.radii = radii;
  systemsAtmos.userData.systems = systems;
  systemsAtmos.userData.radii = radii;

  // Backdrop stars for depth (not interactive).
  {
    const rng = createRng(deriveSeed(globalSeed, "map_starfield_v0"));
    const count = 2600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2200 + rng.range(0, 9800);
      const theta = rng.range(0, Math.PI * 2);
      const phi = Math.acos(rng.range(-1, 1));
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9ab7ff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.85 });
    mapStarfield = new THREE.Points(geo, mat);
    scene.add(mapStarfield);
  }

  scene.add(systemsAtmos);
  scene.add(systemsPlanets);

  if (!selectedMarker) {
    const mGeo = new THREE.SphereGeometry(1, 14, 14);
    const mMat = new THREE.MeshBasicMaterial({ color: 0x7cff7c, wireframe: true, transparent: true, opacity: 0.85 });
    selectedMarker = new THREE.Mesh(mGeo, mMat);
    selectedMarker.visible = false;
    scene.add(selectedMarker);
  }
  if (selectedMarker && selectedMarker.parent !== scene) scene.add(selectedMarker);

  hud.className = "hud-map";
  hud.innerText =
    `xwingz – galaxy map\n` +
    `Seed: ${globalSeed.toString()}\n` +
    `Credits: ${credits} | Tier: ${missionTier}\n` +
    `Center sector: [${centerSector.join(", ")}], radius ${radius}\n` +
    `Systems: ${systems.length}\n` +
    `WASD/Arrows move sector | Q/E Z-axis | +/- radius | click system | Enter to fly | 1 Yavin mission | U upgrades`;
}

// ---- Flight state ----
const input = createSpaceInput(window);
type Scenario = "sandbox" | "yavin_defense";
let scenario: Scenario = "sandbox";
let currentSystem: SystemDef | null = null;
let jumpIndex = 0;
let starfield: THREE.Points | null = null;
let shipEid: number | null = null;
let shipMesh: THREE.Object3D | null = null;
let baseEid: number | null = null;
let baseMesh: THREE.Object3D | null = null;
let groundMesh: THREE.Mesh | null = null;
let treeTrunks: THREE.InstancedMesh | null = null;
let treeCanopies: THREE.InstancedMesh | null = null;
type TerrainParams = {
  a1: number;
  f1: number;
  p1: number;
  a2: number;
  f2: number;
  p2: number;
  yOffset: number;
};
let terrainParams: TerrainParams | null = null;
const tmpMat = new THREE.Matrix4();
const projectileMeshes = new Map<number, THREE.Mesh>();
const targetMeshes = new Map<number, THREE.Object3D>();
let targetEids: number[] = [];
let lockValue = 0;
let lockTargetEid = -1;
const boltForward = new THREE.Vector3(0, 0, 1);
let playerDead = false;
let respawnTimer = 0;
const RESPAWN_DELAY = 2.0;
let credits = 0;
let missionTier = 0;
type MissionRuntime = {
  def: MissionDef;
  kills: number;
  wave: number;
  completed: boolean;
  message: string;
  messageTimer: number;
};
let mission: MissionRuntime | null = null;

type YavinDefenseState = {
  phase: "launch" | "combat" | "success" | "fail";
  baseHpMax: number;
  enemiesTotal: number;
  enemiesKilled: number;
  rewardCredits: number;
  message: string;
  messageTimer: number;
};
let yavin: YavinDefenseState | null = null;
let allyEids: number[] = [];
const allyMeshes = new Map<number, THREE.Object3D>();

type Upgrades = {
  engine: number;
  maneuver: number;
  shields: number;
  lasers: number;
  hull: number;
};

let upgrades: Upgrades = {
  engine: 0,
  maneuver: 0,
  shields: 0,
  lasers: 0,
  hull: 0
};
let upgradesOpen = false;

const PROFILE_KEY = "xwingz_profile_v0";
let saveHandle: number | null = null;

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<{
      v: number;
      credits: number;
      missionTier: number;
      upgrades: Partial<Upgrades>;
    }>;
    if (typeof parsed.credits === "number") credits = Math.max(0, Math.floor(parsed.credits));
    if (typeof parsed.missionTier === "number") missionTier = Math.max(0, Math.floor(parsed.missionTier));
    if (parsed.upgrades) {
      upgrades = {
        engine: clampInt(parsed.upgrades.engine ?? upgrades.engine, 0, 10),
        maneuver: clampInt(parsed.upgrades.maneuver ?? upgrades.maneuver, 0, 10),
        shields: clampInt(parsed.upgrades.shields ?? upgrades.shields, 0, 10),
        lasers: clampInt(parsed.upgrades.lasers ?? upgrades.lasers, 0, 10),
        hull: clampInt(parsed.upgrades.hull ?? upgrades.hull, 0, 10)
      };
    }
  } catch {
    // ignore corrupted profile
  }
}

function saveProfile() {
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        v: 0,
        credits: Math.max(0, Math.floor(credits)),
        missionTier: Math.max(0, Math.floor(missionTier)),
        upgrades
      })
    );
  } catch {
    // ignore quota / storage errors for now
  }
}

function scheduleSave() {
  if (saveHandle !== null) return;
  saveHandle = window.setTimeout(() => {
    saveHandle = null;
    saveProfile();
  }, 500);
}

type UpgradeId = keyof Upgrades;
type UpgradeDef = {
  id: UpgradeId;
  name: string;
  summary: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
};

const UPGRADE_DEFS: UpgradeDef[] = [
  { id: "engine", name: "ENGINES", summary: "+SPD/+ACC", baseCost: 220, growth: 1.55, maxLevel: 10 },
  { id: "maneuver", name: "MANEUVER", summary: "+TURN", baseCost: 200, growth: 1.55, maxLevel: 10 },
  { id: "shields", name: "SHIELDS", summary: "+MAX/+REGEN", baseCost: 240, growth: 1.6, maxLevel: 10 },
  { id: "lasers", name: "LASERS", summary: "+DMG/+ROF", baseCost: 280, growth: 1.6, maxLevel: 10 },
  { id: "hull", name: "HULL", summary: "+HP", baseCost: 200, growth: 1.55, maxLevel: 10 }
];

function getUpgradeCost(def: UpgradeDef) {
  const level = upgrades[def.id];
  if (level >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

function openUpgrades() {
  upgradesOpen = true;
  renderUpgradesOverlay();
  overlay.classList.remove("hidden");
}

function closeUpgrades() {
  upgradesOpen = false;
  overlay.classList.add("hidden");
  overlay.innerHTML = "";
}

function toggleUpgrades() {
  if (upgradesOpen) closeUpgrades();
  else openUpgrades();
}

function renderUpgradesOverlay() {
  const lines = UPGRADE_DEFS.map((def, idx) => {
    const level = upgrades[def.id];
    const cost = getUpgradeCost(def);
    const locked = cost === null ? "MAX" : cost > credits ? `NEED ${cost}` : `BUY ${cost}`;
    return `<div class="overlay-row">${idx + 1}) ${def.name}  LV ${level}/${def.maxLevel}  <span class="muted">${def.summary}</span>  <span class="right">${locked} CR</span></div>`;
  }).join("");

  overlay.innerHTML = `
    <div class="overlay-panel">
      <div class="overlay-title">HANGAR UPGRADES</div>
      <div class="overlay-sub">Credits: ${credits} • Tier: ${missionTier}</div>
      <div class="overlay-list">${lines}</div>
      <div class="overlay-hint">Press 1–5 to buy • U/Esc to close</div>
    </div>
  `;
}

function buyUpgrade(def: UpgradeDef) {
  const cost = getUpgradeCost(def);
  if (cost === null) return;
  if (credits < cost) return;

  credits -= cost;
  upgrades[def.id] += 1;
  applyUpgradesToPlayer(true);
  scheduleSave();
  renderUpgradesOverlay();
}

function computePlayerStats() {
  const base = getFighterArchetype("xwing_player");
  const engineLvl = upgrades.engine;
  const maneuverLvl = upgrades.maneuver;
  const shieldLvl = upgrades.shields;
  const laserLvl = upgrades.lasers;
  const hullLvl = upgrades.hull;

  const maxSpeed = base.maxSpeed * (1 + engineLvl * 0.06);
  const accel = base.accel * (1 + engineLvl * 0.08);
  const turnRate = base.turnRate * (1 + maneuverLvl * 0.08);

  const maxSp = 60 + shieldLvl * 14;
  const regen = 6 + shieldLvl * 0.8;

  const maxHp = base.hp + hullLvl * 16;

  const damage = base.damage * (1 + laserLvl * 0.08);
  const weaponCooldown = Math.max(0.06, base.weaponCooldown * (1 - laserLvl * 0.03));

  return {
    maxSpeed,
    accel,
    turnRate,
    maxSp,
    regen,
    maxHp,
    damage,
    weaponCooldown,
    projectileSpeed: base.projectileSpeed
  };
}

function applyUpgradesToPlayer(refill = false) {
  if (shipEid === null) return;
  const stats = computePlayerStats();

  Ship.maxSpeed[shipEid] = stats.maxSpeed;
  Ship.accel[shipEid] = stats.accel;
  Ship.turnRate[shipEid] = stats.turnRate;

  LaserWeapon.damage[shipEid] = stats.damage;
  LaserWeapon.cooldown[shipEid] = stats.weaponCooldown;
  LaserWeapon.projectileSpeed[shipEid] = stats.projectileSpeed;
  LaserWeapon.cooldownRemaining[shipEid] = Math.min(LaserWeapon.cooldownRemaining[shipEid] ?? 0, stats.weaponCooldown);

  Shield.maxSp[shipEid] = stats.maxSp;
  Shield.regenRate[shipEid] = stats.regen;
  if (refill) Shield.sp[shipEid] = stats.maxSp;

  Health.maxHp[shipEid] = stats.maxHp;
  if (refill) Health.hp[shipEid] = stats.maxHp;
}

window.addEventListener("beforeunload", () => saveProfile());
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;

  const k = e.key.toLowerCase();
  if (k === "u") {
    toggleUpgrades();
    e.preventDefault();
    return;
  }

  if (!upgradesOpen) return;

  if (e.key === "Escape") {
    closeUpgrades();
    e.preventDefault();
    return;
  }

  const num = Number.parseInt(e.key, 10);
  if (!Number.isFinite(num)) return;
  const idx = num - 1;
  const def = UPGRADE_DEFS[idx];
  if (!def) return;

  buyUpgrade(def);
  e.preventDefault();
});

loadProfile();

type FlightHudElements = {
  speed: HTMLDivElement;
  throttle: HTMLDivElement;
  shield: HTMLDivElement;
  hp: HTMLDivElement;
  system: HTMLDivElement;
  faction: HTMLDivElement;
  credits: HTMLDivElement;
  target: HTMLDivElement;
  lock: HTMLDivElement;
  mission: HTMLDivElement;
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
const tmpProjVel = new THREE.Vector3();
const camSmoothPos = new THREE.Vector3();
const camSmoothLook = new THREE.Vector3();
let camInit = false;

type ExplosionFx = { mesh: THREE.Mesh; age: number; duration: number; maxScale: number };
const explosions: ExplosionFx[] = [];
const explosionPool: ExplosionFx[] = [];
const explosionGeo = new THREE.SphereGeometry(1, 14, 14);

function createGlowTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas ctx missing");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.8)");
  g.addColorStop(0.5, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glowTex = createGlowTexture();
const boltGeo = new THREE.CylinderGeometry(0.16, 0.16, 10, 6);
const boltMatFriendly = new THREE.MeshBasicMaterial({
  color: 0xff4444,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const boltMatEnemy = new THREE.MeshBasicMaterial({
  color: 0x55ff66,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

function makeBoltGlow(color: number) {
  const mat = new THREE.SpriteMaterial({
    map: glowTex,
    color,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(6.5);
  sprite.renderOrder = 9;
  return sprite;
}

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

function clearPlanetaryScene() {
  if (groundMesh) {
    scene.remove(groundMesh);
    disposeObject(groundMesh);
    groundMesh = null;
  }
  if (treeTrunks) {
    scene.remove(treeTrunks);
    disposeObject(treeTrunks);
    treeTrunks = null;
  }
  if (treeCanopies) {
    scene.remove(treeCanopies);
    disposeObject(treeCanopies);
    treeCanopies = null;
  }
  if (baseMesh) {
    scene.remove(baseMesh);
    disposeObject(baseMesh);
    baseMesh = null;
  }
  if (baseEid !== null) {
    removeEntity(game.world, baseEid);
    baseEid = null;
  }
  terrainParams = null;
  scene.fog = null;
}

function yavinTerrainHeight(x: number, z: number) {
  const p = terrainParams;
  if (!p) return 0;
  const h1 = Math.sin(x * p.f1 + p.p1) * Math.cos(z * p.f1 + p.p1) * p.a1;
  const h2 = Math.sin(x * p.f2 + p.p2) * Math.sin(z * p.f2 + p.p2) * p.a2;
  return h1 + h2 + p.yOffset;
}

function clampEntityAboveYavinTerrain(eid: number, clearance: number) {
  if (!terrainParams) return;
  if (!hasComponent(game.world, Transform, eid)) return;

  const x = Transform.x[eid] ?? 0;
  const z = Transform.z[eid] ?? 0;
  const minY = yavinTerrainHeight(x, z) + clearance;
  const y0 = Transform.y[eid] ?? 0;
  if (y0 >= minY) return;

  Transform.y[eid] = minY;
  if (hasComponent(game.world, Velocity, eid) && (Velocity.vy[eid] ?? 0) < 0) {
    Velocity.vy[eid] = 0;
  }
}

function buildGreatTemple() {
  const group = new THREE.Group();

  const stone = new THREE.MeshStandardMaterial({
    color: 0x5f646e,
    metalness: 0.0,
    roughness: 0.9
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0f1015, roughness: 1.0 });

  const step1 = new THREE.Mesh(new THREE.BoxGeometry(320, 34, 260), stone);
  step1.position.y = 17;
  const step2 = new THREE.Mesh(new THREE.BoxGeometry(260, 30, 210), stone);
  step2.position.y = 34 + 15;
  const step3 = new THREE.Mesh(new THREE.BoxGeometry(200, 28, 160), stone);
  step3.position.y = 34 + 30 + 14;
  const top = new THREE.Mesh(new THREE.BoxGeometry(150, 24, 110), stone);
  top.position.y = 34 + 30 + 28 + 12;

  const hangar = new THREE.Mesh(new THREE.BoxGeometry(140, 50, 26), dark);
  hangar.position.set(0, 22, 130);

  const pad = new THREE.Mesh(new THREE.BoxGeometry(160, 3, 220), new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.8 }));
  pad.position.set(0, 1.5, 250);

  group.add(step1, step2, step3, top, hangar, pad);
  group.position.set(0, 0, 0);
  return group;
}

function buildYavinPlanet(seed: bigint) {
  const rng = createRng(deriveSeed(seed, "yavin_terrain"));
  terrainParams = {
    a1: 34,
    f1: 0.0012 + rng.range(0, 0.0006),
    p1: rng.range(0, Math.PI * 2),
    a2: 18,
    f2: 0.0021 + rng.range(0, 0.001),
    p2: rng.range(0, Math.PI * 2),
    yOffset: -12
  };

  scene.fog = new THREE.Fog(0x05060b, 220, 5200);

  const size = 9000;
  const seg = 140;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i);
    pos.setZ(i, yavinTerrainHeight(x, z) - (terrainParams?.yOffset ?? 0));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 1.0 });
  groundMesh = new THREE.Mesh(geo, mat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = terrainParams.yOffset;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Light tree scatter around the temple area.
  const treeCount = 260;
  const trunkGeo = new THREE.CylinderGeometry(0.9, 1.3, 14, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1.0 });
  treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  treeTrunks.castShadow = true;
  treeTrunks.receiveShadow = true;

  const canopyGeo = new THREE.ConeGeometry(6.5, 18, 8);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1b5a34, roughness: 1.0 });
  treeCanopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  treeCanopies.castShadow = true;
  treeCanopies.receiveShadow = true;

  for (let i = 0; i < treeCount; i++) {
    let x = rng.range(-1800, 1800);
    let z = rng.range(-1800, 1800);
    // keep the runway area clearer
    if (Math.abs(x) < 260 && z > -200 && z < 520) {
      x += rng.range(260, 520) * Math.sign(x || 1);
      z += rng.range(120, 260);
    }

    const y = yavinTerrainHeight(x, z);
    const trunkY = y + 7;
    const canopyY = y + 20;
    const s = rng.range(0.85, 1.35);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));

    tmpMat.compose(new THREE.Vector3(x, trunkY, z), rot, new THREE.Vector3(s, s * rng.range(0.9, 1.25), s));
    treeTrunks.setMatrixAt(i, tmpMat);
    tmpMat.compose(new THREE.Vector3(x, canopyY, z), rot, new THREE.Vector3(s, s, s));
    treeCanopies.setMatrixAt(i, tmpMat);
  }
  treeTrunks.instanceMatrix.needsUpdate = true;
  treeCanopies.instanceMatrix.needsUpdate = true;
  scene.add(treeTrunks);
  scene.add(treeCanopies);

  baseMesh = buildGreatTemple();
  baseMesh.position.y = yavinTerrainHeight(0, 0);
  baseMesh.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  scene.add(baseMesh);
}

function buildShipMesh() {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc9d1e0, metalness: 0.35, roughness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x171a25, metalness: 0.2, roughness: 0.85 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xb02a2a, roughness: 0.7 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b8, metalness: 0.35, roughness: 0.5 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.45, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f18,
    roughness: 0.1,
    metalness: 0.0,
    transparent: true,
    opacity: 0.6
  });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x1c7cff,
    emissive: 0x2c9cff,
    emissiveIntensity: 3.0,
    roughness: 0.2
  });

  // Fuselage (reads as X-wing from silhouette, v0).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10.8, 12), hullMat);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.8, 12), hullMat);
  nose.position.z = -7.2;
  nose.rotation.x = Math.PI;
  nose.castShadow = true;
  group.add(nose);

  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.05, 2.4), darkMat);
  intake.position.set(0, -0.1, -1.0);
  intake.castShadow = true;
  group.add(intake);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 12), glassMat);
  canopy.position.set(0, 0.55, -2.0);
  canopy.scale.set(1.1, 0.75, 1.35);
  canopy.castShadow = true;
  group.add(canopy);

  // Astromech dome (quick read).
  const droid = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), hullMat);
  dome.position.y = 0.2;
  dome.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 10), hullMat);
  cap.castShadow = true;
  droid.add(cap, dome);
  droid.position.set(0.75, 0.45, 0.9);
  group.add(droid);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.8), redMat);
  stripe.position.set(-1.95, 0.2, -1.0);
  stripe.castShadow = true;
  group.add(stripe);

  // S-foils (4 wings), rotated around Z to make the X shape.
  const wingAngle = 0.52; // ~30deg
  const wingGeo = new THREE.BoxGeometry(7.8, 0.14, 1.9);
  const engineGeo = new THREE.CylinderGeometry(0.44, 0.44, 3.4, 10);
  const nozzleGeo = new THREE.CylinderGeometry(0.26, 0.32, 0.42, 10);
  const cannonGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8);

  const makeWing = (side: -1 | 1, up: -1 | 1) => {
    const w = new THREE.Group();
    w.rotation.z = up * wingAngle;

    const wing = new THREE.Mesh(wingGeo, darkMat);
    wing.position.set(side * 4.0, 0, -1.2);
    wing.castShadow = true;
    w.add(wing);

    const engine = new THREE.Mesh(engineGeo, engineMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(side * 6.55, 0, 0.2);
    engine.castShadow = true;
    w.add(engine);

    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(side * 6.55, 0, 1.95);
    w.add(nozzle);

    const glow = makeBoltGlow(0x66aaff);
    glow.position.set(side * 6.55, 0, 2.25);
    glow.scale.setScalar(4.4);
    w.add(glow);

    const cannon = new THREE.Mesh(cannonGeo, gunMat);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(side * 7.15, 0, -5.25);
    cannon.castShadow = true;
    w.add(cannon);

    return w;
  };

  group.add(makeWing(1, 1), makeWing(-1, 1), makeWing(1, -1), makeWing(-1, -1));

  return group;
}

function buildEnemyMesh(id: string) {
  if (id === "tie_ln") {
    const group = new THREE.Group();
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.25, roughness: 0.6 })
    );
    cockpit.castShadow = true;
    group.add(cockpit);
    const panelGeo = new THREE.BoxGeometry(0.6, 6.5, 6.5);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c23, metalness: 0.2, roughness: 0.7 });
    const left = new THREE.Mesh(panelGeo, panelMat);
    left.position.x = -4.2;
    left.castShadow = true;
    const right = new THREE.Mesh(panelGeo, panelMat);
    right.position.x = 4.2;
    right.castShadow = true;

    const strutGeo = new THREE.BoxGeometry(2.8, 0.35, 0.35);
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.25, roughness: 0.6 });
    const strut = new THREE.Mesh(strutGeo, strutMat);
    strut.castShadow = true;

    const glow = makeBoltGlow(0x66ff88);
    glow.position.z = 3.0;
    glow.scale.setScalar(5.2);

    group.add(left, right, strut, glow);
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

function buildAllyMesh(slot = 0) {
  const group = buildShipMesh();
  const tint = slot % 3 === 0 ? 0x9bb7ff : slot % 3 === 1 ? 0xbfffd0 : 0xffd29b;
  group.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.material) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.lerp(new THREE.Color(tint), 0.12);
  });
  return group;
}

function spawnEnemyFighters(system: SystemDef, encounterKey = "v0") {
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

  const encounter = getEncounter(system, encounterKey);
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
    addComponent(game.world, Team, eid);
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
}

function clearAllies() {
  for (const eid of allyEids) {
    if (hasComponent(game.world, Transform, eid)) removeEntity(game.world, eid);
  }
  allyEids = [];

  for (const mesh of allyMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  allyMeshes.clear();
}

function syncAllies() {
  for (let i = allyEids.length - 1; i >= 0; i--) {
    const eid = allyEids[i]!;
    if (!hasComponent(game.world, Transform, eid) || !hasComponent(game.world, Health, eid) || (Health.hp[eid] ?? 0) <= 0) {
      const mesh = allyMeshes.get(eid);
      if (mesh) {
        spawnExplosion(tmpExplosionPos.copy(mesh.position), 0x66aaff);
        scene.remove(mesh);
        disposeObject(mesh);
        allyMeshes.delete(eid);
      }
      allyEids.splice(i, 1);
      continue;
    }

    const mesh = allyMeshes.get(eid);
    if (!mesh) continue;
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
    mesh.quaternion.set(Transform.qx[eid] ?? 0, Transform.qy[eid] ?? 0, Transform.qz[eid] ?? 0, Transform.qw[eid] ?? 1);
  }
}

function syncTargets() {
  const aliveTargets = getTargetables(game.world);
  const aliveSet = new Set(aliveTargets);
  let killed = 0;

  for (const [eid, mesh] of targetMeshes) {
    if (aliveSet.has(eid)) continue;
    killed += 1;
    spawnExplosion(tmpExplosionPos.copy(mesh.position));
    scene.remove(mesh);
    disposeObject(mesh);
    targetMeshes.delete(eid);
  }

  if (killed > 0 && !playerDead) {
    if (scenario === "sandbox" && mission && !mission.completed) {
      mission.kills += killed;
      credits += killed * 5;

      if (mission.kills >= mission.def.goalKills) {
        mission.kills = mission.def.goalKills;
        mission.completed = true;
        credits += mission.def.rewardCredits;
        missionTier += 1;
        mission.message = `MISSION COMPLETE  +${mission.def.rewardCredits} CR`;
        mission.messageTimer = 4;
      }

      scheduleSave();
    }

    if (scenario === "yavin_defense" && yavin && yavin.phase === "combat") {
      yavin.enemiesKilled += killed;
      credits += killed * 10;
      if (yavin.enemiesKilled >= yavin.enemiesTotal && aliveTargets.length === 0) {
        yavin.phase = "success";
        credits += yavin.rewardCredits;
        yavin.message = `VICTORY  +${yavin.rewardCredits} CR`;
        yavin.messageTimer = 6;
        missionTier += 1;
      }
      scheduleSave();
    }
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
      const owner = Projectile.owner[eid] ?? -1;
      const ownerTeam = owner >= 0 && hasComponent(game.world, Team, owner) ? (Team.id[owner] ?? -1) : -1;
      const friendly = ownerTeam === 0;
      mesh = new THREE.Mesh(boltGeo, friendly ? boltMatFriendly : boltMatEnemy);
      mesh.rotation.x = Math.PI / 2;
      mesh.renderOrder = 8;
      mesh.add(makeBoltGlow(friendly ? 0xff6666 : 0x77ff88));
      scene.add(mesh);
      projectileMeshes.set(eid, mesh);

      if (owner === shipEid) {
        spawnExplosion(
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

function spawnExplosion(pos: THREE.Vector3, color = 0xffaa55, duration = 0.7, maxScale = 8) {
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
      return { mesh, age: 0, duration: 0.7, maxScale: 8 } satisfies ExplosionFx;
    })();

  fx.age = 0;
  fx.duration = duration;
  fx.maxScale = maxScale;
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
    const scale = 1 + t * fx.maxScale;
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
      <div id="hud-mission" class="hud-mission"></div>
    </div>
    <div id="hud-bracket" class="hud-bracket hidden"></div>
    <div id="hud-lead" class="hud-lead hidden"></div>
    <div class="hud-left">
      <div class="hud-label">SPD</div>
      <div id="hud-speed" class="hud-value">0</div>
      <div class="hud-label">THR</div>
      <div id="hud-throttle" class="hud-value">0%</div>
      <div class="hud-label">SHD</div>
      <div id="hud-shield" class="hud-value">0</div>
      <div class="hud-label">HP</div>
      <div id="hud-hp" class="hud-value">0</div>
    </div>
    <div class="hud-right">
      <div class="hud-label">SYS</div>
      <div id="hud-system" class="hud-value"></div>
      <div class="hud-label">FAC</div>
      <div id="hud-faction" class="hud-value"></div>
      <div class="hud-label">CR</div>
      <div id="hud-credits" class="hud-value">0</div>
    </div>
    <div class="hud-bottom">
      <div class="hud-label">HYPERSPACE: H</div>
      <div class="hud-label">TARGET: T</div>
      <div class="hud-label">MAP: M</div>
      <div class="hud-label">BOOST: SHIFT</div>
      <div class="hud-label">BRAKE: X</div>
      <div class="hud-label">UPGRADES: U</div>
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
    shield: q<HTMLDivElement>("#hud-shield"),
    hp: q<HTMLDivElement>("#hud-hp"),
    system: q<HTMLDivElement>("#hud-system"),
    faction: q<HTMLDivElement>("#hud-faction"),
    credits: q<HTMLDivElement>("#hud-credits"),
    target: q<HTMLDivElement>("#hud-target"),
    lock: q<HTMLDivElement>("#hud-lock"),
    mission: q<HTMLDivElement>("#hud-mission"),
    bracket: q<HTMLDivElement>("#hud-bracket"),
    lead: q<HTMLDivElement>("#hud-lead")
  };
}

function enterFlightMode(system: SystemDef, nextScenario: Scenario = "sandbox") {
  if (upgradesOpen) closeUpgrades();
  mode = "flight";
  scenario = nextScenario;
  currentSystem = system;
  jumpIndex = 0;
  playerDead = false;
  respawnTimer = 0;
  mission = null;
  yavin = null;
  camInit = false;

  controls.enabled = false;
  resetExplosions();
  clearAllies();
  clearPlanetaryScene();
  scene.clear();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(200, 400, 150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 9000;
  sun.shadow.camera.left = -2400;
  sun.shadow.camera.right = 2400;
  sun.shadow.camera.top = 2400;
  sun.shadow.camera.bottom = -2400;
  scene.add(sun);
  scene.add(new THREE.PointLight(0x88aaff, 0.6, 0, 2));

  if (scenario === "yavin_defense") {
    buildYavinPlanet(system.seed);
  } else {
    buildLocalStarfield(system.seed);
  }

  // Clear any leftover projectiles from prior flights.
  clearProjectiles();

  respawnPlayer();

  if (scenario === "yavin_defense") {
    startYavinDefense(system);
  } else {
    startMission(system);
  }

  camera.position.set(0, 6, 20);
  camera.lookAt(0, 0, -50);

  setupFlightHud();
  updateFlightHud();
}

function clearProjectiles() {
  const ps = getProjectiles(game.world);
  for (const eid of ps) removeEntity(game.world, eid);
  for (const mesh of projectileMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  projectileMeshes.clear();
}

function respawnPlayer() {
  if (shipEid !== null) {
    removeEntity(game.world, shipEid);
  }
  if (shipMesh) {
    scene.remove(shipMesh);
    disposeObject(shipMesh);
    shipMesh = null;
  }

  shipEid = spawnPlayerShip(game.world);
  applyUpgradesToPlayer(true);
  shipMesh = buildShipMesh();
  shipMesh.scale.setScalar(2.5);
  shipMesh.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = false;
  });
  scene.add(shipMesh);
  camInit = false;

  lockValue = 0;
  lockTargetEid = -1;
}

function startMission(system: SystemDef) {
  mission = {
    def: getMission(system, missionTier),
    kills: 0,
    wave: 0,
    completed: false,
    message: "",
    messageTimer: 0
  };
  spawnMissionWave(system);
}

function spawnMissionWave(system: SystemDef) {
  if (!mission) return;
  const key = `${mission.def.id}:wave:${mission.wave}`;
  mission.wave += 1;
  spawnEnemyFighters(system, key);
}

function startYavinDefense(system: SystemDef) {
  mission = null;
  yavin = {
    phase: "launch",
    baseHpMax: 1200,
    enemiesTotal: 10,
    enemiesKilled: 0,
    rewardCredits: 1500,
    message: "RED SQUADRON: LAUNCH! DEFEND THE GREAT TEMPLE.",
    messageTimer: 6
  };

  // Clean slate.
  clearAllies();
  // Clear enemies (reuse existing function behavior).
  for (const eid of targetEids) removeEntity(game.world, eid);
  targetEids = [];
  for (const mesh of targetMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  targetMeshes.clear();

  // Base entity (the Great Temple).
  if (baseMesh) {
    const eid = addEntity(game.world);
    addComponent(game.world, Transform, eid);
    addComponent(game.world, Team, eid);
    addComponent(game.world, Health, eid);
    addComponent(game.world, HitRadius, eid);

    baseEid = eid;
    Team.id[eid] = 0;
    Health.hp[eid] = yavin.baseHpMax;
    Health.maxHp[eid] = yavin.baseHpMax;
    HitRadius.r[eid] = 140;

    // Aim point near the temple core.
    Transform.x[eid] = baseMesh.position.x;
    Transform.y[eid] = baseMesh.position.y + 55;
    Transform.z[eid] = baseMesh.position.z + 30;
    Transform.qx[eid] = 0;
    Transform.qy[eid] = 0;
    Transform.qz[eid] = 0;
    Transform.qw[eid] = 1;
  }

  // Place player on the hangar pad/runway.
  if (shipEid !== null && terrainParams) {
    const x = 0;
    const z = 340;
    const y = yavinTerrainHeight(x, z) + 7;
    Transform.x[shipEid] = x;
    Transform.y[shipEid] = y;
    Transform.z[shipEid] = z;
    // Face +Z (out along the runway).
    Transform.qx[shipEid] = 0;
    Transform.qy[shipEid] = 1;
    Transform.qz[shipEid] = 0;
    Transform.qw[shipEid] = 0;
    Velocity.vx[shipEid] = 0;
    Velocity.vy[shipEid] = 0;
    Velocity.vz[shipEid] = 0;
    Ship.throttle[shipEid] = 0.35;
  }

  // Wingmen (3) in loose formation.
  spawnWingman(0, -22, 320);
  spawnWingman(1, 22, 320);
  spawnWingman(2, 0, 300);

  // 10 TIE/LN raid incoming.
  spawnYavinTieRaid(system.seed, yavin.enemiesTotal);

  yavin.phase = "combat";
  scheduleSave();
}

function spawnWingman(slot: number, x: number, z: number) {
  if (!terrainParams) return;

  const archetype = getFighterArchetype("xwing_player");
  const eid = addEntity(game.world);
  addComponent(game.world, Transform, eid);
  addComponent(game.world, Velocity, eid);
  addComponent(game.world, AngularVelocity, eid);
  addComponent(game.world, Team, eid);
  addComponent(game.world, Ship, eid);
  addComponent(game.world, LaserWeapon, eid);
  addComponent(game.world, Health, eid);
  addComponent(game.world, HitRadius, eid);
  addComponent(game.world, Shield, eid);
  addComponent(game.world, FighterBrain, eid);
  addComponent(game.world, AIControlled, eid);

  const y = yavinTerrainHeight(x, z) + 7;
  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 1;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 0;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  AngularVelocity.wx[eid] = 0;
  AngularVelocity.wy[eid] = 0;
  AngularVelocity.wz[eid] = 0;

  Team.id[eid] = 0;

  Ship.throttle[eid] = 0.45;
  Ship.maxSpeed[eid] = archetype.maxSpeed * 0.98;
  Ship.accel[eid] = archetype.accel * 0.95;
  Ship.turnRate[eid] = archetype.turnRate * 0.95;

  LaserWeapon.cooldown[eid] = archetype.weaponCooldown;
  LaserWeapon.cooldownRemaining[eid] = 0;
  LaserWeapon.projectileSpeed[eid] = archetype.projectileSpeed;
  LaserWeapon.damage[eid] = archetype.damage;

  Health.hp[eid] = archetype.hp * 0.9;
  Health.maxHp[eid] = archetype.hp * 0.9;
  HitRadius.r[eid] = archetype.hitRadius;

  Shield.maxSp[eid] = 45;
  Shield.sp[eid] = 45;
  Shield.regenRate[eid] = 5;
  Shield.lastHit[eid] = 999;

  FighterBrain.state[eid] = 0;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = 0.7;
  FighterBrain.evadeBias[eid] = 0.45;
  FighterBrain.targetEid[eid] = -1;

  const mesh = buildAllyMesh(slot);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(2.45);
  scene.add(mesh);
  allyMeshes.set(eid, mesh);
  allyEids.push(eid);
}

function spawnYavinTieRaid(seed: bigint, count: number) {
  const rng = createRng(deriveSeed(seed, "yavin_defense", "ties_v0"));
  const baseTarget = baseEid;

  for (let i = 0; i < count; i++) {
    const archetype = getFighterArchetype("tie_ln");
    const angle = rng.range(-0.4, 0.4);
    const x = rng.range(-600, 600);
    const z = -2400 + rng.range(-400, 300);
    const y = 220 + rng.range(0, 260);

    const eid = addEntity(game.world);
    addComponent(game.world, Transform, eid);
    addComponent(game.world, Velocity, eid);
    addComponent(game.world, AngularVelocity, eid);
    addComponent(game.world, Team, eid);
    addComponent(game.world, Ship, eid);
    addComponent(game.world, LaserWeapon, eid);
    addComponent(game.world, Targetable, eid);
    addComponent(game.world, Health, eid);
    addComponent(game.world, HitRadius, eid);
    addComponent(game.world, Shield, eid);
    addComponent(game.world, FighterBrain, eid);
    addComponent(game.world, AIControlled, eid);

    Transform.x[eid] = x;
    Transform.y[eid] = y;
    Transform.z[eid] = z;
    // Slightly banked toward the base.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + angle, 0));
    Transform.qx[eid] = q.x;
    Transform.qy[eid] = q.y;
    Transform.qz[eid] = q.z;
    Transform.qw[eid] = q.w;

    Velocity.vx[eid] = 0;
    Velocity.vy[eid] = 0;
    Velocity.vz[eid] = 0;

    AngularVelocity.wx[eid] = 0;
    AngularVelocity.wy[eid] = 0;
    AngularVelocity.wz[eid] = 0;

    Team.id[eid] = 1;

    Ship.throttle[eid] = rng.range(0.7, 0.95);
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

    Shield.maxSp[eid] = 10;
    Shield.sp[eid] = 10;
    Shield.regenRate[eid] = 3;
    Shield.lastHit[eid] = 999;

    FighterBrain.state[eid] = 0;
    FighterBrain.stateTime[eid] = 0;
    FighterBrain.aggression[eid] = 0.8;
    FighterBrain.evadeBias[eid] = 0.35;
    // A subset of TIEs will prioritize the base.
    FighterBrain.targetEid[eid] = baseTarget !== null && i < Math.ceil(count * 0.4) ? baseTarget : -1;

    const mesh = buildEnemyMesh("tie_ln");
    mesh.position.set(x, y, z);
    scene.add(mesh);
    targetMeshes.set(eid, mesh);
    targetEids.push(eid);
  }
}

function enterMapMode() {
  if (upgradesOpen) closeUpgrades();
  mode = "map";
  controls.enabled = true;
  flightHud = null;
  resetExplosions();
  yavin = null;
  clearAllies();
  clearPlanetaryScene();
  camInit = false;

  // Remove flight-only ECS entities and meshes.
  clearProjectiles();

  for (const eid of targetEids) {
    removeEntity(game.world, eid);
  }
  targetEids = [];
  for (const mesh of targetMeshes.values()) {
    disposeObject(mesh);
  }
  targetMeshes.clear();

  if (shipEid !== null) {
    removeEntity(game.world, shipEid);
    shipEid = null;
  }
  if (shipMesh) {
    scene.remove(shipMesh);
    disposeObject(shipMesh);
    shipMesh = null;
  }

  scene.clear();
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(350, 620, 280);
  scene.add(sun);
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
  if (!els) return;

  const yavinState = scenario === "yavin_defense" ? yavin : null;
  const baseHp =
    yavinState && baseEid !== null && hasComponent(game.world, Health, baseEid)
      ? Health.hp[baseEid] ?? 0
      : 0;

  if (shipEid === null) {
    els.speed.textContent = "0";
    els.throttle.textContent = "0%";
    els.shield.textContent = "0/0";
    els.hp.textContent = "0/0";
    if (currentSystem) {
      els.system.textContent = currentSystem.id;
      els.faction.textContent = currentSystem.controllingFaction;
    }
    els.credits.textContent = credits.toString();
    if (yavinState) {
      if (yavinState.messageTimer > 0) {
        els.mission.textContent = yavinState.message;
      } else if (yavinState.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (yavinState.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        els.mission.textContent = `DEFEND GREAT TEMPLE: ${yavinState.enemiesKilled}/${yavinState.enemiesTotal}  BASE ${Math.max(0, baseHp).toFixed(0)}/${yavinState.baseHpMax}`;
      }
    } else {
      els.mission.textContent = mission ? mission.def.title : "";
    }
    els.target.textContent = playerDead ? "SHIP DESTROYED" : "NO TARGET";
    els.lock.textContent =
      playerDead && yavinState ? "PRESS H TO RESTART" :
      playerDead ? "RESPAWNING..." :
      "LOCK 0%";
    els.bracket.classList.add("hidden");
    els.lead.classList.add("hidden");
    return;
  }

  const v =
    Math.hypot(Velocity.vx[shipEid], Velocity.vy[shipEid], Velocity.vz[shipEid]) || 0;
  const t = Ship.throttle[shipEid] || 0;
  const sp = Shield.sp[shipEid] ?? 0;
  const maxSp = Shield.maxSp[shipEid] ?? 0;
  const hpSelf = Health.hp[shipEid] ?? 0;
  const maxHpSelf = Health.maxHp[shipEid] ?? 0;

  els.speed.textContent = v.toFixed(0);
  els.throttle.textContent = `${Math.round(t * 100)}%`;
  els.shield.textContent = `${sp.toFixed(0)}/${maxSp.toFixed(0)}`;
  els.hp.textContent = `${hpSelf.toFixed(0)}/${maxHpSelf.toFixed(0)}`;
  if (currentSystem) {
    els.system.textContent = currentSystem.id;
    els.faction.textContent = currentSystem.controllingFaction;
  }
  els.credits.textContent = credits.toString();

  if (yavinState) {
    if (yavinState.messageTimer > 0) {
      els.mission.textContent = yavinState.message;
    } else if (yavinState.phase === "success") {
      els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
    } else if (yavinState.phase === "fail") {
      els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
    } else {
      els.mission.textContent = `DEFEND GREAT TEMPLE: ${yavinState.enemiesKilled}/${yavinState.enemiesTotal}  BASE ${Math.max(0, baseHp).toFixed(0)}/${yavinState.baseHpMax}`;
    }
  } else if (mission) {
    if (mission.messageTimer > 0) {
      els.mission.textContent = mission.message;
    } else if (mission.completed) {
      els.mission.textContent = "MISSION COMPLETE — PRESS H TO JUMP";
    } else {
      els.mission.textContent =
        `${mission.def.title}: ${mission.kills}/${mission.def.goalKills}  ` +
        `REWARD ${mission.def.rewardCredits} CR`;
    }
  } else {
    els.mission.textContent = "";
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
  clearProjectiles();
  startMission(next);
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
  if (mode !== "map" || upgradesOpen) return;
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
    case "1":
      enterFlightMode(YAVIN_DEFENSE_SYSTEM, "yavin_defense");
      break;
    case "Enter":
      if (selectedSystem) enterFlightMode(selectedSystem);
      break;
  }
});

window.addEventListener("pointermove", (ev) => {
  if (mode !== "map" || upgradesOpen) return;
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener("click", (ev) => {
  if (mode !== "map" || upgradesOpen || !systemsPlanets) return;
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(systemsPlanets);
  if (hits.length === 0) return;
  const hit = hits[0];
  const idx = hit.instanceId ?? -1;
  const systems = systemsPlanets.userData.systems as SystemDef[];
  const sys = systems[idx];
  if (!sys) return;

  selectedSystem = sys;
  const preview = getMission(sys, missionTier);
  if (selectedMarker) {
    selectedMarker.visible = true;
    selectedMarker.position.set(
      sys.galaxyPos[0] * GALAXY_SCALE,
      sys.galaxyPos[1] * GALAXY_SCALE,
      sys.galaxyPos[2] * GALAXY_SCALE
    );
    const radii = systemsPlanets.userData.radii as number[] | undefined;
    const r = radii?.[idx] ?? 14;
    selectedMarker.scale.setScalar(r * 1.25);
  }
  hud.innerText =
    `xwingz – galaxy map\n` +
    `Seed: ${globalSeed.toString()}\n` +
    `Credits: ${credits} | Tier: ${missionTier}\n` +
    `Center sector: [${centerSector.join(", ")}], radius ${radius}\n` +
    `Systems: ${systems.length}\n\n` +
    `Selected ${sys.id}\n` +
    `Star: ${sys.starClass} | planets: ${sys.planetCount}\n` +
    `Archetype: ${sys.archetypeId}\n` +
    `Faction: ${sys.controllingFaction}\n` +
    `Economy: wealth ${sys.economy.wealth.toFixed(2)}, industry ${sys.economy.industry.toFixed(2)}, security ${sys.economy.security.toFixed(2)}\n` +
    `Mission: ${preview.title} — ${preview.goalKills} kills, reward ${preview.rewardCredits} CR\n` +
    `Press Enter to fly here`;
});

// ---- Main tick ----
const game = createGame({ globalSeed });
enterMapMode();
// Debug hook for E2E tests.
const e2eEnabled =
  typeof window !== "undefined" &&
  (() => {
    try {
      return new URLSearchParams(window.location.search).has("e2e");
    } catch {
      return false;
    }
  })();
try {
  (window as any).__xwingz = {
    get mode() {
      return mode;
    },
    get scenario() {
      return scenario;
    },
    get selectedSystemId() {
      return selectedSystem?.id ?? null;
    },
    get yavinPhase() {
      return yavin?.phase ?? null;
    },
    get targetCount() {
      return targetEids.length;
    },
    get allyCount() {
      return allyEids.length;
    },
    get projectileCount() {
      return projectileMeshes.size;
    },
    get credits() {
      return credits;
    }
  };
  if (e2eEnabled) {
    (window as any).__xwingzTest = {
      killAllEnemies() {
        for (const eid of targetEids) {
          if (hasComponent(game.world, Transform, eid)) removeEntity(game.world, eid);
        }
      },
      failBase() {
        if (baseEid !== null && hasComponent(game.world, Health, baseEid)) {
          Health.hp[baseEid] = 0;
        }
      },
      godMode(on = true) {
        if (shipEid === null) return;
        if (!hasComponent(game.world, Health, shipEid) || !hasComponent(game.world, Shield, shipEid)) return;
        if (on) {
          Health.hp[shipEid] = Math.max(Health.hp[shipEid] ?? 0, 9999);
          Health.maxHp[shipEid] = Math.max(Health.maxHp[shipEid] ?? 0, 9999);
          Shield.sp[shipEid] = Math.max(Shield.sp[shipEid] ?? 0, 9999);
          Shield.maxSp[shipEid] = Math.max(Shield.maxSp[shipEid] ?? 0, 9999);
        }
      }
    };
  }
} catch {
  // ignore
}
const simInput: SpaceInputState = {
  pitch: 0,
  yaw: 0,
  roll: 0,
  throttleDelta: 0,
  boost: false,
  brake: false,
  firePrimary: false,
  cycleTarget: false,
  hyperspace: false,
  toggleMap: false
};
let smPitch = 0;
let smYaw = 0;
let smRoll = 0;
let smThrottleDelta = 0;
game.setTick((dt) => {
  if (mode === "map") {
    controls.update();
    renderer.render(scene, camera);
    return;
  }

  // Flight mode
  input.update();
  {
    const a = clamp(dt * 10, 0, 1);
    smPitch += (input.state.pitch - smPitch) * a;
    smYaw += (input.state.yaw - smYaw) * a;
    smRoll += (input.state.roll - smRoll) * a;
    smThrottleDelta += (input.state.throttleDelta - smThrottleDelta) * a;

    simInput.pitch = smPitch;
    simInput.yaw = smYaw;
    simInput.roll = smRoll;
    simInput.throttleDelta = smThrottleDelta;
    simInput.boost = input.state.boost;
    simInput.brake = input.state.brake;
    simInput.firePrimary = input.state.firePrimary;
    simInput.cycleTarget = input.state.cycleTarget;
    simInput.hyperspace = input.state.hyperspace;
    simInput.toggleMap = input.state.toggleMap;
  }
  if (simInput.toggleMap) {
    enterMapMode();
    return;
  }

  if (
    scenario === "yavin_defense" &&
    currentSystem &&
    yavin &&
    (yavin.phase === "success" || yavin.phase === "fail") &&
    simInput.hyperspace
  ) {
    enterFlightMode(currentSystem, "yavin_defense");
    return;
  }

  if (scenario === "yavin_defense" && yavin && yavin.phase === "combat" && simInput.hyperspace) {
    yavin.message = "HYPERSPACE DISABLED - COMPLETE OBJECTIVE";
    yavin.messageTimer = 2;
  }

  if (playerDead) {
    respawnTimer += dt;
    if (scenario !== "yavin_defense" && respawnTimer >= RESPAWN_DELAY && currentSystem) {
      // Clean slate on respawn for now.
      clearProjectiles();
      respawnPlayer();
      startMission(currentSystem);
      playerDead = false;
      respawnTimer = 0;
    }

    updateFlightHud(dt);
    updateExplosions(dt);
    renderer.render(scene, camera);
    return;
  }

  if (upgradesOpen) {
    updateFlightHud(dt);
    updateExplosions(dt);
    renderer.render(scene, camera);
    return;
  }

  targetingSystem(game.world, simInput);
  dogfightAISystem(game.world, dt);
  spaceflightSystem(game.world, simInput, dt);
  weaponSystem(game.world, simInput, dt);
  aiWeaponSystem(game.world, dt);
  projectileSystem(game.world, dt);
  shieldRegenSystem(game.world, dt);

  const impacts = consumeImpactEvents();
  for (const hit of impacts) {
    const color = hit.team === 0 ? 0xff6666 : 0x77ff88;
    spawnExplosion(
      tmpExplosionPos.set(hit.x, hit.y, hit.z),
      color,
      hit.killed ? 0.55 : 0.18,
      hit.killed ? 9 : 2.4
    );
  }

  if (scenario === "yavin_defense" && yavin && yavin.phase === "combat") {
    const baseAlive =
      baseEid !== null &&
      hasComponent(game.world, Health, baseEid) &&
      (Health.hp[baseEid] ?? 0) > 0;
    if (!baseAlive) {
      yavin.phase = "fail";
      yavin.message = "MISSION FAILED - GREAT TEMPLE DESTROYED";
      yavin.messageTimer = 8;
      if (baseMesh) {
        spawnExplosion(
          tmpExplosionPos.set(baseMesh.position.x, baseMesh.position.y + 45, baseMesh.position.z),
          0xff4444
        );
        scene.remove(baseMesh);
        disposeObject(baseMesh);
        baseMesh = null;
      }
      scheduleSave();
    }
  }

  const player = getPlayerShip(game.world);
  if (player === null) {
    if (scenario === "yavin_defense" && yavin && yavin.phase === "combat") {
      yavin.phase = "fail";
      yavin.message = "MISSION FAILED - YOU WERE SHOT DOWN";
      yavin.messageTimer = 8;
      scheduleSave();
    }
    playerDead = true;
    respawnTimer = 0;
    clearProjectiles();
    if (shipMesh) {
      spawnExplosion(tmpExplosionPos.copy(shipMesh.position), 0xff5555);
      scene.remove(shipMesh);
      disposeObject(shipMesh);
      shipMesh = null;
    }
    shipEid = null;
    updateFlightHud(dt);
    updateExplosions(dt);
    renderer.render(scene, camera);
    return;
  }

  if (scenario === "yavin_defense") {
    clampEntityAboveYavinTerrain(player, 6);
    for (const eid of allyEids) clampEntityAboveYavinTerrain(eid, 6);
    for (const eid of targetEids) clampEntityAboveYavinTerrain(eid, 6);
  }

  if (player !== null && shipMesh) {
    shipMesh.position.set(Transform.x[player], Transform.y[player], Transform.z[player]);
    shipMesh.quaternion.set(Transform.qx[player], Transform.qy[player], Transform.qz[player], Transform.qw[player]);

    const q = shipMesh.quaternion;
    const pos = shipMesh.position;
    const boostFov = (Ship.throttle[player] ?? 0) > 0.9 && simInput.boost ? 6 : 0;
    camera.fov = 70 + boostFov;
    camera.updateProjectionMatrix();

    const camOffset = tmpCamOffset.set(0, 6, 22).applyQuaternion(q);
    const lookOffset = tmpLookOffset.set(0, 1.0, -48).applyQuaternion(q);
    const desiredPos = tmpLookAt.copy(pos).add(camOffset);
    const desiredLook = tmpExplosionPos.copy(pos).add(lookOffset);

    const k = 1 - Math.exp(-dt * 8.5);
    if (!camInit) {
      camSmoothPos.copy(desiredPos);
      camSmoothLook.copy(desiredLook);
      camInit = true;
    } else {
      camSmoothPos.lerp(desiredPos, k);
      camSmoothLook.lerp(desiredLook, k);
    }
    camera.position.copy(camSmoothPos);
    camera.lookAt(camSmoothLook);
  }

  syncTargets();
  if (scenario === "yavin_defense" && yavin) {
    syncAllies();
  }
  if (mission && currentSystem && !mission.completed && mission.kills < mission.def.goalKills && targetEids.length === 0) {
    spawnMissionWave(currentSystem);
  }
  syncProjectiles();

  if (scenario !== "yavin_defense" && simInput.hyperspace) hyperspaceJump();

  if (mission && mission.messageTimer > 0) {
    mission.messageTimer = Math.max(0, mission.messageTimer - dt);
  }
  if (yavin && yavin.messageTimer > 0) {
    yavin.messageTimer = Math.max(0, yavin.messageTimer - dt);
  }

  updateFlightHud(dt);
  updateExplosions(dt);
  renderer.render(scene, camera);
});
game.start();

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.floor(v)));
}
