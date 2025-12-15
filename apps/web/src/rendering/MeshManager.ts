/**
 * MeshManager - Centralized entity-to-mesh lifecycle management
 * Ensures proper disposal of Three.js objects to prevent GPU memory leaks
 */

import * as THREE from "three";

/**
 * Properly dispose of a Three.js object and all its children
 */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(child.material);
        }
      }
    }
    if (child instanceof THREE.Points) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(child.material);
        }
      }
    }
    if (child instanceof THREE.Line) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(child.material);
        }
      }
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  material.dispose();

  // Dispose textures if present
  const mat = material as THREE.MeshStandardMaterial;
  if (mat.map) mat.map.dispose();
  if (mat.normalMap) mat.normalMap.dispose();
  if (mat.roughnessMap) mat.roughnessMap.dispose();
  if (mat.metalnessMap) mat.metalnessMap.dispose();
  if (mat.emissiveMap) mat.emissiveMap.dispose();
  if (mat.bumpMap) mat.bumpMap.dispose();
  if (mat.displacementMap) mat.displacementMap.dispose();
  if (mat.alphaMap) mat.alphaMap.dispose();
  if (mat.aoMap) mat.aoMap.dispose();
  if (mat.envMap) mat.envMap.dispose();
  if (mat.lightMap) mat.lightMap.dispose();
}

/**
 * MeshManager class for tracking entity-to-mesh relationships
 */
export class MeshManager {
  private scene: THREE.Scene;
  private meshes = new Map<number, THREE.Object3D>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Register a mesh for an entity
   */
  register(eid: number, mesh: THREE.Object3D): void {
    // Remove existing mesh if present
    if (this.meshes.has(eid)) {
      this.remove(eid);
    }
    this.meshes.set(eid, mesh);
    this.scene.add(mesh);
  }

  /**
   * Get the mesh for an entity
   */
  get(eid: number): THREE.Object3D | undefined {
    return this.meshes.get(eid);
  }

  /**
   * Check if an entity has a registered mesh
   */
  has(eid: number): boolean {
    return this.meshes.has(eid);
  }

  /**
   * Remove and dispose the mesh for an entity
   */
  remove(eid: number): void {
    const mesh = this.meshes.get(eid);
    if (mesh) {
      this.scene.remove(mesh);
      disposeObject(mesh);
      this.meshes.delete(eid);
    }
  }

  /**
   * Remove meshes for entities that are no longer in the provided set
   */
  sync(activeEids: Set<number> | number[]): void {
    const active = activeEids instanceof Set ? activeEids : new Set(activeEids);
    for (const eid of this.meshes.keys()) {
      if (!active.has(eid)) {
        this.remove(eid);
      }
    }
  }

  /**
   * Remove and dispose all meshes
   */
  clear(): void {
    for (const eid of [...this.meshes.keys()]) {
      this.remove(eid);
    }
  }

  /**
   * Get all registered entity IDs
   */
  get entities(): number[] {
    return [...this.meshes.keys()];
  }

  /**
   * Get the count of registered meshes
   */
  get size(): number {
    return this.meshes.size;
  }
}

/**
 * Specialized mesh manager for projectiles with pooling
 */
export class ProjectileMeshPool {
  private scene: THREE.Scene;
  private active = new Map<number, THREE.Mesh>();
  private pool: THREE.Mesh[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.Material;

  constructor(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.scene = scene;
    this.geometry = geometry;
    this.material = material;
  }

  acquire(eid: number): THREE.Mesh {
    let mesh = this.pool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.geometry, this.material);
    }
    mesh.visible = true;
    this.active.set(eid, mesh);
    this.scene.add(mesh);
    return mesh;
  }

  release(eid: number): void {
    const mesh = this.active.get(eid);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.visible = false;
      this.pool.push(mesh);
      this.active.delete(eid);
    }
  }

  get(eid: number): THREE.Mesh | undefined {
    return this.active.get(eid);
  }

  sync(activeEids: Set<number> | number[]): void {
    const active = activeEids instanceof Set ? activeEids : new Set(activeEids);
    for (const eid of [...this.active.keys()]) {
      if (!active.has(eid)) {
        this.release(eid);
      }
    }
  }

  clear(): void {
    for (const eid of [...this.active.keys()]) {
      this.release(eid);
    }
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.pool = [];
  }
}
