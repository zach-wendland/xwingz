import "./style.css";
import { createGame } from "@xwingz/core";
import { createBasicRenderer } from "@xwingz/render";
import {
  GalaxyCache,
  createRng,
  deriveSeed,
  type Vec3i,
  type SystemDef
} from "@xwingz/procgen";
import {
  createSpaceInput,
  getPlayerShip,
  getProjectiles,
  getTargetables,
  spaceflightSystem,
  spawnPlayerShip,
  targetingSystem,
  weaponSystem,
  projectileSystem,
  Health,
  HitRadius,
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
const targetOrbits = new Map<number, { radius: number; speed: number; phase: number; height: number }>();
let flightTimeSec = 0;
const boltForward = new THREE.Vector3(0, 0, 1);

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

function spawnTrainingDrones(seed: bigint) {
  // remove previous drones
  for (const eid of targetEids) {
    removeEntity(game.world, eid);
  }
  for (const mesh of targetMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  targetEids = [];
  targetMeshes.clear();
  targetOrbits.clear();

  const count = 3;
  for (let i = 0; i < count; i++) {
    const drng = createRng(deriveSeed(seed, "drone", i));
    const pos = new THREE.Vector3(
      drng.range(-180, 180),
      drng.range(-80, 80),
      drng.range(-900, -350)
    );

    const eid = addEntity(game.world);
    addComponent(game.world, Transform, eid);
    addComponent(game.world, Velocity, eid);
    addComponent(game.world, Targetable, eid);
    addComponent(game.world, Health, eid);
    addComponent(game.world, HitRadius, eid);

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

    Health.hp[eid] = 30;
    Health.maxHp[eid] = 30;
    HitRadius.r[eid] = 8;

    const mesh = new THREE.Mesh(
      new THREE.TetrahedronGeometry(6),
      new THREE.MeshStandardMaterial({
        color: 0xffaa66,
        emissive: 0x331100,
        metalness: 0.2,
        roughness: 0.7
      })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    targetEids.push(eid);
    targetMeshes.set(eid, mesh);
    targetOrbits.set(eid, {
      radius: drng.range(90, 220),
      speed: drng.range(0.2, 0.5),
      phase: drng.range(0, Math.PI * 2),
      height: drng.range(-40, 40)
    });
  }
}

function updateDroneAI(dt: number) {
  flightTimeSec += dt;
  const player = getPlayerShip(game.world);
  const cx = player !== null ? (Transform.x[player] ?? 0) : 0;
  const cy = player !== null ? (Transform.y[player] ?? 0) : 0;
  const cz = player !== null ? (Transform.z[player] ?? 0) : 0;

  for (const [eid, orbit] of targetOrbits) {
    if (!targetMeshes.has(eid)) continue;
    const a = orbit.phase + flightTimeSec * orbit.speed;
    const x = cx + Math.cos(a) * orbit.radius;
    const z = cz + Math.sin(a) * orbit.radius;
    const y = cy + orbit.height;
    Transform.x[eid] = x;
    Transform.y[eid] = y;
    Transform.z[eid] = z;
  }
}

function syncTargets() {
  const aliveTargets = getTargetables(game.world);
  const aliveSet = new Set(aliveTargets);

  for (const [eid, mesh] of targetMeshes) {
    if (aliveSet.has(eid)) continue;
    scene.remove(mesh);
    disposeObject(mesh);
    targetMeshes.delete(eid);
  }

  targetEids = aliveTargets;
  for (const eid of aliveTargets) {
    const mesh = targetMeshes.get(eid);
    if (!mesh) continue;
    mesh.position.set(Transform.x[eid] ?? 0, Transform.y[eid] ?? 0, Transform.z[eid] ?? 0);
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

function setupFlightHud() {
  hud.className = "hud-xwing";
  hud.innerHTML = `
    <div class="hud-reticle">
      <div class="reticle-circle"></div>
      <div class="reticle-cross"></div>
    </div>
    <div class="hud-top">
      <div id="hud-target" class="hud-target">NO TARGET</div>
    </div>
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
}

function enterFlightMode(system: SystemDef) {
  mode = "flight";
  currentSystem = system;
  jumpIndex = 0;
  flightTimeSec = 0;

  controls.enabled = false;
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

  spawnTrainingDrones(system.seed);

  camera.position.set(0, 6, 20);
  camera.lookAt(0, 0, -50);

  setupFlightHud();
  updateFlightHud();
}

function enterMapMode() {
  mode = "map";
  controls.enabled = true;

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
  targetOrbits.clear();

  scene.clear();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  camera.position.set(0, 200, 600);
  rebuildGalaxy();
}

function updateFlightHud() {
  const speedEl = document.querySelector<HTMLDivElement>("#hud-speed");
  const throttleEl = document.querySelector<HTMLDivElement>("#hud-throttle");
  const systemEl = document.querySelector<HTMLDivElement>("#hud-system");
  const factionEl = document.querySelector<HTMLDivElement>("#hud-faction");
  const targetEl = document.querySelector<HTMLDivElement>("#hud-target");

  if (!shipEid) return;
  const v =
    Math.hypot(Velocity.vx[shipEid], Velocity.vy[shipEid], Velocity.vz[shipEid]) || 0;
  const t = Ship.throttle[shipEid] || 0;

  if (speedEl) speedEl.textContent = v.toFixed(0);
  if (throttleEl) throttleEl.textContent = `${Math.round(t * 100)}%`;
  if (systemEl && currentSystem) systemEl.textContent = currentSystem.id;
  if (factionEl && currentSystem) factionEl.textContent = currentSystem.controllingFaction;

  if (targetEl) {
    const teid = Targeting.targetEid[shipEid] ?? -1;
    if (teid >= 0) {
      const dx = (Transform.x[teid] ?? 0) - (Transform.x[shipEid] ?? 0);
      const dy = (Transform.y[teid] ?? 0) - (Transform.y[shipEid] ?? 0);
      const dz = (Transform.z[teid] ?? 0) - (Transform.z[shipEid] ?? 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const hp = Health.hp[teid] ?? 0;
      targetEl.textContent = `TGT ${teid}  ${dist.toFixed(0)}m  HP ${hp.toFixed(0)}`;
    } else {
      targetEl.textContent = "NO TARGET";
    }
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
  spaceflightSystem(game.world, input.state, dt);
  weaponSystem(game.world, input.state, dt);
  projectileSystem(game.world, dt);

  const player = getPlayerShip(game.world);
  if (player !== null && shipMesh) {
    shipMesh.position.set(Transform.x[player], Transform.y[player], Transform.z[player]);
    shipMesh.quaternion.set(Transform.qx[player], Transform.qy[player], Transform.qz[player], Transform.qw[player]);

    const q = shipMesh.quaternion;
    const pos = shipMesh.position;
    const camOffset = new THREE.Vector3(0, 5, 18).applyQuaternion(q);
    const lookOffset = new THREE.Vector3(0, 0, -40).applyQuaternion(q);
    camera.position.copy(pos).add(camOffset);
    camera.lookAt(pos.clone().add(lookOffset));
  }

  updateDroneAI(dt);
  syncTargets();
  if (targetEids.length === 0 && currentSystem) {
    spawnTrainingDrones(currentSystem.seed);
  }
  syncProjectiles();

  if (input.state.hyperspace) hyperspaceJump();
  if (input.state.toggleMap) enterMapMode();

  updateFlightHud();
  renderer.render(scene, camera);
});
game.start();
