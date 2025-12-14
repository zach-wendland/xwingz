import { createWorld, addEntity, addComponent, hasComponent } from 'bitecs';
import {
  InGroundDomain,
  CharacterController,
  GroundInput,
  Soldier,
  Piloting,
  Enterable,
  BlasterWeapon,
  CommandPost,
  GroundAI
} from '../../../packages/gameplay/src/ground/components';

describe('Ground Components', () => {
  describe('InGroundDomain', () => {
    it('should be a tag component with no data fields', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, InGroundDomain, eid);
      expect(hasComponent(world, InGroundDomain, eid)).toBe(true);
    });

    it('should be removable', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, InGroundDomain, eid);
      expect(hasComponent(world, InGroundDomain, eid)).toBe(true);
    });
  });

  describe('CharacterController', () => {
    it('should store capsule dimensions', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, CharacterController, eid);

      CharacterController.capsuleHeight[eid] = 1.8;
      CharacterController.capsuleRadius[eid] = 0.35;
      CharacterController.stepHeight[eid] = 0.35;
      CharacterController.slopeLimit[eid] = Math.PI / 4;
      CharacterController.grounded[eid] = 1;
      CharacterController.rapierHandle[eid] = 42;

      expect(CharacterController.capsuleHeight[eid]).toBeCloseTo(1.8, 5);
      expect(CharacterController.capsuleRadius[eid]).toBeCloseTo(0.35, 5);
      expect(CharacterController.stepHeight[eid]).toBeCloseTo(0.35, 5);
      expect(CharacterController.slopeLimit[eid]).toBeCloseTo(Math.PI / 4, 5);
      expect(CharacterController.grounded[eid]).toBe(1);
      expect(CharacterController.rapierHandle[eid]).toBe(42);
    });

    it('should default grounded to 0 (false)', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, CharacterController, eid);
      expect(CharacterController.grounded[eid]).toBe(0);
    });
  });

  describe('GroundInput', () => {
    it('should store movement inputs', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, GroundInput, eid);

      GroundInput.moveX[eid] = -0.5;
      GroundInput.moveZ[eid] = 1.0;
      GroundInput.jump[eid] = 1;
      GroundInput.sprint[eid] = 1;
      GroundInput.crouch[eid] = 0;
      GroundInput.aimYaw[eid] = Math.PI / 2;
      GroundInput.aimPitch[eid] = -0.3;
      GroundInput.interact[eid] = 1;
      GroundInput.firePrimary[eid] = 1;

      expect(GroundInput.moveX[eid]).toBeCloseTo(-0.5, 5);
      expect(GroundInput.moveZ[eid]).toBeCloseTo(1.0, 5);
      expect(GroundInput.jump[eid]).toBe(1);
      expect(GroundInput.sprint[eid]).toBe(1);
      expect(GroundInput.crouch[eid]).toBe(0);
      expect(GroundInput.aimYaw[eid]).toBeCloseTo(Math.PI / 2, 5);
      expect(GroundInput.aimPitch[eid]).toBeCloseTo(-0.3, 5);
      expect(GroundInput.interact[eid]).toBe(1);
      expect(GroundInput.firePrimary[eid]).toBe(1);
    });
  });

  describe('Soldier', () => {
    it('should store class and movement stats', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, Soldier, eid);

      Soldier.classId[eid] = 1; // Heavy
      Soldier.walkSpeed[eid] = 3.5;
      Soldier.sprintSpeed[eid] = 5.5;
      Soldier.crouchSpeed[eid] = 1.5;
      Soldier.jumpImpulse[eid] = 4.0;
      Soldier.ammo[eid] = 300;
      Soldier.maxAmmo[eid] = 300;

      expect(Soldier.classId[eid]).toBe(1);
      expect(Soldier.walkSpeed[eid]).toBeCloseTo(3.5, 5);
      expect(Soldier.sprintSpeed[eid]).toBeCloseTo(5.5, 5);
      expect(Soldier.crouchSpeed[eid]).toBeCloseTo(1.5, 5);
      expect(Soldier.jumpImpulse[eid]).toBeCloseTo(4.0, 5);
      expect(Soldier.ammo[eid]).toBe(300);
      expect(Soldier.maxAmmo[eid]).toBe(300);
    });

    it('should support all three class types', () => {
      const world = createWorld();

      const assault = addEntity(world);
      const heavy = addEntity(world);
      const sniper = addEntity(world);

      addComponent(world, Soldier, assault);
      addComponent(world, Soldier, heavy);
      addComponent(world, Soldier, sniper);

      Soldier.classId[assault] = 0;
      Soldier.classId[heavy] = 1;
      Soldier.classId[sniper] = 2;

      expect(Soldier.classId[assault]).toBe(0);
      expect(Soldier.classId[heavy]).toBe(1);
      expect(Soldier.classId[sniper]).toBe(2);
    });
  });

  describe('Piloting', () => {
    it('should store vehicle entity reference', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, Piloting, eid);

      Piloting.vehicleEid[eid] = 42;
      expect(Piloting.vehicleEid[eid]).toBe(42);
    });

    it('should use -1 to indicate not piloting', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, Piloting, eid);

      Piloting.vehicleEid[eid] = -1;
      expect(Piloting.vehicleEid[eid]).toBe(-1);
    });
  });

  describe('Enterable', () => {
    it('should track seat capacity and occupancy', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, Enterable, eid);

      Enterable.seatCount[eid] = 2;
      Enterable.seatsFilled[eid] = 1;
      Enterable.enterRadius[eid] = 5.0;

      expect(Enterable.seatCount[eid]).toBe(2);
      expect(Enterable.seatsFilled[eid]).toBe(1);
      expect(Enterable.enterRadius[eid]).toBeCloseTo(5.0, 5);
    });

    it('should calculate available seats correctly', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, Enterable, eid);

      Enterable.seatCount[eid] = 4;
      Enterable.seatsFilled[eid] = 2;

      const available = Enterable.seatCount[eid] - Enterable.seatsFilled[eid];
      expect(available).toBe(2);
    });
  });

  describe('BlasterWeapon', () => {
    it('should store weapon stats', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, BlasterWeapon, eid);

      BlasterWeapon.damage[eid] = 25;
      BlasterWeapon.fireRate[eid] = 8;
      BlasterWeapon.cooldownRemaining[eid] = 0.1;
      BlasterWeapon.range[eid] = 150;
      BlasterWeapon.spread[eid] = 0.03;

      expect(BlasterWeapon.damage[eid]).toBeCloseTo(25, 5);
      expect(BlasterWeapon.fireRate[eid]).toBeCloseTo(8, 5);
      expect(BlasterWeapon.cooldownRemaining[eid]).toBeCloseTo(0.1, 5);
      expect(BlasterWeapon.range[eid]).toBeCloseTo(150, 5);
      expect(BlasterWeapon.spread[eid]).toBeCloseTo(0.03, 5);
    });

    it('should calculate cooldown from fire rate', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, BlasterWeapon, eid);

      const fireRate = 10; // 10 shots per second
      BlasterWeapon.fireRate[eid] = fireRate;

      const expectedCooldown = 1 / fireRate;
      expect(expectedCooldown).toBeCloseTo(0.1, 5);
    });
  });

  describe('CommandPost', () => {
    it('should track capture state', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, CommandPost, eid);

      CommandPost.ownerTeam[eid] = 0;
      CommandPost.captureProgress[eid] = 0.5;
      CommandPost.captureRadius[eid] = 10;
      CommandPost.captureRate[eid] = 0.1;
      CommandPost.contestingTeam[eid] = 1;

      expect(CommandPost.ownerTeam[eid]).toBe(0);
      expect(CommandPost.captureProgress[eid]).toBeCloseTo(0.5, 5);
      expect(CommandPost.captureRadius[eid]).toBeCloseTo(10, 5);
      expect(CommandPost.captureRate[eid]).toBeCloseTo(0.1, 5);
      expect(CommandPost.contestingTeam[eid]).toBe(1);
    });

    it('should support neutral ownership with -1', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, CommandPost, eid);

      CommandPost.ownerTeam[eid] = -1;
      expect(CommandPost.ownerTeam[eid]).toBe(-1);
    });
  });

  describe('GroundAI', () => {
    it('should store AI state and parameters', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, GroundAI, eid);

      GroundAI.state[eid] = 2; // Attack
      GroundAI.stateTime[eid] = 1.5;
      GroundAI.targetEid[eid] = 42;
      GroundAI.waypointX[eid] = 100;
      GroundAI.waypointY[eid] = 0;
      GroundAI.waypointZ[eid] = 50;
      GroundAI.aggression[eid] = 0.8;
      GroundAI.accuracy[eid] = 0.7;

      expect(GroundAI.state[eid]).toBe(2);
      expect(GroundAI.stateTime[eid]).toBeCloseTo(1.5, 5);
      expect(GroundAI.targetEid[eid]).toBe(42);
      expect(GroundAI.waypointX[eid]).toBeCloseTo(100, 5);
      expect(GroundAI.waypointY[eid]).toBeCloseTo(0, 5);
      expect(GroundAI.waypointZ[eid]).toBeCloseTo(50, 5);
      expect(GroundAI.aggression[eid]).toBeCloseTo(0.8, 5);
      expect(GroundAI.accuracy[eid]).toBeCloseTo(0.7, 5);
    });

    it('should support all AI states', () => {
      const world = createWorld();
      const eid = addEntity(world);

      addComponent(world, GroundAI, eid);

      // Test all states: Idle=0, MoveTo=1, Attack=2, Capture=3, Flee=4
      for (let state = 0; state <= 4; state++) {
        GroundAI.state[eid] = state;
        expect(GroundAI.state[eid]).toBe(state);
      }
    });
  });
});
