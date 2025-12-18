/**
 * Unit tests for Space Combat Systems
 * Target coverage: 75% (~30 tests)
 *
 * Tests ship movement, targeting, weapons, projectiles, AI, and torpedo systems.
 */

import { createWorld, addEntity, addComponent, hasComponent, removeEntity, defineQuery } from 'bitecs';
import {
  Transform,
  Velocity,
  AngularVelocity,
  Team,
  Ship,
  LaserWeapon,
  Projectile,
  Health,
  HitRadius,
  Shield,
  Targeting,
  Targetable,
  PlayerControlled,
  AIControlled,
  FighterBrain,
  TorpedoLauncher,
  TorpedoProjectile,
  WeaponLoadout
} from '../../../packages/gameplay/src/space/components';

import {
  spawnPlayerShip,
  spaceflightSystem,
  weaponSystem,
  aiWeaponSystem,
  projectileSystem,
  targetingSystem,
  dogfightAISystem,
  shieldRegenSystem,
  computeInterceptTime,
  consumeImpactEvents,
  rebuildTargetSpatialHash,
  getProjectiles,
  getTargetables,
  getPlayerShip,
  AIState,
  torpedoLockSystem,
  torpedoFireSystem,
  torpedoProjectileSystem,
  weaponSwitchSystem,
  getTorpedoState,
  getTorpedoProjectiles
} from '../../../packages/gameplay/src/space/systems';

import type { SpaceInputState } from '../../../packages/gameplay/src/space/input';

// Default neutral input state
function createNeutralInput(): SpaceInputState {
  return {
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttleDelta: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
    brake: false,
    cycleTarget: false,
    switchWeapon: false,
    hyperspace: false,
    toggleMap: false,
    land: false
  };
}

// Helper to create an AI fighter
function createAIFighter(world: ReturnType<typeof createWorld>, teamId: number, x = 0, y = 0, z = 0): number {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, AngularVelocity, eid);
  addComponent(world, Team, eid);
  addComponent(world, Ship, eid);
  addComponent(world, LaserWeapon, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, Shield, eid);
  addComponent(world, AIControlled, eid);
  addComponent(world, FighterBrain, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
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

  Team.id[eid] = teamId;

  Ship.throttle[eid] = 0.7;
  Ship.maxSpeed[eid] = 200;
  Ship.accel[eid] = 100;
  Ship.turnRate[eid] = 1.2;

  LaserWeapon.cooldown[eid] = 0.14;
  LaserWeapon.cooldownRemaining[eid] = 0;
  LaserWeapon.projectileSpeed[eid] = 900;
  LaserWeapon.damage[eid] = 10;

  Health.hp[eid] = 80;
  Health.maxHp[eid] = 80;
  HitRadius.r[eid] = 8;

  Shield.sp[eid] = 30;
  Shield.maxSp[eid] = 30;
  Shield.regenRate[eid] = 5;
  Shield.lastHit[eid] = 999;

  FighterBrain.state[eid] = AIState.Acquire;
  FighterBrain.stateTime[eid] = 0;
  FighterBrain.aggression[eid] = 0.6;
  FighterBrain.evadeBias[eid] = 0.5;
  FighterBrain.targetEid[eid] = -1;

  return eid;
}

// Helper to create a targetable entity
function createTargetable(world: ReturnType<typeof createWorld>, teamId: number, x = 0, y = 0, z = 0): number {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Team, eid);
  addComponent(world, Targetable, eid);
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
  Health.hp[eid] = 50;
  Health.maxHp[eid] = 50;
  HitRadius.r[eid] = 10;

  return eid;
}

// Helper to spawn a projectile
function createProjectile(world: ReturnType<typeof createWorld>, owner: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): number {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Projectile, eid);

  Transform.x[eid] = x;
  Transform.y[eid] = y;
  Transform.z[eid] = z;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = vx;
  Velocity.vy[eid] = vy;
  Velocity.vz[eid] = vz;

  Projectile.life[eid] = 2.0;
  Projectile.owner[eid] = owner;
  Projectile.damage[eid] = 10;

  return eid;
}

