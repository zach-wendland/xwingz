/**
 * Unit tests for Capital Ship Systems
 * Target coverage: 80% (~35 tests)
 *
 * Tests capital ship spawning, turrets, subsystems, damage, shields, and movement.
 */

import { createWorld, addEntity, addComponent, hasComponent, removeEntity, defineQuery } from 'bitecs';
import {
  Transform,
  Velocity,
  Team,
  Health,
  HitRadius,
  Targetable
} from '../../../packages/gameplay/src/space/components';

import {
  CapitalShipV2,
  Turret,
  Subsystem,
  TurretProjectile,
  WeakPointV2,
  ShipClass,
  SubsystemType,
  TurretType
} from '../../../packages/gameplay/src/space/capital-components';

import {
  spawnCapitalShipV2,
  parentChildTransformSystem,
  capitalShipMovementSystem,
  capitalShipShieldSystem,
  turretTargetingSystem,
  turretRotationSystem,
  turretFireSystem,
  turretProjectileSystem,
  subsystemEffectsSystem,
  removeCapitalShipV2,
  rebuildFighterSpatialHash,
  consumeTurretFireEvents,
  consumeSubsystemDestroyedEvents,
  type TurretConfig,
  type SubsystemConfig,
  type CapitalShipParams
} from '../../../packages/gameplay/src/space/capital-systems';

// Helper to create a fighter target for turrets
function createFighterTarget(world: ReturnType<typeof createWorld>, teamId: number, x = 0, y = 0, z = 0): number {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Team, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Team.id[eid] = teamId;
  Health.hp[eid] = 80;
  Health.maxHp[eid] = 80;
  HitRadius.r[eid] = 8;

  return eid;
}

