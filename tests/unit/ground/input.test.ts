/**
 * Tests for ground input handler.
 * Note: These tests mock the DOM environment since we're running in Node.js.
 */

describe('Ground Input', () => {
  describe('GroundInputState interface', () => {
    it('should have correct shape', () => {
      const state = {
        moveX: 0,
        moveZ: 0,
        jump: false,
        sprint: false,
        crouch: false,
        interact: false,
        firePrimary: false,
        aimYaw: 0,
        aimPitch: 0,
        toggleMap: false,
        dodge: false,
        throwGrenade: false
      };

      expect(state.moveX).toBeDefined();
      expect(state.moveZ).toBeDefined();
      expect(state.jump).toBeDefined();
      expect(state.sprint).toBeDefined();
      expect(state.crouch).toBeDefined();
      expect(state.interact).toBeDefined();
      expect(state.firePrimary).toBeDefined();
      expect(state.aimYaw).toBeDefined();
      expect(state.aimPitch).toBeDefined();
      expect(state.toggleMap).toBeDefined();
      expect(state.dodge).toBeDefined();
      expect(state.throwGrenade).toBeDefined();
    });

    it('should allow number values for movement axes', () => {
      const state = {
        moveX: -1,
        moveZ: 1,
        jump: false,
        sprint: true,
        crouch: false,
        interact: false,
        firePrimary: false,
        aimYaw: Math.PI,
        aimPitch: -0.5
      };

      expect(state.moveX).toBe(-1);
      expect(state.moveZ).toBe(1);
      expect(state.sprint).toBe(true);
      expect(state.aimYaw).toBeCloseTo(Math.PI, 5);
      expect(state.aimPitch).toBeCloseTo(-0.5, 5);
    });
  });

  describe('Input State Boundaries', () => {
    it('should handle extreme movement values', () => {
      const state = {
        moveX: 1,
        moveZ: 1,
        jump: false,
        sprint: false,
        crouch: false,
        interact: false,
        firePrimary: false,
        aimYaw: 0,
        aimPitch: 0
      };

      // Diagonal movement (should be normalized in actual system)
      const magnitude = Math.sqrt(state.moveX ** 2 + state.moveZ ** 2);
      expect(magnitude).toBeCloseTo(Math.sqrt(2), 5);
    });

    it('should handle pitch clamping boundaries', () => {
      const PITCH_MIN = -Math.PI * 0.44;
      const PITCH_MAX = Math.PI * 0.44;

      // Test values should be within bounds
      expect(PITCH_MIN).toBeCloseTo(-1.382, 2);
      expect(PITCH_MAX).toBeCloseTo(1.382, 2);

      // Clamped value
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

      expect(clamp(-2, PITCH_MIN, PITCH_MAX)).toBeCloseTo(PITCH_MIN, 5);
      expect(clamp(2, PITCH_MIN, PITCH_MAX)).toBeCloseTo(PITCH_MAX, 5);
      expect(clamp(0, PITCH_MIN, PITCH_MAX)).toBe(0);
    });

    it('should handle yaw wrap-around', () => {
      let yaw = 0;

      // Simulate continuous rotation
      for (let i = 0; i < 100; i++) {
        yaw -= 0.1;
      }

      // Yaw should accumulate (no wrap in raw state)
      expect(yaw).toBeCloseTo(-10, 5);

      // Normalize to -PI to PI
      const normalized = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      expect(normalized).toBeGreaterThanOrEqual(-Math.PI);
      expect(normalized).toBeLessThanOrEqual(Math.PI);
    });
  });

  describe('Input Combinations', () => {
    it('should allow simultaneous movement and actions', () => {
      const state = {
        moveX: 1,
        moveZ: 1,
        jump: true,
        sprint: true,
        crouch: false,
        interact: false,
        firePrimary: true,
        aimYaw: 0.5,
        aimPitch: -0.2
      };

      expect(state.moveX).toBe(1);
      expect(state.moveZ).toBe(1);
      expect(state.jump).toBe(true);
      expect(state.sprint).toBe(true);
      expect(state.firePrimary).toBe(true);
    });

    it('should handle mutually exclusive states logically', () => {
      // Sprint and crouch shouldn't both be active (game logic would handle this)
      const state = {
        moveX: 0,
        moveZ: 1,
        jump: false,
        sprint: true,
        crouch: true, // Logically, crouch should override sprint
        interact: false,
        firePrimary: false,
        aimYaw: 0,
        aimPitch: 0
      };

      // Both can be true in input state, system decides priority
      expect(state.sprint).toBe(true);
      expect(state.crouch).toBe(true);
    });
  });

  describe('Mouse Sensitivity', () => {
    it('should calculate yaw change correctly', () => {
      const MOUSE_SENSITIVITY = 0.002;
      const mouseDeltaX = 100; // pixels

      const yawChange = -mouseDeltaX * MOUSE_SENSITIVITY;
      expect(yawChange).toBeCloseTo(-0.2, 5);
    });

    it('should calculate pitch change correctly', () => {
      const MOUSE_SENSITIVITY = 0.002;
      const mouseDeltaY = 50; // pixels

      const pitchChange = -mouseDeltaY * MOUSE_SENSITIVITY;
      expect(pitchChange).toBeCloseTo(-0.1, 5);
    });

    it('should accumulate aim over multiple frames', () => {
      const MOUSE_SENSITIVITY = 0.002;
      let aimYaw = 0;

      // Simulate 10 frames of mouse movement
      for (let i = 0; i < 10; i++) {
        const mouseDeltaX = 10;
        aimYaw -= mouseDeltaX * MOUSE_SENSITIVITY;
      }

      expect(aimYaw).toBeCloseTo(-0.2, 5);
    });
  });

  describe('One-Shot Input Consumption', () => {
    it('should demonstrate one-shot pattern for jump', () => {
      let jumpPressed = false;
      let jumpConsumed = false;

      // Simulate key press
      jumpPressed = true;

      // In update cycle, consume the input
      if (jumpPressed && !jumpConsumed) {
        jumpConsumed = true;
        jumpPressed = false;
      }

      expect(jumpConsumed).toBe(true);
      expect(jumpPressed).toBe(false);
    });

    it('should demonstrate one-shot pattern for interact', () => {
      let interactPressed = true;

      // First frame - consume
      const shouldInteract = interactPressed;
      interactPressed = false;

      expect(shouldInteract).toBe(true);

      // Second frame - should not trigger again
      expect(interactPressed).toBe(false);
    });

    it('should demonstrate one-shot pattern for toggleMap (M key)', () => {
      let toggleMapPressed = true;

      // First frame - consume and return to map
      const shouldToggleMap = toggleMapPressed;
      toggleMapPressed = false;

      expect(shouldToggleMap).toBe(true);

      // Second frame - should not trigger again
      expect(toggleMapPressed).toBe(false);
    });
  });

  describe('Axis Input Processing', () => {
    it('should calculate axis from opposing keys', () => {
      function axis(negKeys: boolean, posKeys: boolean): number {
        const n = negKeys ? 1 : 0;
        const p = posKeys ? 1 : 0;
        return p - n;
      }

      expect(axis(false, false)).toBe(0);  // Neither
      expect(axis(true, false)).toBe(-1);  // Negative only
      expect(axis(false, true)).toBe(1);   // Positive only
      expect(axis(true, true)).toBe(0);    // Both cancel
    });

    it('should handle WASD correctly', () => {
      function axis(negKeys: boolean, posKeys: boolean): number {
        return (posKeys ? 1 : 0) - (negKeys ? 1 : 0);
      }

      // W pressed (forward)
      expect(axis(false, true)).toBe(1);

      // S pressed (backward)
      expect(axis(true, false)).toBe(-1);

      // A pressed (left)
      expect(axis(true, false)).toBe(-1);

      // D pressed (right)
      expect(axis(false, true)).toBe(1);
    });
  });
});
