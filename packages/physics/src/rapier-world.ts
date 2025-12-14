import * as RAPIER from "@dimforge/rapier3d";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type Vec3 = { x: number; y: number; z: number };

export type PhysicsWorld = {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  characterControllers: Map<number, RAPIER.KinematicCharacterController>;
  rigidBodies: Map<number, RAPIER.RigidBody>;
  colliders: Map<number, RAPIER.Collider>;
};

// ─────────────────────────────────────────────────────────────────────────────
// MODULE ACCESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the Rapier module (synchronous in v0.19+).
 */
export function getRapier(): typeof RAPIER {
  return RAPIER;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new physics world.
 */
export function createPhysicsWorld(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }): PhysicsWorld {
  const world = new RAPIER.World(gravity);

  return {
    rapier: RAPIER,
    world,
    characterControllers: new Map(),
    rigidBodies: new Map(),
    colliders: new Map()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step the physics simulation forward by dt seconds.
 */
export function stepPhysics(pw: PhysicsWorld, dt: number): void {
  pw.world.timestep = Math.min(dt, 1 / 30); // Cap at ~33ms for stability
  pw.world.step();
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGID BODY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a static rigid body with a box collider (for level geometry).
 */
export function createStaticBox(
  pw: PhysicsWorld,
  position: Vec3,
  halfExtents: Vec3
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const { world } = pw;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
    position.x,
    position.y,
    position.z
  );
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    halfExtents.x,
    halfExtents.y,
    halfExtents.z
  );
  const collider = world.createCollider(colliderDesc, body);

  return { body, collider };
}

/**
 * Create a static ground plane (large box at given Y).
 */
export function createGroundPlane(
  pw: PhysicsWorld,
  y: number = 0
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const { world } = pw;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, y - 0.1, 0);
  const body = world.createRigidBody(bodyDesc);

  // Large thin box as ground plane
  const colliderDesc = RAPIER.ColliderDesc.cuboid(1000, 0.1, 1000);
  const collider = world.createCollider(colliderDesc, body);

  return { body, collider };
}

/**
 * Create a kinematic capsule body for a character.
 */
export function createCharacterBody(
  pw: PhysicsWorld,
  eid: number,
  position: Vec3,
  capsuleHalfHeight: number,
  capsuleRadius: number
): { body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } {
  const { world, rigidBodies, colliders, characterControllers } = pw;

  // Kinematic position-based body
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    position.x,
    position.y,
    position.z
  );
  const body = world.createRigidBody(bodyDesc);
  rigidBodies.set(eid, body);

  // Capsule collider
  const colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius);
  const collider = world.createCollider(colliderDesc, body);
  colliders.set(eid, collider);

  // Character controller with sensible defaults
  const controller = world.createCharacterController(0.01); // 1cm offset
  controller.setSlideEnabled(true);
  controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);
  controller.enableAutostep(0.35, 0.3, true);
  controller.enableSnapToGround(0.5);
  characterControllers.set(eid, controller);

  return { body, collider, controller };
}

/**
 * Remove a character from the physics world.
 */
export function removeCharacterBody(pw: PhysicsWorld, eid: number): void {
  const { world, rigidBodies, colliders, characterControllers } = pw;

  const controller = characterControllers.get(eid);
  if (controller) {
    world.removeCharacterController(controller);
    characterControllers.delete(eid);
  }

  const body = rigidBodies.get(eid);
  if (body) {
    world.removeRigidBody(body);
    rigidBodies.delete(eid);
  }

  colliders.delete(eid);
}

// ─────────────────────────────────────────────────────────────────────────────
// RAYCASTING
// ─────────────────────────────────────────────────────────────────────────────

export type RaycastHit = {
  point: Vec3;
  normal: Vec3;
  toi: number; // time of impact (distance along ray)
  colliderHandle: number;
};

/**
 * Cast a ray and return the first hit, or null if nothing hit.
 */
export function raycast(
  pw: PhysicsWorld,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number
): RaycastHit | null {
  const { world } = pw;

  const ray = new RAPIER.Ray(origin, direction);
  const hit = world.castRay(ray, maxDistance, true);

  if (!hit) return null;

  const point = ray.pointAt(hit.timeOfImpact);
  // Get normal by casting with normal flag
  const hitWithNormal = world.castRayAndGetNormal(ray, maxDistance, true);
  const normal = hitWithNormal?.normal ?? { x: 0, y: 1, z: 0 };

  return {
    point: { x: point.x, y: point.y, z: point.z },
    normal: { x: normal.x, y: normal.y, z: normal.z },
    toi: hit.timeOfImpact,
    colliderHandle: hit.collider.handle
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispose of the physics world and all its resources.
 */
export function disposePhysicsWorld(pw: PhysicsWorld): void {
  pw.world.free();
  pw.characterControllers.clear();
  pw.rigidBodies.clear();
  pw.colliders.clear();
}
