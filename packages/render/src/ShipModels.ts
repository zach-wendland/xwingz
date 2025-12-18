/**
 * ShipModels - Unified ship mesh creation system
 *
 * Provides both procedural and GLTF-based ship models with caching.
 * Ships can be created procedurally or loaded from GLTF files.
 *
 * Usage:
 *   const xwing = await getShipModel('xwing');
 *   scene.add(xwing);
 *
 *   // Or use procedural directly:
 *   const tie = createProceduralShip('tie_ln');
 *   scene.add(tie);
 */

import * as THREE from "three";
import { createLogger } from "@xwingz/core";
import { AssetLoader, getAssetLoader, KENNEY_ASSETS } from "./AssetLoader";

const log = createLogger("ShipModels");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShipType =
  | "xwing"
  | "xwing_player"
  | "tie_ln"
  | "tie_fighter"
  | "tie_interceptor"
  | "ywing"
  | "awing"
  | "star_destroyer"
  | "nebulon_b"
  | "cr90_corvette"
  | "transport"
  | "shuttle";

export type ShipFaction = "rebel" | "empire" | "neutral";

export interface ShipModelConfig {
  type: ShipType;
  scale?: number;
  faction?: ShipFaction;
  tint?: number;
  enableShadows?: boolean;
}

export interface ShipModelDefinition {
  type: ShipType;
  faction: ShipFaction;
  /** If set, attempt to load from GLTF first */
  gltfPath?: string;
  /** Fallback to Kenney asset */
  kenneyAsset?: keyof typeof KENNEY_ASSETS;
  /** Default scale */
  defaultScale: number;
  /** Procedural mesh builder (always available as fallback) */
  buildProcedural: () => THREE.Group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Registry
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_REGISTRY: Record<ShipType, ShipModelDefinition> = {
  xwing: {
    type: "xwing",
    faction: "rebel",
    // Future: gltfPath: "ships/xwing.glb",
    defaultScale: 2.5,
    buildProcedural: buildProceduralXWing,
  },
  xwing_player: {
    type: "xwing_player",
    faction: "rebel",
    defaultScale: 2.5,
    buildProcedural: buildProceduralXWing,
  },
  tie_ln: {
    type: "tie_ln",
    faction: "empire",
    // Future: gltfPath: "ships/tie_fighter.glb",
    defaultScale: 2.5,
    buildProcedural: buildProceduralTIEFighter,
  },
  tie_fighter: {
    type: "tie_fighter",
    faction: "empire",
    defaultScale: 2.5,
    buildProcedural: buildProceduralTIEFighter,
  },
  tie_interceptor: {
    type: "tie_interceptor",
    faction: "empire",
    defaultScale: 2.5,
    buildProcedural: buildProceduralTIEInterceptor,
  },
  ywing: {
    type: "ywing",
    faction: "rebel",
    defaultScale: 2.5,
    buildProcedural: buildProceduralYWing,
  },
  awing: {
    type: "awing",
    faction: "rebel",
    defaultScale: 2.5,
    buildProcedural: buildProceduralAWing,
  },
  star_destroyer: {
    type: "star_destroyer",
    faction: "empire",
    defaultScale: 1.0,
    buildProcedural: buildProceduralStarDestroyer,
  },
  nebulon_b: {
    type: "nebulon_b",
    faction: "rebel",
    defaultScale: 1.0,
    buildProcedural: buildProceduralNebulonB,
  },
  cr90_corvette: {
    type: "cr90_corvette",
    faction: "rebel",
    defaultScale: 1.0,
    buildProcedural: buildProceduralCR90,
  },
  transport: {
    type: "transport",
    faction: "neutral",
    kenneyAsset: "CRAFT_CARGO_A",
    defaultScale: 3.0,
    buildProcedural: buildProceduralTransport,
  },
  shuttle: {
    type: "shuttle",
    faction: "empire",
    kenneyAsset: "CRAFT_SPEEDER_A",
    defaultScale: 3.0,
    buildProcedural: buildProceduralShuttle,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Caching
// ─────────────────────────────────────────────────────────────────────────────

const proceduralCache = new Map<string, THREE.Group>();
const gltfCache = new Map<string, THREE.Group>();

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a ship model (clone). Tries GLTF first, falls back to procedural.
 */
export async function getShipModel(config: ShipModelConfig): Promise<THREE.Group> {
  const def = MODEL_REGISTRY[config.type];
  if (!def) {
    log.warn(`Unknown ship type: ${config.type}, using transport fallback`);
    return createProceduralShip({ type: "transport" });
  }

  // Try GLTF first if defined
  if (def.gltfPath) {
    try {
      const cached = gltfCache.get(def.gltfPath);
      if (cached) {
        return applyShipConfig(cached.clone(), config, def);
      }

      const loader = getAssetLoader();
      const model = await loader.load(def.gltfPath);
      gltfCache.set(def.gltfPath, model);
      return applyShipConfig(model.clone(), config, def);
    } catch (err) {
      log.warn(`Failed to load GLTF for ${config.type}, using procedural:`, err);
    }
  }

  // Try Kenney asset
  if (def.kenneyAsset) {
    try {
      const assetPath = KENNEY_ASSETS[def.kenneyAsset];
      const cached = gltfCache.get(assetPath);
      if (cached) {
        return applyShipConfig(cached.clone(), config, def);
      }

      const loader = getAssetLoader();
      const model = await loader.load(assetPath);
      gltfCache.set(assetPath, model);
      return applyShipConfig(model.clone(), config, def);
    } catch (err) {
      log.warn(`Failed to load Kenney asset for ${config.type}, using procedural:`, err);
    }
  }

  // Fallback to procedural
  return createProceduralShip(config);
}

/**
 * Get a ship model synchronously (procedural only, no async loading).
 * Use this when you need immediate mesh creation without waiting.
 */
export function createProceduralShip(config: ShipModelConfig): THREE.Group {
  const def = MODEL_REGISTRY[config.type];
  if (!def) {
    log.warn(`Unknown ship type: ${config.type}, using transport fallback`);
    return createProceduralShip({ type: "transport" });
  }

  const cacheKey = `${config.type}_procedural`;
  let base = proceduralCache.get(cacheKey);

  if (!base) {
    base = def.buildProcedural();
    proceduralCache.set(cacheKey, base);
  }

  return applyShipConfig(base.clone(), config, def);
}

/**
 * Preload ship models for faster runtime access.
 */
export async function preloadShipModels(types: ShipType[]): Promise<void> {
  const loader = getAssetLoader();
  const paths: string[] = [];

  for (const type of types) {
    const def = MODEL_REGISTRY[type];
    if (!def) continue;

    if (def.gltfPath) {
      paths.push(def.gltfPath);
    } else if (def.kenneyAsset) {
      paths.push(KENNEY_ASSETS[def.kenneyAsset]);
    }
  }

  if (paths.length > 0) {
    await loader.preload(paths);
  }
}

/**
 * Clear all cached ship models.
 */
export function clearShipModelCache(): void {
  proceduralCache.clear();
  gltfCache.clear();
}

/**
 * Get list of available ship types.
 */
export function getAvailableShipTypes(): ShipType[] {
  return Object.keys(MODEL_REGISTRY) as ShipType[];
}

/**
 * Get ship definition metadata.
 */
export function getShipDefinition(type: ShipType): ShipModelDefinition | undefined {
  return MODEL_REGISTRY[type];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function applyShipConfig(
  group: THREE.Group,
  config: ShipModelConfig,
  def: ShipModelDefinition
): THREE.Group {
  // Apply scale
  const scale = config.scale ?? def.defaultScale;
  group.scale.setScalar(scale);

  // Apply shadows
  if (config.enableShadows !== false) {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  // Apply tint if specified
  if (config.tint !== undefined) {
    const tintColor = new THREE.Color(config.tint);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.color) {
          mat.color.lerp(tintColor, 0.15);
        }
      }
    });
  }

  // Store metadata
  group.userData.shipType = config.type;
  group.userData.shipFaction = config.faction ?? def.faction;

  return group;
}

function makeBoltGlow(color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const c = new THREE.Color(color);
  gradient.addColorStop(0, `rgba(${c.r * 255}, ${c.g * 255}, ${c.b * 255}, 1)`);
  gradient.addColorStop(0.4, `rgba(${c.r * 255}, ${c.g * 255}, ${c.b * 255}, 0.5)`);
  gradient.addColorStop(1, `rgba(${c.r * 255}, ${c.g * 255}, ${c.b * 255}, 0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Sprite(material);
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural Ship Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildProceduralXWing(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, metalness: 0.25, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x171a25, metalness: 0.2, roughness: 0.85 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xb02a2a, roughness: 0.7 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b8, metalness: 0.35, roughness: 0.5 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.45, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f18,
    roughness: 0.1,
    metalness: 0.0,
    transparent: true,
    opacity: 0.6,
  });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x44bbff,
    emissive: 0x44ccff,
    emissiveIntensity: 6.0,
    roughness: 0.15,
  });

  // Fuselage
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10.8, 12), hullMat);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.8, 12), hullMat);
  nose.position.z = -7.2;
  nose.rotation.x = Math.PI;
  group.add(nose);

  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.05, 2.4), darkMat);
  intake.position.set(0, -0.1, -1.0);
  group.add(intake);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 12), glassMat);
  canopy.position.set(0, 0.55, -2.0);
  canopy.scale.set(1.1, 0.75, 1.35);
  group.add(canopy);

  // Astromech dome
  const droid = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), hullMat);
  dome.position.y = 0.2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 10), hullMat);
  droid.add(cap, dome);
  droid.position.set(0.75, 0.45, 0.9);
  group.add(droid);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.8), redMat);
  stripe.position.set(-1.95, 0.2, -1.0);
  group.add(stripe);

  // S-foils
  const wingAngle = 0.52;
  const wingGeo = new THREE.BoxGeometry(7.8, 0.14, 1.9);
  const engineGeo = new THREE.CylinderGeometry(0.44, 0.44, 3.4, 10);
  const nozzleGeo = new THREE.CylinderGeometry(0.26, 0.32, 0.42, 10);
  const cannonGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8);

  const makeWing = (side: -1 | 1, up: -1 | 1) => {
    const w = new THREE.Group();
    w.rotation.z = up * wingAngle;

    const wing = new THREE.Mesh(wingGeo, darkMat);
    wing.position.set(side * 4.0, 0, -1.2);
    w.add(wing);

    const engine = new THREE.Mesh(engineGeo, engineMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(side * 6.55, 0, 0.2);
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
    w.add(cannon);

    return w;
  };

  group.add(makeWing(1, 1), makeWing(-1, 1), makeWing(1, -1), makeWing(-1, -1));

  return group;
}

function buildProceduralTIEFighter(): THREE.Group {
  const group = new THREE.Group();

  const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.25, roughness: 0.6 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c23, metalness: 0.2, roughness: 0.7 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.25, roughness: 0.6 });

  // Cockpit ball
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 12), cockpitMat);
  group.add(cockpit);

  // Solar panels (hexagonal would be more accurate, using boxes for performance)
  const panelGeo = new THREE.BoxGeometry(0.6, 6.5, 6.5);
  const leftPanel = new THREE.Mesh(panelGeo, panelMat);
  leftPanel.position.x = -4.2;
  group.add(leftPanel);

  const rightPanel = new THREE.Mesh(panelGeo, panelMat);
  rightPanel.position.x = 4.2;
  group.add(rightPanel);

  // Wing struts
  const strutGeo = new THREE.BoxGeometry(2.8, 0.35, 0.35);
  const strut = new THREE.Mesh(strutGeo, strutMat);
  group.add(strut);

  // Engine glow (TIE engines glow blue in canon, not green)
  const glow = makeBoltGlow(0x4488ff);
  glow.position.z = 3.0;
  glow.scale.setScalar(5.2);
  group.add(glow);

  return group;
}

function buildProceduralTIEInterceptor(): THREE.Group {
  const group = new THREE.Group();

  const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.25, roughness: 0.6 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c23, metalness: 0.2, roughness: 0.7 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.25, roughness: 0.6 });

  // Cockpit ball
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 12), cockpitMat);
  group.add(cockpit);

  // Arrow-shaped solar panels
  const createInterceptorWing = (side: number) => {
    const wing = new THREE.Group();

    // Main panel (angled)
    const panelShape = new THREE.Shape();
    panelShape.moveTo(0, 0);
    panelShape.lineTo(0, 7);
    panelShape.lineTo(-4 * side, 4);
    panelShape.lineTo(-4 * side, -4);
    panelShape.lineTo(0, -7);
    panelShape.closePath();

    const panelGeo = new THREE.ExtrudeGeometry(panelShape, { depth: 0.3, bevelEnabled: false });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.rotation.y = Math.PI / 2;
    panel.position.x = side * 3.5;
    wing.add(panel);

    return wing;
  };

  group.add(createInterceptorWing(1));
  group.add(createInterceptorWing(-1));

  // Wing struts
  const strutGeo = new THREE.BoxGeometry(5.0, 0.3, 0.3);
  const strut = new THREE.Mesh(strutGeo, strutMat);
  group.add(strut);

  // Engine glow (TIE engines glow blue in canon, not green)
  const glow = makeBoltGlow(0x4488ff);
  glow.position.z = 2.8;
  glow.scale.setScalar(4.8);
  group.add(glow);

  return group;
}

function buildProceduralYWing(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xd4d8dd, metalness: 0.25, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.2, roughness: 0.7 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xc9a83a, metalness: 0.15, roughness: 0.6 });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x44bbff,
    emissive: 0x44bbff,
    emissiveIntensity: 3.0,
  });

  // Main cockpit section
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 6), hullMat);
  group.add(cockpit);

  // Nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 8), hullMat);
  nose.rotation.x = Math.PI;
  nose.position.z = -4.5;
  group.add(nose);

  // Engine nacelles
  const createNacelle = (side: number) => {
    const nacelle = new THREE.Group();

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 8, 12), darkMat);
    body.rotation.x = Math.PI / 2;
    body.position.set(side * 3.5, 0, 1);
    nacelle.add(body);

    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 12), yellowMat);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.set(side * 3.5, 0, -2);
    nacelle.add(stripe);

    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.3, 12), engineMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(side * 3.5, 0, 5.2);
    nacelle.add(engine);

    // Connecting arm
    const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(side * 2), 0.4, 1.5), darkMat);
    arm.position.set(side * 1.75, 0, -1);
    nacelle.add(arm);

    return nacelle;
  };

  group.add(createNacelle(1));
  group.add(createNacelle(-1));

  return group;
}

function buildProceduralAWing(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc83030, metalness: 0.25, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.2, roughness: 0.7 });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x44bbff,
    emissive: 0x44bbff,
    emissiveIntensity: 4.0,
  });

  // Wedge-shaped fuselage
  const fuselageShape = new THREE.Shape();
  fuselageShape.moveTo(0, -5);
  fuselageShape.lineTo(2, 4);
  fuselageShape.lineTo(-2, 4);
  fuselageShape.closePath();

  const fuselageGeo = new THREE.ExtrudeGeometry(fuselageShape, { depth: 1.2, bevelEnabled: false });
  const fuselage = new THREE.Mesh(fuselageGeo, hullMat);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 0.6;
  group.add(fuselage);

  // Cockpit
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x0c0f18, roughness: 0.1, transparent: true, opacity: 0.6 })
  );
  cockpit.position.set(0, 0.8, -2);
  cockpit.scale.set(1.2, 0.6, 1.5);
  group.add(cockpit);

  // Wing-mounted engines
  const createEngine = (side: number) => {
    const engine = new THREE.Group();

    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 8), darkMat);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 1.8, 0.4, 2);
    engine.add(nacelle);

    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.3, 8), engineMat);
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(side * 1.8, 0.4, 3.7);
    engine.add(thruster);

    return engine;
  };

  group.add(createEngine(1));
  group.add(createEngine(-1));

  return group;
}

function buildProceduralStarDestroyer(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8a8f9d, metalness: 0.3, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.2, roughness: 0.8 });
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.35, roughness: 0.6 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffcc,
    emissiveIntensity: 0.8,
  });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x4488ff,
    emissive: 0x4488ff,
    emissiveIntensity: 2.0,
  });

  // Main hull (wedge shape)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, -64);
  hullShape.lineTo(28, 48);
  hullShape.lineTo(-28, 48);
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 14, bevelEnabled: false });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.rotation.x = Math.PI / 2;
  hull.position.y = 7;
  group.add(hull);

  // Bridge tower
  const bridgeBase = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 10), bridgeMat);
  bridgeBase.position.set(0, 15, 36);
  group.add(bridgeBase);

  const bridgeTop = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 8), bridgeMat);
  bridgeTop.position.set(0, 21, 35);
  group.add(bridgeTop);

  // Shield generator domes
  const domeGeo = new THREE.SphereGeometry(2.5, 8, 8);
  const leftDome = new THREE.Mesh(domeGeo, darkMat);
  leftDome.position.set(-5, 24, 33);
  leftDome.scale.y = 0.6;
  group.add(leftDome);

  const rightDome = new THREE.Mesh(domeGeo, darkMat);
  rightDome.position.set(5, 24, 33);
  rightDome.scale.y = 0.6;
  group.add(rightDome);

  // Engine bank
  const engineBankGeo = new THREE.BoxGeometry(24, 10, 4);
  const engineBank = new THREE.Mesh(engineBankGeo, darkMat);
  engineBank.position.set(0, 7, 50);
  group.add(engineBank);

  // Engine glows
  for (let i = -2; i <= 2; i++) {
    const engineGlow = new THREE.Mesh(new THREE.CircleGeometry(3, 16), engineMat);
    engineGlow.position.set(i * 4.5, 7, 52.1);
    group.add(engineGlow);
  }

  // Trench detail
  const trench = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 80), darkMat);
  trench.position.set(0, 13, 0);
  group.add(trench);

  // Surface detail (turret emplacements) - deterministic positioning
  for (let i = 0; i < 8; i++) {
    // Use deterministic offset based on index (avoids Math.random per CLAUDE.md convention)
    const deterministicOffset = ((i * 7 + 3) % 12);
    const x = (i % 2 === 0 ? -1 : 1) * (8 + deterministicOffset);
    const z = -50 + i * 12;
    const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 1.5, 8), darkMat);
    turretBase.position.set(x, 15, z);
    group.add(turretBase);
  }

  return group;
}

function buildProceduralNebulonB(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x9a9fad, metalness: 0.25, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.2, roughness: 0.7 });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xff6644,
    emissive: 0xff6644,
    emissiveIntensity: 2.0,
  });

  // Forward section
  const forwardSection = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 20), hullMat);
  forwardSection.position.z = -20;
  group.add(forwardSection);

  // Connecting spar (the distinctive thin neck)
  const spar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 25), hullMat);
  spar.position.z = 2;
  group.add(spar);

  // Aft engine section
  const aftSection = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 15), hullMat);
  aftSection.position.z = 22;
  group.add(aftSection);

  // Engine pods
  for (let i = -1; i <= 1; i += 2) {
    const enginePod = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 8, 8), darkMat);
    enginePod.rotation.x = Math.PI / 2;
    enginePod.position.set(i * 5, 0, 28);
    group.add(enginePod);

    const engineGlow = new THREE.Mesh(new THREE.CircleGeometry(1.8, 12), engineMat);
    engineGlow.position.set(i * 5, 0, 32.1);
    group.add(engineGlow);
  }

  return group;
}

function buildProceduralCR90(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xdde0e6, metalness: 0.2, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x5a5f6c, metalness: 0.25, roughness: 0.7 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0x8b2020, roughness: 0.6 });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x44bbff,
    emissive: 0x44bbff,
    emissiveIntensity: 3.0,
  });

  // Main hull (hammerhead shape)
  const hullGeo = new THREE.CylinderGeometry(3, 4, 24, 12);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.rotation.x = Math.PI / 2;
  group.add(hull);

  // Cockpit section
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(3.5, 12, 12), hullMat);
  cockpit.position.z = -14;
  cockpit.scale.set(1, 0.8, 1.2);
  group.add(cockpit);

  // Red stripe
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.5, 12), redMat);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.z = -8;
  group.add(stripe);

  // Engine section
  const engineSection = new THREE.Mesh(new THREE.CylinderGeometry(4, 3, 6, 12), darkMat);
  engineSection.rotation.x = Math.PI / 2;
  engineSection.position.z = 15;
  group.add(engineSection);

  // Engine cluster
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const r = i === 0 ? 0 : 2;
    const engineGlow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 8), engineMat);
    engineGlow.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 18.1);
    group.add(engineGlow);
  }

  return group;
}

function buildProceduralTransport(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x7a7f8d, metalness: 0.3, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.2, roughness: 0.7 });

  // Boxy cargo hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 10), hullMat);
  group.add(hull);

  // Cockpit
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 3), darkMat);
  cockpit.position.set(0, 1.5, -5);
  group.add(cockpit);

  // Engine pods
  for (let i = -1; i <= 1; i += 2) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 4, 8), darkMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(i * 4, 0, 3);
    group.add(engine);
  }

  return group;
}

function buildProceduralShuttle(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.25, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.2, roughness: 0.7 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.3, roughness: 0.7 });

  // Main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 12), hullMat);
  group.add(body);

  // Cockpit
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 4), darkMat);
  cockpit.position.set(0, 1, -6);
  group.add(cockpit);

  // Lower wings (folded position for Lambda-class style)
  for (let i = -1; i <= 1; i += 2) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 6), wingMat);
    wing.position.set(i * 4, -2, 1);
    wing.rotation.z = i * -0.3;
    group.add(wing);
  }

  // Dorsal fin (Lambda shuttle style)
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 8), wingMat);
  fin.position.set(0, 6, 2);
  group.add(fin);

  return group;
}
