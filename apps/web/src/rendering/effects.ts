/**
 * Visual effects module - explosions, glow textures, projectile rendering
 * Shared across all game modes
 */

import * as THREE from "three";

// ─────────────────────────────────────────────────────────────────────────────
// Glow Texture
// ─────────────────────────────────────────────────────────────────────────────

let glowTexture: THREE.CanvasTexture | null = null;

export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;

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

  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bolt Materials (for laser projectiles)
// ─────────────────────────────────────────────────────────────────────────────

let boltGeo: THREE.CylinderGeometry | null = null;
let boltMatFriendly: THREE.MeshBasicMaterial | null = null;
let boltMatEnemy: THREE.MeshBasicMaterial | null = null;

export function getBoltGeometry(): THREE.CylinderGeometry {
  if (!boltGeo) {
    // FIX: Increased bolt radius from 0.28 to 0.8 (much more visible)
    boltGeo = new THREE.CylinderGeometry(0.8, 0.8, 12, 6);
  }
  return boltGeo;
}

export function getBoltMaterial(friendly: boolean): THREE.MeshBasicMaterial {
  if (friendly) {
    if (!boltMatFriendly) {
      boltMatFriendly = new THREE.MeshBasicMaterial({
        color: 0xff5555,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
    }
    return boltMatFriendly;
  } else {
    if (!boltMatEnemy) {
      boltMatEnemy = new THREE.MeshBasicMaterial({
        color: 0x66ff77,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
    }
    return boltMatEnemy;
  }
}

export function makeBoltGlow(color: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  // FIX: Increased glow from 6.5 to 10 (more visible laser bolts)
  sprite.scale.setScalar(10);
  sprite.renderOrder = 9;
  return sprite;
}

// ─────────────────────────────────────────────────────────────────────────────
// Explosion System
// ─────────────────────────────────────────────────────────────────────────────

type ExplosionFx = {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
  maxScale: number;
};

const explosionGeo = new THREE.SphereGeometry(1, 14, 14);

/**
 * Manages explosion visual effects with object pooling
 */
export class ExplosionManager {
  private scene: THREE.Scene;
  private active: ExplosionFx[] = [];
  private pool: ExplosionFx[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn an explosion at position
   */
  spawn(pos: THREE.Vector3, color = 0xffcc66, duration = 0.85, maxScale = 14): void {
    const fx = this.pool.pop() ?? this.createExplosion();

    fx.age = 0;
    fx.duration = duration;
    fx.maxScale = maxScale;
    fx.mesh.position.copy(pos);
    fx.mesh.scale.setScalar(1);

    const mat = fx.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 1;

    this.scene.add(fx.mesh);
    this.active.push(fx);
  }

  /**
   * Update all active explosions
   */
  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i]!;
      fx.age += dt;
      const t = fx.age / fx.duration;
      const scale = 1 + t * fx.maxScale;
      fx.mesh.scale.setScalar(scale);

      const mat = fx.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - t);

      if (t >= 1) {
        this.scene.remove(fx.mesh);
        this.active.splice(i, 1);
        this.pool.push(fx);
      }
    }
  }

  /**
   * Reset all explosions (e.g., on mode change)
   */
  reset(): void {
    for (const fx of this.active) {
      this.scene.remove(fx.mesh);
      this.pool.push(fx);
    }
    this.active.length = 0;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.reset();
    for (const fx of this.pool) {
      fx.mesh.geometry.dispose();
      (fx.mesh.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
  }

  private createExplosion(): ExplosionFx {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(explosionGeo, mat);
    mesh.renderOrder = 10;
    return { mesh, age: 0, duration: 0.7, maxScale: 8 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Starfield Builder
// ─────────────────────────────────────────────────────────────────────────────

import { createRng } from "@xwingz/procgen";

export function buildStarfield(
  seed: bigint,
  count: number = 2500,
  minRadius: number = 400,
  maxRadius: number = 6400
): THREE.Points {
  const rng = createRng(seed);
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const r = minRadius + rng.range(0, maxRadius - minRadius);
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(rng.range(-1, 1));
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x88aaff,
    size: 1.1,
    sizeAttenuation: true
  });

  return new THREE.Points(geo, mat);
}
