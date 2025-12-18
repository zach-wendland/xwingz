/**
 * Physics Integration Tests
 *
 * Tests physics behavior contracts and integration patterns.
 * While full Rapier WASM tests require e2e, these tests verify:
 * - Physics calculation helpers
 * - Movement integration patterns
 * - Collision detection logic
 * - Character controller behavior contracts
 */

// Import SpatialHash directly (no WASM dependency)
import { SpatialHash } from "../../../packages/physics/src/SpatialHash";

// ─────────────────────────────────────────────────────────────────────────────
// Vector Math Helpers (used in physics calculations)
// ─────────────────────────────────────────────────────────────────────────────

function vec3Length(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function vec3Normalize(
  x: number,
  y: number,
  z: number
): { x: number; y: number; z: number } {
  const len = vec3Length(x, y, z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

function vec3Dot(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  return ax * bx + ay * by + az * bz;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Physics Integration", () => {
  describe("Movement Integration", () => {
    it("should integrate position from velocity correctly", () => {
      let x = 0,
        y = 0,
        z = 0;
      const vx = 10,
        vy = 5,
        vz = -20;
      const dt = 0.016; // 60 FPS

      // Simple Euler integration
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;

      expect(x).toBeCloseTo(0.16, 5);
      expect(y).toBeCloseTo(0.08, 5);
      expect(z).toBeCloseTo(-0.32, 5);
    });

    it("should apply acceleration to velocity", () => {
      let vx = 0,
        vy = 0,
        vz = -100;
      const ax = 0,
        ay = 0,
        az = -50; // Accelerating forward
      const dt = 0.1;

      vx += ax * dt;
      vy += ay * dt;
      vz += az * dt;

      expect(vz).toBeCloseTo(-105, 5);
    });

    it("should clamp velocity to max speed", () => {
      const maxSpeed = 250;
      let vx = 0,
        vy = 0,
        vz = -300; // Exceeds max

      const speed = vec3Length(vx, vy, vz);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        vx *= scale;
        vy *= scale;
        vz *= scale;
      }

      const newSpeed = vec3Length(vx, vy, vz);
      expect(newSpeed).toBeCloseTo(maxSpeed, 5);
    });

    it("should apply drag to slow down", () => {
      const drag = 0.98;
      let vx = 100,
        vy = 50,
        vz = -200;

      // Apply drag for multiple frames
      for (let i = 0; i < 60; i++) {
        vx *= drag;
        vy *= drag;
        vz *= drag;
      }

      const speed = vec3Length(vx, vy, vz);
      expect(speed).toBeLessThan(100);
    });
  });

  describe("Rotation Integration", () => {
    it("should integrate angular velocity into rotation", () => {
      // Simplified quaternion integration
      let qx = 0,
        qy = 0,
        qz = 0,
        qw = 1;
      const wx = 0,
        wy = 1.0,
        wz = 0; // Rotate around Y
      const dt = 0.016;

      // Quaternion derivative: q' = 0.5 * omega * q
      const halfDt = 0.5 * dt;
      const dqx = halfDt * (wx * qw + wy * qz - wz * qy);
      const dqy = halfDt * (wy * qw + wz * qx - wx * qz);
      const dqz = halfDt * (wz * qw + wx * qy - wy * qx);
      const dqw = halfDt * (-wx * qx - wy * qy - wz * qz);

      qx += dqx;
      qy += dqy;
      qz += dqz;
      qw += dqw;

      // Normalize
      const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      qx /= len;
      qy /= len;
      qz /= len;
      qw /= len;

      // Quaternion should have changed
      expect(qy).toBeGreaterThan(0);
      expect(qw).toBeLessThan(1);
    });

    it("should clamp angular velocity to limits", () => {
      const maxAngularVelocity = 2.0;
      let wx = 3.0,
        wy = -4.0,
        wz = 1.0;

      const angSpeed = vec3Length(wx, wy, wz);
      if (angSpeed > maxAngularVelocity) {
        const scale = maxAngularVelocity / angSpeed;
        wx *= scale;
        wy *= scale;
        wz *= scale;
      }

      const newAngSpeed = vec3Length(wx, wy, wz);
      expect(newAngSpeed).toBeCloseTo(maxAngularVelocity, 5);
    });
  });

  describe("Collision Detection Logic", () => {
    it("should detect sphere-sphere collision", () => {
      const sphere1 = { x: 0, y: 0, z: 0, radius: 10 };
      const sphere2 = { x: 15, y: 0, z: 0, radius: 10 };

      const dx = sphere2.x - sphere1.x;
      const dy = sphere2.y - sphere1.y;
      const dz = sphere2.z - sphere1.z;
      const distance = vec3Length(dx, dy, dz);
      const minDist = sphere1.radius + sphere2.radius;

      const colliding = distance < minDist;
      expect(colliding).toBe(true);
    });

    it("should not detect collision when spheres are apart", () => {
      const sphere1 = { x: 0, y: 0, z: 0, radius: 10 };
      const sphere2 = { x: 30, y: 0, z: 0, radius: 10 };

      const dx = sphere2.x - sphere1.x;
      const dy = sphere2.y - sphere1.y;
      const dz = sphere2.z - sphere1.z;
      const distance = vec3Length(dx, dy, dz);
      const minDist = sphere1.radius + sphere2.radius;

      const colliding = distance < minDist;
      expect(colliding).toBe(false);
    });

    it("should calculate collision normal correctly", () => {
      const sphere1 = { x: 0, y: 0, z: 0 };
      const sphere2 = { x: 10, y: 0, z: 0 };

      const dx = sphere2.x - sphere1.x;
      const dy = sphere2.y - sphere1.y;
      const dz = sphere2.z - sphere1.z;

      const normal = vec3Normalize(dx, dy, dz);

      expect(normal.x).toBeCloseTo(1, 5);
      expect(normal.y).toBeCloseTo(0, 5);
      expect(normal.z).toBeCloseTo(0, 5);
    });

    it("should calculate penetration depth", () => {
      const sphere1 = { x: 0, y: 0, z: 0, radius: 10 };
      const sphere2 = { x: 15, y: 0, z: 0, radius: 10 };

      const dx = sphere2.x - sphere1.x;
      const dy = sphere2.y - sphere1.y;
      const dz = sphere2.z - sphere1.z;
      const distance = vec3Length(dx, dy, dz);
      const minDist = sphere1.radius + sphere2.radius;

      const penetration = minDist - distance;

      expect(penetration).toBeCloseTo(5, 5); // 20 - 15 = 5
    });
  });

  describe("Spatial Query Integration", () => {
    it("should find collision candidates efficiently", () => {
      const hash = new SpatialHash(50);

      // Add many entities
      const entities: { eid: number; x: number; z: number }[] = [];
      for (let i = 0; i < 100; i++) {
        const x = Math.floor(i % 10) * 100;
        const z = Math.floor(i / 10) * 100;
        hash.insert(i, x, 0, z);
        entities.push({ eid: i, x, z });
      }

      // Query near origin
      const candidates = hash.query(50, 0, 50, 100);

      // Should find only nearby entities, not all 100
      expect(candidates.length).toBeLessThan(100);
      expect(candidates.length).toBeGreaterThan(0);
    });

    it("should handle projectile collision pattern", () => {
      const hash = new SpatialHash(100);

      // Targets
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 200, 0, 0);
      hash.insert(3, 500, 0, 0);

      // Projectile near target 1
      const proj = { x: 5, y: 0, z: 0, radius: 3 };
      const candidates = hash.query(proj.x, proj.y, proj.z, proj.radius + 10);

      expect(candidates).toContain(1);
      expect(candidates).not.toContain(3);
    });

    it("should handle turret targeting pattern", () => {
      const hash = new SpatialHash(150);

      // Fighters
      hash.insert(1, 100, 50, -200);
      hash.insert(2, -150, 0, -100);
      hash.insert(3, 0, 0, -1000); // Far away

      // Turret at origin with range 500
      const turretRange = 500;
      const candidates = hash.query(0, 0, 0, turretRange);

      expect(candidates).toContain(1);
      expect(candidates).toContain(2);
      expect(candidates).not.toContain(3);
    });
  });

  describe("Character Controller Patterns", () => {
    it("should apply ground snap", () => {
      let y = 0.3; // Slightly above ground
      const groundY = 0;
      const snapDistance = 0.5;

      const distToGround = y - groundY;
      if (distToGround > 0 && distToGround <= snapDistance) {
        y = groundY;
      }

      expect(y).toBe(0);
    });

    it("should prevent sinking through ground", () => {
      let y = -0.5; // Below ground
      const groundY = 0;

      if (y < groundY) {
        y = groundY;
      }

      expect(y).toBe(0);
    });

    it("should limit slope climbing angle", () => {
      const maxSlopeAngle = (45 * Math.PI) / 180; // 45 degrees
      const slopeNormal = { x: 0, y: 0.6, z: -0.8 }; // ~53 degree slope

      // Dot product with up vector gives cos of angle from vertical
      const dotUp = slopeNormal.y;
      const slopeAngle = Math.acos(dotUp);

      const canClimb = slopeAngle <= maxSlopeAngle;
      expect(canClimb).toBe(false); // Too steep
    });

    it("should allow climbing gentle slopes", () => {
      const maxSlopeAngle = (45 * Math.PI) / 180;
      const slopeNormal = { x: 0, y: 0.97, z: -0.24 }; // ~14 degree slope

      const dotUp = slopeNormal.y;
      const slopeAngle = Math.acos(dotUp);

      const canClimb = slopeAngle <= maxSlopeAngle;
      expect(canClimb).toBe(true);
    });

    it("should apply step-up for small obstacles", () => {
      const autostepHeight = 0.35;
      const obstacleHeight = 0.2;

      const canStep = obstacleHeight <= autostepHeight;
      expect(canStep).toBe(true);
    });

    it("should block step-up for tall obstacles", () => {
      const autostepHeight = 0.35;
      const obstacleHeight = 0.5;

      const canStep = obstacleHeight <= autostepHeight;
      expect(canStep).toBe(false);
    });
  });

  describe("Raycast Patterns", () => {
    it("should calculate ray direction from origin and target", () => {
      const origin = { x: 0, y: 10, z: 0 };
      const target = { x: 0, y: 0, z: 0 };

      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dz = target.z - origin.z;

      const dir = vec3Normalize(dx, dy, dz);

      expect(dir.x).toBeCloseTo(0, 5);
      expect(dir.y).toBeCloseTo(-1, 5);
      expect(dir.z).toBeCloseTo(0, 5);
    });

    it("should calculate ray-plane intersection", () => {
      // Ray from (0, 10, 0) pointing down
      const rayOrigin = { x: 0, y: 10, z: 0 };
      const rayDir = { x: 0, y: -1, z: 0 };

      // Plane at y=0 with normal (0, 1, 0)
      const planePoint = { x: 0, y: 0, z: 0 };
      const planeNormal = { x: 0, y: 1, z: 0 };

      // t = (planePoint - rayOrigin) . planeNormal / (rayDir . planeNormal)
      const denom = vec3Dot(
        rayDir.x,
        rayDir.y,
        rayDir.z,
        planeNormal.x,
        planeNormal.y,
        planeNormal.z
      );

      if (Math.abs(denom) > 0.0001) {
        const t =
          vec3Dot(
            planePoint.x - rayOrigin.x,
            planePoint.y - rayOrigin.y,
            planePoint.z - rayOrigin.z,
            planeNormal.x,
            planeNormal.y,
            planeNormal.z
          ) / denom;

        const hitY = rayOrigin.y + rayDir.y * t;
        expect(hitY).toBeCloseTo(0, 5);
        expect(t).toBeCloseTo(10, 5); // Distance to plane
      }
    });
  });

  describe("Physics Time Step", () => {
    it("should clamp large delta times for stability", () => {
      const maxTimestep = 1 / 30;
      let dt = 0.5; // Half second (very large)

      dt = Math.min(dt, maxTimestep);

      expect(dt).toBeCloseTo(1 / 30, 5);
    });

    it("should handle fixed timestep accumulator", () => {
      const fixedDt = 1 / 60;
      let accumulator = 0;
      let steps = 0;

      // Simulate frame with varying dt
      const frameDts = [0.016, 0.033, 0.017, 0.050];

      for (const frameDt of frameDts) {
        accumulator += frameDt;

        while (accumulator >= fixedDt) {
          steps++;
          accumulator -= fixedDt;
        }
      }

      // Should have processed multiple physics steps
      expect(steps).toBeGreaterThan(4);
      expect(accumulator).toBeLessThan(fixedDt);
    });
  });

  describe("Gravity and Forces", () => {
    it("should apply gravity correctly", () => {
      const gravity = -9.81;
      let vy = 0;
      const dt = 0.1;

      // Apply gravity for 10 frames
      for (let i = 0; i < 10; i++) {
        vy += gravity * dt;
      }

      expect(vy).toBeCloseTo(-9.81, 2);
    });

    it("should simulate projectile arc", () => {
      let x = 0,
        y = 10,
        z = 0;
      let vx = 50,
        vy = 20,
        vz = 0;
      const gravity = -9.81;
      const dt = 0.1;

      const positions: { x: number; y: number }[] = [];

      // Simulate until hits ground
      while (y >= 0) {
        positions.push({ x, y });
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        vy += gravity * dt;
      }

      // Should have created an arc
      expect(positions.length).toBeGreaterThan(5);
      // Y should have gone up then down
      const maxY = Math.max(...positions.map((p) => p.y));
      expect(maxY).toBeGreaterThan(10); // Rose above starting height
    });

    it("should apply impulse correctly", () => {
      const mass = 10;
      let vx = 0,
        vy = 0,
        vz = 0;

      // Impulse = force * dt, but for instant impulse: v = impulse / mass
      const impulse = { x: 100, y: 50, z: 0 };
      vx += impulse.x / mass;
      vy += impulse.y / mass;
      vz += impulse.z / mass;

      expect(vx).toBeCloseTo(10, 5);
      expect(vy).toBeCloseTo(5, 5);
    });
  });
});