describe('Space Combat Systems', () => {
  describe('spawnPlayerShip', () => {
    it('should create a player ship with default values', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);

      expect(hasComponent(world, Transform, eid)).toBe(true);
      expect(hasComponent(world, Velocity, eid)).toBe(true);
      expect(hasComponent(world, Ship, eid)).toBe(true);
      expect(hasComponent(world, PlayerControlled, eid)).toBe(true);
      expect(hasComponent(world, LaserWeapon, eid)).toBe(true);
      expect(hasComponent(world, TorpedoLauncher, eid)).toBe(true);
      expect(hasComponent(world, Targeting, eid)).toBe(true);
      expect(hasComponent(world, Health, eid)).toBe(true);
      expect(hasComponent(world, Shield, eid)).toBe(true);

      expect(Transform.x[eid]).toBe(0);
      expect(Transform.y[eid]).toBe(0);
      expect(Transform.z[eid]).toBe(0);
      expect(Ship.maxSpeed[eid]).toBe(250);
      expect(Ship.accel[eid]).toBe(120);
      expect(Health.hp[eid]).toBe(360); // 3x base for turret survivability
      expect(TorpedoLauncher.ammo[eid]).toBe(6);
    });

    it('should create a player ship with custom parameters', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world, { maxSpeed: 300, accel: 150, turnRate: 2.0, torpedoAmmo: 10 });

      expect(Ship.maxSpeed[eid]).toBe(300);
      expect(Ship.accel[eid]).toBe(150);
      expect(Ship.turnRate[eid]).toBe(2.0);
      expect(TorpedoLauncher.ammo[eid]).toBe(10);
      expect(TorpedoLauncher.maxAmmo[eid]).toBe(10);
    });

    it('should initialize targeting to no target', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);

      expect(Targeting.targetEid[eid]).toBe(-1);
    });
  });

  describe('spaceflightSystem', () => {
    it('should update ship position based on velocity', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);

      // Set forward direction velocity (along -Z)
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = -100;
      Ship.throttle[eid] = 0.5; // Maintain some speed

      const input = createNeutralInput();
      const initialZ = Transform.z[eid];

      spaceflightSystem(world, input, 0.1);

      // Ship should have moved forward (negative Z direction)
      expect(Transform.z[eid]).toBeLessThan(initialZ ?? 0);
    });

    it('should apply throttle to player ship', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      Ship.throttle[eid] = 0.5;

      const input = createNeutralInput();
      input.throttleDelta = 1; // Increase throttle

      spaceflightSystem(world, input, 0.5);

      expect(Ship.throttle[eid]).toBeGreaterThan(0.5);
      expect(Ship.throttle[eid]).toBeLessThanOrEqual(1.0);
    });

    it('should clamp throttle between 0 and 1', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      Ship.throttle[eid] = 0.95;

      const input = createNeutralInput();
      input.throttleDelta = 1;

      // Run multiple frames to try to exceed 1.0
      for (let i = 0; i < 10; i++) {
        spaceflightSystem(world, input, 0.1);
      }

      expect(Ship.throttle[eid]).toBeLessThanOrEqual(1.0);
    });

    it('should apply angular velocity from input', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);

      const input = createNeutralInput();
      input.pitch = 1.0;
      input.yaw = 0.5;
      input.roll = -0.3;

      spaceflightSystem(world, input, 0.016);

      const turnRate = Ship.turnRate[eid] ?? 1.2;
      expect(AngularVelocity.wx[eid]).toBeCloseTo(1.0 * turnRate, 5);
      expect(AngularVelocity.wy[eid]).toBeCloseTo(0.5 * turnRate, 5);
      expect(AngularVelocity.wz[eid]).toBeCloseTo(-0.3 * turnRate, 5);
    });

    it('should apply boost multiplier to max speed', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      Ship.throttle[eid] = 1.0;

      // Run without boost
      const inputNoBoost = createNeutralInput();
      for (let i = 0; i < 50; i++) {
        spaceflightSystem(world, inputNoBoost, 0.1);
      }
      const speedNoBoost = Math.sqrt(
        Velocity.vx[eid] ** 2 + Velocity.vy[eid] ** 2 + Velocity.vz[eid] ** 2
      );

      // Reset
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = 0;

      // Run with boost
      const inputBoost = createNeutralInput();
      inputBoost.boost = true;
      for (let i = 0; i < 50; i++) {
        spaceflightSystem(world, inputBoost, 0.1);
      }
      const speedBoost = Math.sqrt(
        Velocity.vx[eid] ** 2 + Velocity.vy[eid] ** 2 + Velocity.vz[eid] ** 2
      );

      expect(speedBoost).toBeGreaterThan(speedNoBoost);
    });

    it('should apply brake to decelerate', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);

      // Set initial velocity
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      Velocity.vz[eid] = -200;
      Ship.throttle[eid] = 0.8;

      const input = createNeutralInput();
      input.brake = true;

      for (let i = 0; i < 30; i++) {
        spaceflightSystem(world, input, 0.1);
      }

      const speed = Math.sqrt(
        Velocity.vx[eid] ** 2 + Velocity.vy[eid] ** 2 + Velocity.vz[eid] ** 2
      );
      expect(speed).toBeLessThan(200);
    });
  });

  describe('weaponSystem', () => {
    it('should fire projectiles when fire input is pressed and cooldown is ready', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      LaserWeapon.cooldownRemaining[eid] = 0;

      const input = createNeutralInput();
      input.firePrimary = true;

      rebuildTargetSpatialHash(world);
      weaponSystem(world, input, 0.016);

      const projectiles = getProjectiles(world);
      expect(projectiles.length).toBeGreaterThan(0);
    });

    it('should not fire when cooldown is active', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      LaserWeapon.cooldownRemaining[eid] = 1.0;

      const input = createNeutralInput();
      input.firePrimary = true;

      rebuildTargetSpatialHash(world);
      const projectilesBefore = getProjectiles(world).length;
      weaponSystem(world, input, 0.016);
      const projectilesAfter = getProjectiles(world).length;

      expect(projectilesAfter).toBe(projectilesBefore);
    });

    it('should decrease cooldown over time', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      LaserWeapon.cooldownRemaining[eid] = 0.5;

      const input = createNeutralInput();
      weaponSystem(world, input, 0.1);

      expect(LaserWeapon.cooldownRemaining[eid]).toBeCloseTo(0.4, 5);
    });

    it('should reset cooldown after firing', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      LaserWeapon.cooldownRemaining[eid] = 0;
      const cooldown = LaserWeapon.cooldown[eid] ?? 0.12;

      const input = createNeutralInput();
      input.firePrimary = true;

      rebuildTargetSpatialHash(world);
      weaponSystem(world, input, 0.016);

      expect(LaserWeapon.cooldownRemaining[eid]).toBeCloseTo(cooldown, 5);
    });
  });

  describe('aiWeaponSystem', () => {
    it('should fire when AI has valid hostile target in range and cone', () => {
      const world = createWorld();

      const ai = createAIFighter(world, 1, 0, 0, 0);
      const target = createTargetable(world, 0, 0, 0, -100); // In front (negative Z)
      addComponent(world, Velocity, target);
      Velocity.vx[target] = 0;
      Velocity.vy[target] = 0;
      Velocity.vz[target] = 0;

      FighterBrain.targetEid[ai] = target;
      LaserWeapon.cooldownRemaining[ai] = 0;

      rebuildTargetSpatialHash(world);
      aiWeaponSystem(world, 0.016);

      const projectiles = getProjectiles(world);
      expect(projectiles.length).toBeGreaterThan(0);
    });

    it('should not fire when target is out of range', () => {
      const world = createWorld();

      const ai = createAIFighter(world, 1, 0, 0, 0);
      const target = createTargetable(world, 0, 0, 0, -2000); // Too far
      addComponent(world, Velocity, target);

      FighterBrain.targetEid[ai] = target;
      LaserWeapon.cooldownRemaining[ai] = 0;

      rebuildTargetSpatialHash(world);
      aiWeaponSystem(world, 0.016);

      const projectiles = getProjectiles(world);
      expect(projectiles.length).toBe(0);
    });

    it('should not fire at friendly targets', () => {
      const world = createWorld();

      const ai = createAIFighter(world, 1, 0, 0, 0);
      const friendlyTarget = createTargetable(world, 1, 0, 0, -100); // Same team
      addComponent(world, Velocity, friendlyTarget);

      FighterBrain.targetEid[ai] = friendlyTarget;
      LaserWeapon.cooldownRemaining[ai] = 0;

      rebuildTargetSpatialHash(world);
      aiWeaponSystem(world, 0.016);

      const projectiles = getProjectiles(world);
      expect(projectiles.length).toBe(0);
    });

    it('should not fire when target is behind', () => {
      const world = createWorld();

      const ai = createAIFighter(world, 1, 0, 0, 0);
      const target = createTargetable(world, 0, 0, 0, 100); // Behind (positive Z)
      addComponent(world, Velocity, target);

      FighterBrain.targetEid[ai] = target;
      LaserWeapon.cooldownRemaining[ai] = 0;

      rebuildTargetSpatialHash(world);
      aiWeaponSystem(world, 0.016);

      const projectiles = getProjectiles(world);
      expect(projectiles.length).toBe(0);
    });
  });

  describe('projectileSystem', () => {
    it('should move projectiles based on velocity', () => {
      const world = createWorld();
      const proj = createProjectile(world, -1, 0, 0, 0, 100, 0, -200);

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.1);

      expect(Transform.x[proj]).toBeCloseTo(10, 1);
      expect(Transform.z[proj]).toBeCloseTo(-20, 1);
    });

    it('should remove projectiles when life expires', () => {
      const world = createWorld();
      const proj = createProjectile(world, -1, 0, 0, 0, 0, 0, 0);
      Projectile.life[proj] = 0.05;

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.1);

      expect(hasComponent(world, Projectile, proj)).toBe(false);
    });

    it('should damage targets on collision', () => {
      const world = createWorld();
      const shooter = spawnPlayerShip(world);
      Team.id[shooter] = 0;

      const target = createTargetable(world, 1, 0, 0, 0);
      Shield.sp[target] = 0;
      Shield.maxSp[target] = 0;
      const initialHp = Health.hp[target] ?? 50;

      // Projectile right on top of target
      const proj = createProjectile(world, shooter, 0, 0, 0, 0, 0, 0);
      Projectile.damage[proj] = 15;

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.016);

      expect(Health.hp[target]).toBe(initialHp - 15);
      expect(hasComponent(world, Projectile, proj)).toBe(false);
    });

    it('should damage shields before health', () => {
      const world = createWorld();
      const shooter = spawnPlayerShip(world);
      Team.id[shooter] = 0;

      const target = createTargetable(world, 1, 0, 0, 0);
      addComponent(world, Shield, target);
      Shield.sp[target] = 20;
      Shield.maxSp[target] = 50;
      const initialHp = Health.hp[target] ?? 50;

      const proj = createProjectile(world, shooter, 0, 0, 0, 0, 0, 0);
      Projectile.damage[proj] = 15;

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.016);

      expect(Shield.sp[target]).toBe(5); // 20 - 15 = 5
      expect(Health.hp[target]).toBe(initialHp); // HP unchanged
    });

    it('should kill and remove target when health reaches zero', () => {
      const world = createWorld();
      const shooter = spawnPlayerShip(world);
      Team.id[shooter] = 0;

      const target = createTargetable(world, 1, 0, 0, 0);
      Health.hp[target] = 10;

      const proj = createProjectile(world, shooter, 0, 0, 0, 0, 0, 0);
      Projectile.damage[proj] = 15;

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.016);

      expect(hasComponent(world, Health, target)).toBe(false);
    });

    it('should emit impact events on collision', () => {
      const world = createWorld();
      // Clear any previous events
      consumeImpactEvents();

      const shooter = spawnPlayerShip(world);
      Team.id[shooter] = 0;

      const target = createTargetable(world, 1, 10, 0, 0);
      Health.hp[target] = 100;

      const proj = createProjectile(world, shooter, 10, 0, 0, 0, 0, 0);

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.016);

      const events = consumeImpactEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].team).toBe(0);
    });

    it('should not hit entities on the same team', () => {
      const world = createWorld();
      const shooter = spawnPlayerShip(world);
      Team.id[shooter] = 0;

      const friendlyTarget = createTargetable(world, 0, 0, 0, 0); // Same team
      const initialHp = Health.hp[friendlyTarget] ?? 50;

      const proj = createProjectile(world, shooter, 0, 0, 0, 0, 0, 0);

      rebuildTargetSpatialHash(world);
      projectileSystem(world, 0.016);

      expect(Health.hp[friendlyTarget]).toBe(initialHp);
    });
  });

  describe('targetingSystem', () => {
    it('should auto-acquire nearest hostile target', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      const hostile = createTargetable(world, 1, 0, 0, -100);

      const input = createNeutralInput();
      targetingSystem(world, input);

      expect(Targeting.targetEid[player]).toBe(hostile);
    });

    it('should not target friendly entities', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      createTargetable(world, 0, 0, 0, -100); // Friendly

      const input = createNeutralInput();
      targetingSystem(world, input);

      expect(Targeting.targetEid[player]).toBe(-1);
    });

    it('should cycle targets when cycleTarget input is pressed', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      const hostile1 = createTargetable(world, 1, 0, 0, -100);
      const hostile2 = createTargetable(world, 1, 50, 0, -150);

      const input = createNeutralInput();

      // Auto-acquire first target
      targetingSystem(world, input);
      const firstTarget = Targeting.targetEid[player];

      // Cycle to next
      input.cycleTarget = true;
      targetingSystem(world, input);
      const secondTarget = Targeting.targetEid[player];

      expect(firstTarget).not.toBe(secondTarget);
      expect([hostile1, hostile2]).toContain(secondTarget);
    });

    it('should handle no targets gracefully', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      const input = createNeutralInput();
      expect(() => targetingSystem(world, input)).not.toThrow();
      expect(Targeting.targetEid[player]).toBe(-1);
    });
  });

  describe('dogfightAISystem', () => {
    it('should acquire a target when none is set', () => {
      const world = createWorld();
      const ai = createAIFighter(world, 1, 0, 0, 0);
      const hostile = createTargetable(world, 0, 0, 0, -500);
      addComponent(world, Velocity, hostile);

      dogfightAISystem(world, 0.1);

      expect(FighterBrain.targetEid[ai]).toBe(hostile);
    });

    it('should transition from Acquire to at least Pursue state', () => {
      const world = createWorld();
      const ai = createAIFighter(world, 1, 0, 0, 0);
      FighterBrain.state[ai] = AIState.Acquire;

      // Place hostile far enough to not immediately attack
      const hostile = createTargetable(world, 0, 0, 0, -1500);
      addComponent(world, Velocity, hostile);

      dogfightAISystem(world, 0.1);

      // Should have transitioned out of Acquire
      expect(FighterBrain.state[ai]).toBeGreaterThanOrEqual(AIState.Pursue);
    });

    it('should transition to Attack state when close to target', () => {
      const world = createWorld();
      const ai = createAIFighter(world, 1, 0, 0, 0);
      FighterBrain.state[ai] = AIState.Pursue;
      FighterBrain.aggression[ai] = 0.6;

      const hostile = createTargetable(world, 0, 0, 0, -300); // Close
      addComponent(world, Velocity, hostile);
      FighterBrain.targetEid[ai] = hostile;

      dogfightAISystem(world, 0.1);

      expect(FighterBrain.state[ai]).toBe(AIState.Attack);
    });

    it('should transition to BreakOff when too close', () => {
      const world = createWorld();
      const ai = createAIFighter(world, 1, 0, 0, 0);
      FighterBrain.state[ai] = AIState.Attack;
      FighterBrain.aggression[ai] = 0.6;

      const hostile = createTargetable(world, 0, 0, 0, -100); // Very close
      addComponent(world, Velocity, hostile);
      FighterBrain.targetEid[ai] = hostile;

      dogfightAISystem(world, 0.1);

      expect(FighterBrain.state[ai]).toBe(AIState.BreakOff);
    });

    it('should set angular velocity based on target direction', () => {
      const world = createWorld();
      const ai = createAIFighter(world, 1, 0, 0, 0);

      // Target to the right
      const hostile = createTargetable(world, 0, 100, 0, -200);
      addComponent(world, Velocity, hostile);
      FighterBrain.targetEid[ai] = hostile;
      FighterBrain.state[ai] = AIState.Attack;

      dogfightAISystem(world, 0.1);

      // Should have some angular velocity to turn towards target
      const totalAngVel = Math.abs(AngularVelocity.wx[ai]) + Math.abs(AngularVelocity.wy[ai]);
      expect(totalAngVel).toBeGreaterThan(0);
    });

    it('should pick nearest hostile as target', () => {
      const world = createWorld();
      const ai = createAIFighter(world, 1, 0, 0, 0);

      const farHostile = createTargetable(world, 0, 0, 0, -1000);
      addComponent(world, Velocity, farHostile);

      const nearHostile = createTargetable(world, 0, 0, 0, -200);
      addComponent(world, Velocity, nearHostile);

      dogfightAISystem(world, 0.1);

      expect(FighterBrain.targetEid[ai]).toBe(nearHostile);
    });
  });

  describe('shieldRegenSystem', () => {
    it('should not regenerate shields immediately after hit', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      Shield.sp[eid] = 30;
      Shield.maxSp[eid] = 60;
      Shield.regenRate[eid] = 10;
      Shield.lastHit[eid] = 0; // Just got hit

      shieldRegenSystem(world, 0.5);

      expect(Shield.sp[eid]).toBe(30); // No regen yet
    });

    it('should regenerate shields after delay', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      Shield.sp[eid] = 30;
      Shield.maxSp[eid] = 60;
      Shield.regenRate[eid] = 10;
      Shield.lastHit[eid] = 3; // 3 seconds since hit

      shieldRegenSystem(world, 1.0);

      expect(Shield.sp[eid]).toBeGreaterThan(30);
    });

    it('should not exceed max shield value', () => {
      const world = createWorld();
      const eid = spawnPlayerShip(world);
      Shield.sp[eid] = 58;
      Shield.maxSp[eid] = 60;
      Shield.regenRate[eid] = 100; // Fast regen
      Shield.lastHit[eid] = 10;

      shieldRegenSystem(world, 1.0);

      expect(Shield.sp[eid]).toBe(60);
    });
  });

  describe('computeInterceptTime', () => {
    it('should return null for zero projectile speed', () => {
      const result = computeInterceptTime(100, 0, 0, 10, 0, 0, 0);
      expect(result).toBeNull();
    });

    it('should calculate intercept time for stationary target', () => {
      const result = computeInterceptTime(100, 0, 0, 0, 0, 0, 500);
      expect(result).toBeCloseTo(0.2, 2); // 100 / 500 = 0.2
    });

    it('should calculate intercept time for moving target', () => {
      // Target moving away, projectile faster
      const result = computeInterceptTime(100, 0, 0, 50, 0, 0, 200);
      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(0);
    });

    it('should return null when projectile cannot catch target', () => {
      // Target moving away faster than projectile
      const result = computeInterceptTime(100, 0, 0, 1000, 0, 0, 100);
      expect(result).toBeNull();
    });
  });

  describe('torpedoLockSystem', () => {
    it('should build lock progress when target is in cone and range', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      const target = createTargetable(world, 1, 0, 0, -500);
      Targeting.targetEid[player] = target;

      const input = createNeutralInput();

      torpedoLockSystem(world, input, 0.5);

      expect(TorpedoLauncher.lockProgress[player]).toBeGreaterThan(0);
    });

    it('should track new target after target changes', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      const target1 = createTargetable(world, 1, 0, 0, -500);
      const target2 = createTargetable(world, 1, 0, 0, -500); // Also in front

      Targeting.targetEid[player] = target1;
      TorpedoLauncher.lockProgress[player] = 0.8;
      TorpedoLauncher.lockTargetEid[player] = target1;

      // Change target
      Targeting.targetEid[player] = target2;

      const input = createNeutralInput();
      torpedoLockSystem(world, input, 0.1);

      // Lock target should be updated
      expect(TorpedoLauncher.lockTargetEid[player]).toBe(target2);
    });

    it('should decay lock when target leaves cone', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      Team.id[player] = 0;

      // Target behind player
      const target = createTargetable(world, 1, 0, 0, 500);
      Targeting.targetEid[player] = target;
      TorpedoLauncher.lockProgress[player] = 0.5;
      TorpedoLauncher.lockTargetEid[player] = target;

      const input = createNeutralInput();
      torpedoLockSystem(world, input, 0.5);

      expect(TorpedoLauncher.lockProgress[player]).toBeLessThan(0.5);
    });
  });

  describe('torpedoFireSystem', () => {
    it('should fire torpedo when locked and ammo available', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);

      const target = createTargetable(world, 1, 0, 0, -500);
      Targeting.targetEid[player] = target;
      TorpedoLauncher.lockProgress[player] = 1.0;
      TorpedoLauncher.lockTargetEid[player] = target;
      TorpedoLauncher.ammo[player] = 6;
      TorpedoLauncher.cooldownRemaining[player] = 0;

      const input = createNeutralInput();
      input.fireSecondary = true;

      torpedoFireSystem(world, input, 0.016);

      expect(TorpedoLauncher.ammo[player]).toBe(5);
      const torpedoes = getTorpedoProjectiles(world);
      expect(torpedoes.length).toBe(1);
    });

    it('should not fire without full lock', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);

      const target = createTargetable(world, 1, 0, 0, -500);
      Targeting.targetEid[player] = target;
      TorpedoLauncher.lockProgress[player] = 0.5; // Not locked
      TorpedoLauncher.lockTargetEid[player] = target;
      TorpedoLauncher.ammo[player] = 6;
      TorpedoLauncher.cooldownRemaining[player] = 0;

      const input = createNeutralInput();
      input.fireSecondary = true;

      torpedoFireSystem(world, input, 0.016);

      expect(TorpedoLauncher.ammo[player]).toBe(6); // No ammo consumed
    });

    it('should not fire without ammo', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);

      const target = createTargetable(world, 1, 0, 0, -500);
      TorpedoLauncher.lockProgress[player] = 1.0;
      TorpedoLauncher.lockTargetEid[player] = target;
      TorpedoLauncher.ammo[player] = 0;
      TorpedoLauncher.cooldownRemaining[player] = 0;

      const input = createNeutralInput();
      input.fireSecondary = true;

      const torpedoesBefore = getTorpedoProjectiles(world).length;
      torpedoFireSystem(world, input, 0.016);
      const torpedoesAfter = getTorpedoProjectiles(world).length;

      expect(torpedoesAfter).toBe(torpedoesBefore);
    });
  });

  describe('torpedoProjectileSystem', () => {
    it('should track toward target', () => {
      const world = createWorld();

      // Create torpedo
      const torp = addEntity(world);
      addComponent(world, Transform, torp);
      addComponent(world, Velocity, torp);
      addComponent(world, TorpedoProjectile, torp);

      Transform.x[torp] = 0;
      Transform.y[torp] = 0;
      Transform.z[torp] = 0;
      Velocity.vx[torp] = 0;
      Velocity.vy[torp] = 0;
      Velocity.vz[torp] = -400;
      TorpedoProjectile.life[torp] = 8;
      TorpedoProjectile.owner[torp] = -1;
      TorpedoProjectile.targetEid[torp] = -1;
      TorpedoProjectile.trackingStrength[torp] = 0.85;
      TorpedoProjectile.damage[torp] = 150;

      // Create target to the side
      const target = createTargetable(world, 1, 100, 0, -200);
      TorpedoProjectile.targetEid[torp] = target;

      const initialVx = Velocity.vx[torp];

      rebuildTargetSpatialHash(world);
      torpedoProjectileSystem(world, 0.1);

      // Velocity should have turned toward target (positive X)
      expect(Velocity.vx[torp]).toBeGreaterThan(initialVx);
    });

    it('should remove torpedo when life expires', () => {
      const world = createWorld();

      const torp = addEntity(world);
      addComponent(world, Transform, torp);
      addComponent(world, Velocity, torp);
      addComponent(world, TorpedoProjectile, torp);

      TorpedoProjectile.life[torp] = 0.05;
      Velocity.vx[torp] = 0;
      Velocity.vy[torp] = 0;
      Velocity.vz[torp] = -100;

      rebuildTargetSpatialHash(world);
      torpedoProjectileSystem(world, 0.1);

      expect(hasComponent(world, TorpedoProjectile, torp)).toBe(false);
    });
  });

  describe('weaponSwitchSystem', () => {
    it('should toggle weapon from lasers to torpedoes', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      WeaponLoadout.activeWeapon[player] = 0;

      const input = createNeutralInput();
      input.switchWeapon = true;

      weaponSwitchSystem(world, input);

      expect(WeaponLoadout.activeWeapon[player]).toBe(1);
    });

    it('should toggle weapon from torpedoes to lasers', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      WeaponLoadout.activeWeapon[player] = 1;

      const input = createNeutralInput();
      input.switchWeapon = true;

      weaponSwitchSystem(world, input);

      expect(WeaponLoadout.activeWeapon[player]).toBe(0);
    });

    it('should not switch without input', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      WeaponLoadout.activeWeapon[player] = 0;

      const input = createNeutralInput();
      input.switchWeapon = false;

      weaponSwitchSystem(world, input);

      expect(WeaponLoadout.activeWeapon[player]).toBe(0);
    });
  });

  describe('getTorpedoState', () => {
    it('should return torpedo state for player ship', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);
      TorpedoLauncher.ammo[player] = 4;
      TorpedoLauncher.maxAmmo[player] = 6;
      TorpedoLauncher.lockProgress[player] = 0.75;
      WeaponLoadout.activeWeapon[player] = 1;

      const state = getTorpedoState(world);

      expect(state).not.toBeNull();
      expect(state?.ammo).toBe(4);
      expect(state?.maxAmmo).toBe(6);
      expect(state?.lockProgress).toBeCloseTo(0.75, 5);
      expect(state?.activeWeapon).toBe(1);
    });

    it('should return null when no player exists', () => {
      const world = createWorld();
      const state = getTorpedoState(world);
      expect(state).toBeNull();
    });
  });

  describe('getPlayerShip', () => {
    it('should return player ship entity', () => {
      const world = createWorld();
      const player = spawnPlayerShip(world);

      const result = getPlayerShip(world);
      expect(result).toBe(player);
    });

    it('should return null when no player exists', () => {
      const world = createWorld();
      const result = getPlayerShip(world);
      expect(result).toBeNull();
    });
  });

  describe('consumeImpactEvents', () => {
    it('should clear events after consumption', () => {
      consumeImpactEvents(); // Clear any existing

      const events1 = consumeImpactEvents();
      const events2 = consumeImpactEvents();

      expect(events1).toEqual([]);
      expect(events2).toEqual([]);
    });
  });

  describe('AIState enum', () => {
    it('should have correct state values', () => {
      expect(AIState.Acquire).toBe(0);
      expect(AIState.Pursue).toBe(1);
      expect(AIState.Attack).toBe(2);
      expect(AIState.BreakOff).toBe(3);
      expect(AIState.Evade).toBe(4);
    });
  });
});