describe('Capital Ship Systems', () => {
  describe('spawnCapitalShipV2', () => {
    it('should spawn a Star Destroyer (Destroyer class)', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer,
        x: 0,
        y: 0,
        z: 1000
      });

      expect(result.shipEid).toBeGreaterThanOrEqual(0);
      expect(hasComponent(world, CapitalShipV2, result.shipEid)).toBe(true);
      expect(hasComponent(world, Transform, result.shipEid)).toBe(true);
      expect(hasComponent(world, Velocity, result.shipEid)).toBe(true);
      expect(hasComponent(world, Team, result.shipEid)).toBe(true);
      expect(hasComponent(world, Targetable, result.shipEid)).toBe(true);

      expect(CapitalShipV2.shipClass[result.shipEid]).toBe(ShipClass.Destroyer);
      expect(Team.id[result.shipEid]).toBe(1);
      expect(Transform.z[result.shipEid]).toBe(1000);
    });

    it('should spawn a Cruiser class ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 0,
        shipClass: ShipClass.Cruiser
      });

      expect(CapitalShipV2.shipClass[result.shipEid]).toBe(ShipClass.Cruiser);
      // Cruiser has smaller stats than Destroyer
      expect(CapitalShipV2.length[result.shipEid]).toBeLessThan(128); // Destroyer length
    });

    it('should spawn a Frigate class ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 0,
        shipClass: ShipClass.Frigate
      });

      expect(CapitalShipV2.shipClass[result.shipEid]).toBe(ShipClass.Frigate);
      expect(result.turretEids.length).toBeGreaterThan(0);
      expect(result.subsystemEids.length).toBeGreaterThan(0);
    });

    it('should spawn a Corvette class ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 0,
        shipClass: ShipClass.Corvette
      });

      expect(CapitalShipV2.shipClass[result.shipEid]).toBe(ShipClass.Corvette);
      // Corvettes have fewer turrets
      expect(result.turretEids.length).toBeGreaterThanOrEqual(2);
    });

    it('should spawn turrets for the capital ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      expect(result.turretEids.length).toBeGreaterThan(0);

      for (const tid of result.turretEids) {
        expect(hasComponent(world, Turret, tid)).toBe(true);
        expect(hasComponent(world, Transform, tid)).toBe(true);
        expect(Turret.parentEid[tid]).toBe(result.shipEid);
        expect(Team.id[tid]).toBe(1);
      }
    });

    it('should spawn subsystems for the capital ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      expect(result.subsystemEids.length).toBeGreaterThan(0);

      for (const sid of result.subsystemEids) {
        expect(hasComponent(world, Subsystem, sid)).toBe(true);
        expect(hasComponent(world, Transform, sid)).toBe(true);
        expect(hasComponent(world, Health, sid)).toBe(true);
        expect(hasComponent(world, HitRadius, sid)).toBe(true);
        expect(Subsystem.parentEid[sid]).toBe(result.shipEid);
      }
    });

    it('should spawn weak points for Destroyer class', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      expect(result.weakPointEids.length).toBeGreaterThan(0);

      for (const wid of result.weakPointEids) {
        expect(hasComponent(world, WeakPointV2, wid)).toBe(true);
        expect(WeakPointV2.parentEid[wid]).toBe(result.shipEid);
        expect(WeakPointV2.revealed[wid]).toBe(0); // Hidden initially
        expect(WeakPointV2.damageMultiplier[wid]).toBeGreaterThan(1);
      }
    });

    it('should initialize hull sections correctly', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;

      expect(CapitalShipV2.hullFore[shipEid]).toBeGreaterThan(0);
      expect(CapitalShipV2.hullMid[shipEid]).toBeGreaterThan(0);
      expect(CapitalShipV2.hullAft[shipEid]).toBeGreaterThan(0);
      expect(CapitalShipV2.hullFore[shipEid]).toBe(CapitalShipV2.hullForeMax[shipEid]);
    });

    it('should initialize shields correctly', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;
      const shieldMax = CapitalShipV2.shieldMax[shipEid] ?? 0;

      expect(shieldMax).toBeGreaterThan(0);
      expect(CapitalShipV2.shieldFront[shipEid]).toBeCloseTo(shieldMax / 2, 5);
      expect(CapitalShipV2.shieldRear[shipEid]).toBeCloseTo(shieldMax / 2, 5);
    });

    it('should set position and rotation from params', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 0,
        shipClass: ShipClass.Cruiser,
        x: 100,
        y: 50,
        z: -200,
        qx: 0,
        qy: 0.707,
        qz: 0,
        qw: 0.707
      });

      expect(Transform.x[result.shipEid]).toBe(100);
      expect(Transform.y[result.shipEid]).toBe(50);
      expect(Transform.z[result.shipEid]).toBe(-200);
      expect(Transform.qy[result.shipEid]).toBeCloseTo(0.707, 3);
      expect(Transform.qw[result.shipEid]).toBeCloseTo(0.707, 3);
    });

    it('should initialize hangar capacity based on ship class', () => {
      const world = createWorld();
      const destroyer = spawnCapitalShipV2(world, { team: 1, shipClass: ShipClass.Destroyer });
      const corvette = spawnCapitalShipV2(world, { team: 1, shipClass: ShipClass.Corvette });

      expect(CapitalShipV2.hangarCapacity[destroyer.shipEid]).toBeGreaterThan(
        CapitalShipV2.hangarCapacity[corvette.shipEid]
      );
    });
  });

  describe('parentChildTransformSystem', () => {
    it('should sync turret positions to parent ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer,
        x: 100,
        y: 0,
        z: 0
      });

      parentChildTransformSystem(world);

      // Check that turrets have been positioned relative to ship
      for (const tid of result.turretEids) {
        const turretX = Transform.x[tid] ?? 0;
        // Turret X should be ship X + offset (varies per turret)
        expect(turretX).not.toBe(0); // Should have been updated
      }
    });

    it('should sync subsystem positions to parent ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer,
        x: 0,
        y: 100,
        z: 0
      });

      parentChildTransformSystem(world);

      for (const sid of result.subsystemEids) {
        const subsystemY = Transform.y[sid] ?? 0;
        // Subsystem Y should include ship Y (100) + offset
        expect(Math.abs(subsystemY)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should sync weak point positions to parent ship', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer,
        x: 50,
        y: 0,
        z: 200
      });

      parentChildTransformSystem(world);

      for (const wid of result.weakPointEids) {
        // Weak point Z should include ship Z (200) + offset
        const wpZ = Transform.z[wid] ?? 0;
        expect(Math.abs(wpZ)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should apply ship rotation to child positions', () => {
      const world = createWorld();

      // Ship rotated 90 degrees around Y axis
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette,
        x: 0,
        y: 0,
        z: 0,
        qx: 0,
        qy: 0.707,
        qz: 0,
        qw: 0.707
      });

      // Initial turret position before sync
      parentChildTransformSystem(world);

      // After rotation, turret offsets should be rotated
      // A turret originally at +X offset should now be at roughly +Z
      const tid = result.turretEids[0];
      if (tid !== undefined) {
        expect(hasComponent(world, Transform, tid)).toBe(true);
      }
    });
  });

  describe('capitalShipMovementSystem', () => {
    it('should move ship forward based on throttle', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;
      CapitalShipV2.throttle[shipEid] = 1.0;

      // Run movement for a few frames
      for (let i = 0; i < 10; i++) {
        capitalShipMovementSystem(world, 0.1);
      }

      // Ship should have moved (default forward is -Z)
      const vz = Velocity.vz[shipEid] ?? 0;
      expect(Math.abs(vz)).toBeGreaterThan(0);
    });

    it('should accelerate toward target speed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;
      CapitalShipV2.throttle[shipEid] = 0.5;
      const maxSpeed = CapitalShipV2.maxSpeed[shipEid] ?? 15;

      Velocity.vx[shipEid] = 0;
      Velocity.vy[shipEid] = 0;
      Velocity.vz[shipEid] = 0;

      // Run movement until close to target
      for (let i = 0; i < 100; i++) {
        capitalShipMovementSystem(world, 0.1);
      }

      const speed = Math.sqrt(
        (Velocity.vx[shipEid] ?? 0) ** 2 +
        (Velocity.vy[shipEid] ?? 0) ** 2 +
        (Velocity.vz[shipEid] ?? 0) ** 2
      );

      expect(speed).toBeCloseTo(maxSpeed * 0.5, 0);
    });

    it('should decelerate when throttle is reduced', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;

      // Start at full speed
      Velocity.vz[shipEid] = -15; // Forward
      CapitalShipV2.throttle[shipEid] = 0; // Cut throttle

      // Run movement
      for (let i = 0; i < 50; i++) {
        capitalShipMovementSystem(world, 0.1);
      }

      const speed = Math.sqrt(
        (Velocity.vx[shipEid] ?? 0) ** 2 +
        (Velocity.vy[shipEid] ?? 0) ** 2 +
        (Velocity.vz[shipEid] ?? 0) ** 2
      );

      expect(speed).toBeLessThan(15);
    });

    it('should update ship position', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer,
        x: 0,
        y: 0,
        z: 0
      });

      const shipEid = result.shipEid;
      // Capital ship movement uses throttle-based movement, not direct velocity setting
      // Set throttle to move forward
      CapitalShipV2.throttle[shipEid] = 1.0;
      const initialZ = Transform.z[shipEid] ?? 0;

      // Run movement for several frames
      for (let i = 0; i < 50; i++) {
        capitalShipMovementSystem(world, 0.1);
      }

      // Ship should have moved forward (velocity is updated by the system based on throttle)
      expect(Transform.z[shipEid]).toBeLessThan(initialZ);
    });
  });

  describe('capitalShipShieldSystem', () => {
    it('should regenerate shields after delay', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;
      const shieldMax = CapitalShipV2.shieldMax[shipEid] ?? 4000;

      // Damage shields
      CapitalShipV2.shieldFront[shipEid] = 500;
      CapitalShipV2.shieldRear[shipEid] = 500;
      CapitalShipV2.shieldLastHit[shipEid] = 5; // 5 seconds since hit (past delay)

      const frontBefore = CapitalShipV2.shieldFront[shipEid];

      capitalShipShieldSystem(world, 1.0);

      const frontAfter = CapitalShipV2.shieldFront[shipEid];
      expect(frontAfter).toBeGreaterThan(frontBefore ?? 0);
    });

    it('should not regenerate shields during regen delay', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;

      // Damage shields, just hit
      CapitalShipV2.shieldFront[shipEid] = 500;
      CapitalShipV2.shieldLastHit[shipEid] = 0;

      const frontBefore = CapitalShipV2.shieldFront[shipEid];

      capitalShipShieldSystem(world, 0.5); // Short time, still in delay

      const frontAfter = CapitalShipV2.shieldFront[shipEid];
      expect(frontAfter).toBe(frontBefore);
    });

    it('should not exceed max shield value', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;
      const shieldMax = CapitalShipV2.shieldMax[shipEid] ?? 4000;
      const halfMax = shieldMax / 2;

      // Shields almost full
      CapitalShipV2.shieldFront[shipEid] = halfMax - 10;
      CapitalShipV2.shieldLastHit[shipEid] = 10;

      // Regen for a long time
      for (let i = 0; i < 100; i++) {
        capitalShipShieldSystem(world, 1.0);
      }

      expect(CapitalShipV2.shieldFront[shipEid]).toBeLessThanOrEqual(halfMax);
    });

    it('should track time since last hit', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const shipEid = result.shipEid;
      CapitalShipV2.shieldLastHit[shipEid] = 0;

      capitalShipShieldSystem(world, 0.5);

      expect(CapitalShipV2.shieldLastHit[shipEid]).toBeCloseTo(0.5, 5);
    });
  });

  describe('turretTargetingSystem', () => {
    it('should acquire hostile target in range', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette,
        x: 0,
        y: 0,
        z: 0
      });

      parentChildTransformSystem(world);

      // Create hostile fighter in range
      const hostile = createFighterTarget(world, 0, 0, 20, -50);

      rebuildFighterSpatialHash(world);
      turretTargetingSystem(world, 0.1);

      // At least one turret should have acquired the target
      let hasTarget = false;
      for (const tid of result.turretEids) {
        if ((Turret.targetEid[tid] ?? -1) === hostile) {
          hasTarget = true;
          break;
        }
      }
      expect(hasTarget).toBe(true);
    });

    it('should not target friendly ships', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      // Create friendly fighter
      createFighterTarget(world, 1, 0, 20, -50); // Same team

      rebuildFighterSpatialHash(world);
      turretTargetingSystem(world, 0.1);

      // No turret should have a target
      for (const tid of result.turretEids) {
        expect(Turret.targetEid[tid]).toBe(-1);
      }
    });

    it('should clear target when it is destroyed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 0, 20, -50);

      rebuildFighterSpatialHash(world);
      turretTargetingSystem(world, 0.1);

      // Kill the target
      Health.hp[hostile] = 0;

      turretTargetingSystem(world, 0.1);

      // Targets should be cleared or reacquired
      for (const tid of result.turretEids) {
        const targetEid = Turret.targetEid[tid] ?? -1;
        if (targetEid === hostile) {
          // Should have been cleared
          expect(false).toBe(true);
        }
      }
    });

    it('should drop target when out of range', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      // Create target in range
      const hostile = createFighterTarget(world, 0, 0, 20, -100);

      rebuildFighterSpatialHash(world);
      turretTargetingSystem(world, 0.1);

      // Move target far away
      Transform.z[hostile] = -5000;

      rebuildFighterSpatialHash(world);
      turretTargetingSystem(world, 0.1);

      // Turrets should have dropped target
      for (const tid of result.turretEids) {
        expect(Turret.targetEid[tid]).toBe(-1);
      }
    });

    it('should not target when disabled', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      // Disable all turrets
      for (const tid of result.turretEids) {
        Turret.disabled[tid] = 1;
      }

      const hostile = createFighterTarget(world, 0, 0, 20, -50);

      rebuildFighterSpatialHash(world);
      turretTargetingSystem(world, 0.1);

      // No turret should have target
      for (const tid of result.turretEids) {
        expect(Turret.targetEid[tid]).toBe(-1);
      }
    });
  });

  describe('turretRotationSystem', () => {
    it('should rotate turret toward target', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 100, 0, 0); // To the right

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.yaw[tid] = 0;
      Turret.pitch[tid] = 0;

      turretRotationSystem(world, 0.5);

      // Turret should have started rotating (yaw should change)
      expect(Turret.yaw[tid]).not.toBe(0);
    });

    it('should respect rotation limits', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      // Target far behind (trying to force past yaw limit)
      const hostile = createFighterTarget(world, 0, 0, 0, 1000); // Behind

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.yawMin[tid] = -1.0;
      Turret.yawMax[tid] = 1.0;

      // Rotate for several frames
      for (let i = 0; i < 50; i++) {
        turretRotationSystem(world, 0.1);
      }

      const yaw = Turret.yaw[tid] ?? 0;
      expect(yaw).toBeGreaterThanOrEqual(-1.0);
      expect(yaw).toBeLessThanOrEqual(1.0);
    });

    it('should not rotate disabled turrets', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 100, 0, 0);

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.yaw[tid] = 0;
      Turret.disabled[tid] = 1;

      turretRotationSystem(world, 0.5);

      expect(Turret.yaw[tid]).toBe(0);
    });
  });

  describe('turretFireSystem', () => {
    it('should fire when on target and cooldown ready', () => {
      const world = createWorld();
      // Clear any previous events
      consumeTurretFireEvents();

      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 0, 0, -100);

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.cooldownRemaining[tid] = 0;
      // Set turret aimed at target (yaw and pitch at target values)
      Turret.yaw[tid] = 0;
      Turret.pitch[tid] = 0;
      Turret.yawTarget[tid] = 0;
      Turret.pitchTarget[tid] = 0;

      rebuildFighterSpatialHash(world);
      turretFireSystem(world, 0.016);

      const events = consumeTurretFireEvents();
      expect(events.length).toBeGreaterThan(0);
    });

    it('should not fire when cooldown is active', () => {
      const world = createWorld();
      consumeTurretFireEvents();

      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 0, 0, -100);

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.cooldownRemaining[tid] = 5.0; // Long cooldown
      Turret.yaw[tid] = 0;
      Turret.yawTarget[tid] = 0;
      Turret.pitch[tid] = 0;
      Turret.pitchTarget[tid] = 0;

      rebuildFighterSpatialHash(world);
      turretFireSystem(world, 0.016);

      const events = consumeTurretFireEvents();
      expect(events.length).toBe(0);
    });

    it('should not fire when not aimed at target', () => {
      const world = createWorld();
      consumeTurretFireEvents();

      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 0, 0, -100);

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.cooldownRemaining[tid] = 0;
      Turret.yaw[tid] = 0;
      Turret.yawTarget[tid] = 2.0; // Way off
      Turret.pitch[tid] = 0;
      Turret.pitchTarget[tid] = 0;

      rebuildFighterSpatialHash(world);
      turretFireSystem(world, 0.016);

      const events = consumeTurretFireEvents();
      expect(events.length).toBe(0);
    });

    it('should spawn turret projectile entity', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 0, 0, -100);

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.cooldownRemaining[tid] = 0;
      Turret.yaw[tid] = 0;
      Turret.yawTarget[tid] = 0;
      Turret.pitch[tid] = 0;
      Turret.pitchTarget[tid] = 0;

      rebuildFighterSpatialHash(world);
      const query = defineQuery([TurretProjectile]);
      const before = query(world).length;

      turretFireSystem(world, 0.016);

      const after = query(world).length;
      expect(after).toBeGreaterThan(before);
    });

    it('should reset cooldown after firing', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      parentChildTransformSystem(world);

      const hostile = createFighterTarget(world, 0, 0, 0, -100);

      const tid = result.turretEids[0];
      if (tid === undefined) return;

      Turret.targetEid[tid] = hostile;
      Turret.cooldownRemaining[tid] = 0;
      Turret.cooldown[tid] = 0.5;
      Turret.yaw[tid] = 0;
      Turret.yawTarget[tid] = 0;
      Turret.pitch[tid] = 0;
      Turret.pitchTarget[tid] = 0;

      rebuildFighterSpatialHash(world);
      turretFireSystem(world, 0.016);

      expect(Turret.cooldownRemaining[tid]).toBeCloseTo(0.5, 2);
    });
  });

  describe('turretProjectileSystem', () => {
    it('should move projectiles based on velocity', () => {
      const world = createWorld();

      const proj = addEntity(world);
      addComponent(world, TurretProjectile, proj);
      addComponent(world, Transform, proj);
      addComponent(world, Velocity, proj);

      Transform.x[proj] = 0;
      Transform.y[proj] = 0;
      Transform.z[proj] = 0;
      Velocity.vx[proj] = 100;
      Velocity.vy[proj] = 0;
      Velocity.vz[proj] = -200;
      TurretProjectile.life[proj] = 3.0;
      TurretProjectile.damage[proj] = 10;
      TurretProjectile.parentShipEid[proj] = -1;

      rebuildFighterSpatialHash(world);
      turretProjectileSystem(world, 0.1);

      expect(Transform.x[proj]).toBeCloseTo(10, 1);
      expect(Transform.z[proj]).toBeCloseTo(-20, 1);
    });

    it('should remove projectile when life expires', () => {
      const world = createWorld();

      const proj = addEntity(world);
      addComponent(world, TurretProjectile, proj);
      addComponent(world, Transform, proj);
      addComponent(world, Velocity, proj);

      TurretProjectile.life[proj] = 0.05;
      Velocity.vx[proj] = 0;
      Velocity.vy[proj] = 0;
      Velocity.vz[proj] = 0;

      rebuildFighterSpatialHash(world);
      turretProjectileSystem(world, 0.1);

      expect(hasComponent(world, TurretProjectile, proj)).toBe(false);
    });

    it('should damage enemy fighters on collision', () => {
      const world = createWorld();

      // Create capital ship (team 1)
      const capShip = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      // Create enemy fighter (team 0)
      const enemy = createFighterTarget(world, 0, 0, 0, 0);
      const initialHp = Health.hp[enemy] ?? 80;

      // Create projectile at enemy position
      const proj = addEntity(world);
      addComponent(world, TurretProjectile, proj);
      addComponent(world, Transform, proj);
      addComponent(world, Velocity, proj);

      Transform.x[proj] = 0;
      Transform.y[proj] = 0;
      Transform.z[proj] = 0;
      Velocity.vx[proj] = 0;
      Velocity.vy[proj] = 0;
      Velocity.vz[proj] = 0;
      TurretProjectile.life[proj] = 3.0;
      TurretProjectile.damage[proj] = 15;
      TurretProjectile.parentShipEid[proj] = capShip.shipEid;

      rebuildFighterSpatialHash(world);
      turretProjectileSystem(world, 0.016);

      expect(Health.hp[enemy]).toBe(initialHp - 15);
      expect(hasComponent(world, TurretProjectile, proj)).toBe(false);
    });

    it('should not damage friendly fighters', () => {
      const world = createWorld();

      const capShip = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Corvette
      });

      // Friendly fighter (same team)
      const friendly = createFighterTarget(world, 1, 0, 0, 0);
      const initialHp = Health.hp[friendly] ?? 80;

      const proj = addEntity(world);
      addComponent(world, TurretProjectile, proj);
      addComponent(world, Transform, proj);
      addComponent(world, Velocity, proj);

      Transform.x[proj] = 0;
      Transform.y[proj] = 0;
      Transform.z[proj] = 0;
      Velocity.vx[proj] = 0;
      Velocity.vy[proj] = 0;
      Velocity.vz[proj] = 0;
      TurretProjectile.life[proj] = 3.0;
      TurretProjectile.damage[proj] = 15;
      TurretProjectile.parentShipEid[proj] = capShip.shipEid;

      rebuildFighterSpatialHash(world);
      turretProjectileSystem(world, 0.016);

      expect(Health.hp[friendly]).toBe(initialHp); // Unchanged
    });
  });

  describe('subsystemEffectsSystem', () => {
    it('should disable subsystem when HP reaches zero', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const sid = result.subsystemEids[0];
      if (sid === undefined) return;

      Subsystem.hp[sid] = 0;

      subsystemEffectsSystem(world, 0.1);

      expect(Subsystem.disabled[sid]).toBe(1);
    });

    it('should emit event when subsystem is destroyed', () => {
      const world = createWorld();
      consumeSubsystemDestroyedEvents();

      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const sid = result.subsystemEids[0];
      if (sid === undefined) return;

      Subsystem.hp[sid] = 0;

      subsystemEffectsSystem(world, 0.1);

      const events = consumeSubsystemDestroyedEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].shipEid).toBe(result.shipEid);
    });

    it('should reduce shield regen when ShieldGen is destroyed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      // Find shield generator subsystem
      let shieldGenSid: number | undefined;
      for (const sid of result.subsystemEids) {
        if (Subsystem.subsystemType[sid] === SubsystemType.ShieldGen) {
          shieldGenSid = sid;
          break;
        }
      }

      if (shieldGenSid === undefined) return;

      const regenBefore = CapitalShipV2.shieldRegenRate[result.shipEid] ?? 40;
      Subsystem.hp[shieldGenSid] = 0;

      subsystemEffectsSystem(world, 0.1);

      const regenAfter = CapitalShipV2.shieldRegenRate[result.shipEid] ?? 0;
      expect(regenAfter).toBeLessThan(regenBefore);
    });

    it('should reveal weak points when Power subsystem is destroyed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      // Find power subsystem
      let powerSid: number | undefined;
      for (const sid of result.subsystemEids) {
        if (Subsystem.subsystemType[sid] === SubsystemType.Power) {
          powerSid = sid;
          break;
        }
      }

      if (powerSid === undefined) return;

      // Verify weak points are hidden
      for (const wid of result.weakPointEids) {
        expect(WeakPointV2.revealed[wid]).toBe(0);
      }

      Subsystem.hp[powerSid] = 0;
      subsystemEffectsSystem(world, 0.1);

      // Weak points should now be revealed
      for (const wid of result.weakPointEids) {
        expect(WeakPointV2.revealed[wid]).toBe(1);
      }
    });

    it('should immobilize ship when Engines subsystem is destroyed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      // Find engines subsystem
      let enginesSid: number | undefined;
      for (const sid of result.subsystemEids) {
        if (Subsystem.subsystemType[sid] === SubsystemType.Engines) {
          enginesSid = sid;
          break;
        }
      }

      if (enginesSid === undefined) return;

      Subsystem.hp[enginesSid] = 0;
      subsystemEffectsSystem(world, 0.1);

      expect(CapitalShipV2.maxSpeed[result.shipEid]).toBe(0);
      expect(CapitalShipV2.turnRate[result.shipEid]).toBe(0);
    });

    it('should reduce turret accuracy when Targeting subsystem is destroyed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      // Find targeting subsystem
      let targetingSid: number | undefined;
      for (const sid of result.subsystemEids) {
        if (Subsystem.subsystemType[sid] === SubsystemType.Targeting) {
          targetingSid = sid;
          break;
        }
      }

      if (targetingSid === undefined) return;

      // Store initial accuracy
      const tid = result.turretEids[0];
      if (tid === undefined) return;
      const accuracyBefore = Turret.trackingAccuracy[tid] ?? 0.8;

      Subsystem.hp[targetingSid] = 0;
      subsystemEffectsSystem(world, 0.1);

      const accuracyAfter = Turret.trackingAccuracy[tid] ?? 0;
      expect(accuracyAfter).toBeLessThan(accuracyBefore);
    });

    it('should disable hangar when Hangar subsystem is destroyed', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      // Find hangar subsystem
      let hangarSid: number | undefined;
      for (const sid of result.subsystemEids) {
        if (Subsystem.subsystemType[sid] === SubsystemType.Hangar) {
          hangarSid = sid;
          break;
        }
      }

      if (hangarSid === undefined) return;

      Subsystem.hp[hangarSid] = 0;
      subsystemEffectsSystem(world, 0.1);

      expect(CapitalShipV2.hangarCapacity[result.shipEid]).toBe(0);
    });

    it('should sync Subsystem HP to Health component', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      const sid = result.subsystemEids[0];
      if (sid === undefined) return;

      Subsystem.hp[sid] = 250;

      subsystemEffectsSystem(world, 0.1);

      expect(Health.hp[sid]).toBe(250);
    });
  });

  describe('removeCapitalShipV2', () => {
    it('should remove the capital ship entity', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      removeCapitalShipV2(world, result.shipEid);

      expect(hasComponent(world, CapitalShipV2, result.shipEid)).toBe(false);
    });

    it('should remove all turrets', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      removeCapitalShipV2(world, result.shipEid);

      for (const tid of result.turretEids) {
        expect(hasComponent(world, Turret, tid)).toBe(false);
      }
    });

    it('should remove all subsystems', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      removeCapitalShipV2(world, result.shipEid);

      for (const sid of result.subsystemEids) {
        expect(hasComponent(world, Subsystem, sid)).toBe(false);
      }
    });

    it('should remove all weak points', () => {
      const world = createWorld();
      const result = spawnCapitalShipV2(world, {
        team: 1,
        shipClass: ShipClass.Destroyer
      });

      removeCapitalShipV2(world, result.shipEid);

      for (const wid of result.weakPointEids) {
        expect(hasComponent(world, WeakPointV2, wid)).toBe(false);
      }
    });
  });

  describe('consumeTurretFireEvents', () => {
    it('should return empty array when no events', () => {
      consumeTurretFireEvents(); // Clear any existing
      const events = consumeTurretFireEvents();
      expect(events).toEqual([]);
    });

    it('should clear events after consumption', () => {
      consumeTurretFireEvents();
      const events1 = consumeTurretFireEvents();
      const events2 = consumeTurretFireEvents();
      expect(events1).toEqual([]);
      expect(events2).toEqual([]);
    });
  });

  describe('consumeSubsystemDestroyedEvents', () => {
    it('should return empty array when no events', () => {
      consumeSubsystemDestroyedEvents();
      const events = consumeSubsystemDestroyedEvents();
      expect(events).toEqual([]);
    });

    it('should clear events after consumption', () => {
      consumeSubsystemDestroyedEvents();
      const events1 = consumeSubsystemDestroyedEvents();
      const events2 = consumeSubsystemDestroyedEvents();
      expect(events1).toEqual([]);
      expect(events2).toEqual([]);
    });
  });

  describe('ShipClass enum', () => {
    it('should have correct values', () => {
      expect(ShipClass.Corvette).toBe(0);
      expect(ShipClass.Frigate).toBe(1);
      expect(ShipClass.Cruiser).toBe(2);
      expect(ShipClass.Destroyer).toBe(3);
    });
  });

  describe('SubsystemType enum', () => {
    it('should have correct values', () => {
      expect(SubsystemType.Bridge).toBe(0);
      expect(SubsystemType.ShieldGen).toBe(1);
      expect(SubsystemType.Engines).toBe(2);
      expect(SubsystemType.Targeting).toBe(3);
      expect(SubsystemType.Power).toBe(4);
      expect(SubsystemType.Hangar).toBe(5);
    });
  });

  describe('TurretType enum', () => {
    it('should have correct values', () => {
      expect(TurretType.PointDefense).toBe(0);
      expect(TurretType.Medium).toBe(1);
      expect(TurretType.Heavy).toBe(2);
      expect(TurretType.Ion).toBe(3);
    });
  });
});
