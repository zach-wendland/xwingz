import {
  SPACE_GROUND_RATIO,
  LANDING_ALTITUDE_THRESHOLD,
  SURFACE_ALTITUDE,
  spaceToGround,
  groundToSpace,
  getAltitude,
  isInLandingRange,
  isAtSurface,
  calculateLandingZone,
  calculateLaunchPosition,
  interpolateTransition,
  Vec3
} from '../../../packages/gameplay/src/transition/coordinates';

describe('coordinates', () => {
  describe('constants', () => {
    it('should export SPACE_GROUND_RATIO as 50', () => {
      expect(SPACE_GROUND_RATIO).toBe(50);
    });

    it('should export LANDING_ALTITUDE_THRESHOLD as 500', () => {
      expect(LANDING_ALTITUDE_THRESHOLD).toBe(500);
    });

    it('should export SURFACE_ALTITUDE as 50', () => {
      expect(SURFACE_ALTITUDE).toBe(50);
    });
  });

  describe('spaceToGround()', () => {
    it('should convert origin correctly', () => {
      const spacePos: Vec3 = { x: 0, y: 0, z: 0 };
      const groundPos = spaceToGround(spacePos);

      expect(groundPos).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('should divide all coordinates by SPACE_GROUND_RATIO', () => {
      const spacePos: Vec3 = { x: 500, y: 250, z: 1000 };
      const groundPos = spaceToGround(spacePos);

      expect(groundPos.x).toBe(10);
      expect(groundPos.y).toBe(5);
      expect(groundPos.z).toBe(20);
    });

    it('should handle negative X and Z coordinates', () => {
      const spacePos: Vec3 = { x: -500, y: 100, z: -250 };
      const groundPos = spaceToGround(spacePos);

      expect(groundPos.x).toBe(-10);
      expect(groundPos.y).toBe(2);
      expect(groundPos.z).toBe(-5);
    });

    it('should clamp Y coordinate to minimum of 0', () => {
      const spacePos: Vec3 = { x: 100, y: -500, z: 100 };
      const groundPos = spaceToGround(spacePos);

      expect(groundPos.y).toBe(0);
    });

    it('should handle large coordinate values', () => {
      const spacePos: Vec3 = { x: 50000, y: 10000, z: -75000 };
      const groundPos = spaceToGround(spacePos);

      expect(groundPos.x).toBe(1000);
      expect(groundPos.y).toBe(200);
      expect(groundPos.z).toBe(-1500);
    });

    it('should handle fractional results', () => {
      const spacePos: Vec3 = { x: 75, y: 125, z: 33 };
      const groundPos = spaceToGround(spacePos);

      expect(groundPos.x).toBe(1.5);
      expect(groundPos.y).toBe(2.5);
      expect(groundPos.z).toBeCloseTo(0.66, 2);
    });
  });

  describe('groundToSpace()', () => {
    it('should convert origin correctly', () => {
      const groundPos: Vec3 = { x: 0, y: 0, z: 0 };
      const spacePos = groundToSpace(groundPos);

      expect(spacePos).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('should multiply all coordinates by SPACE_GROUND_RATIO', () => {
      const groundPos: Vec3 = { x: 10, y: 5, z: 20 };
      const spacePos = groundToSpace(groundPos);

      expect(spacePos.x).toBe(500);
      expect(spacePos.y).toBe(250);
      expect(spacePos.z).toBe(1000);
    });

    it('should handle negative coordinates', () => {
      const groundPos: Vec3 = { x: -10, y: 2, z: -5 };
      const spacePos = groundToSpace(groundPos);

      expect(spacePos.x).toBe(-500);
      expect(spacePos.y).toBe(100);
      expect(spacePos.z).toBe(-250);
    });

    it('should handle large coordinate values', () => {
      const groundPos: Vec3 = { x: 1000, y: 200, z: -1500 };
      const spacePos = groundToSpace(groundPos);

      expect(spacePos.x).toBe(50000);
      expect(spacePos.y).toBe(10000);
      expect(spacePos.z).toBe(-75000);
    });

    it('should handle fractional ground coordinates', () => {
      const groundPos: Vec3 = { x: 1.5, y: 0.5, z: 2.25 };
      const spacePos = groundToSpace(groundPos);

      expect(spacePos.x).toBe(75);
      expect(spacePos.y).toBe(25);
      expect(spacePos.z).toBe(112.5);
    });
  });

  describe('round-trip transformations', () => {
    it('should preserve positive coordinates after space->ground->space', () => {
      const original: Vec3 = { x: 500, y: 250, z: 1000 };
      const groundPos = spaceToGround(original);
      const backToSpace = groundToSpace(groundPos);

      expect(backToSpace.x).toBe(original.x);
      expect(backToSpace.y).toBe(original.y);
      expect(backToSpace.z).toBe(original.z);
    });

    it('should preserve negative X/Z coordinates after round-trip', () => {
      const original: Vec3 = { x: -750, y: 100, z: -1250 };
      const groundPos = spaceToGround(original);
      const backToSpace = groundToSpace(groundPos);

      expect(backToSpace.x).toBe(original.x);
      expect(backToSpace.y).toBe(original.y);
      expect(backToSpace.z).toBe(original.z);
    });

    it('should clamp negative Y on round-trip (information loss)', () => {
      const original: Vec3 = { x: 100, y: -500, z: 100 };
      const groundPos = spaceToGround(original);
      const backToSpace = groundToSpace(groundPos);

      // Y is clamped to 0 in spaceToGround, so round-trip loses the negative Y
      expect(backToSpace.y).toBe(0);
    });

    it('should preserve ground coordinates after ground->space->ground', () => {
      const original: Vec3 = { x: 25, y: 10, z: -15 };
      const spacePos = groundToSpace(original);
      const backToGround = spaceToGround(spacePos);

      expect(backToGround.x).toBe(original.x);
      expect(backToGround.y).toBe(original.y);
      expect(backToGround.z).toBe(original.z);
    });
  });

  describe('getAltitude()', () => {
    it('should return 0 for Y at ground level', () => {
      expect(getAltitude(0)).toBe(0);
    });

    it('should return positive altitude for positive Y', () => {
      expect(getAltitude(100)).toBe(100);
      expect(getAltitude(500)).toBe(500);
      expect(getAltitude(1000)).toBe(1000);
    });

    it('should clamp negative Y to 0', () => {
      expect(getAltitude(-100)).toBe(0);
      expect(getAltitude(-500)).toBe(0);
      expect(getAltitude(-1)).toBe(0);
    });

    it('should handle very large altitude values', () => {
      expect(getAltitude(100000)).toBe(100000);
    });

    it('should handle fractional altitude values', () => {
      expect(getAltitude(123.456)).toBe(123.456);
    });
  });

  describe('isInLandingRange()', () => {
    it('should return true at ground level', () => {
      expect(isInLandingRange(0)).toBe(true);
    });

    it('should return true below LANDING_ALTITUDE_THRESHOLD', () => {
      expect(isInLandingRange(100)).toBe(true);
      expect(isInLandingRange(499)).toBe(true);
      expect(isInLandingRange(499.9)).toBe(true);
    });

    it('should return false at or above LANDING_ALTITUDE_THRESHOLD', () => {
      expect(isInLandingRange(500)).toBe(false);
      expect(isInLandingRange(501)).toBe(false);
      expect(isInLandingRange(1000)).toBe(false);
    });

    it('should return true for negative Y (treated as altitude 0)', () => {
      expect(isInLandingRange(-100)).toBe(true);
    });
  });

  describe('isAtSurface()', () => {
    it('should return true at ground level', () => {
      expect(isAtSurface(0)).toBe(true);
    });

    it('should return true below SURFACE_ALTITUDE', () => {
      expect(isAtSurface(10)).toBe(true);
      expect(isAtSurface(49)).toBe(true);
      expect(isAtSurface(49.9)).toBe(true);
    });

    it('should return false at or above SURFACE_ALTITUDE', () => {
      expect(isAtSurface(50)).toBe(false);
      expect(isAtSurface(51)).toBe(false);
      expect(isAtSurface(100)).toBe(false);
    });

    it('should return true for negative Y (treated as altitude 0)', () => {
      expect(isAtSurface(-50)).toBe(true);
    });
  });

  describe('calculateLandingZone()', () => {
    it('should convert X and Z to ground scale and set Y to 0', () => {
      const spacePos: Vec3 = { x: 500, y: 1000, z: 750 };
      const landingZone = calculateLandingZone(spacePos);

      expect(landingZone.x).toBe(10);
      expect(landingZone.y).toBe(0);
      expect(landingZone.z).toBe(15);
    });

    it('should always set Y to 0 regardless of input altitude', () => {
      const highAltitude: Vec3 = { x: 100, y: 5000, z: 100 };
      const lowAltitude: Vec3 = { x: 100, y: 10, z: 100 };

      expect(calculateLandingZone(highAltitude).y).toBe(0);
      expect(calculateLandingZone(lowAltitude).y).toBe(0);
    });

    it('should handle negative X and Z coordinates', () => {
      const spacePos: Vec3 = { x: -250, y: 500, z: -500 };
      const landingZone = calculateLandingZone(spacePos);

      expect(landingZone.x).toBe(-5);
      expect(landingZone.y).toBe(0);
      expect(landingZone.z).toBe(-10);
    });

    it('should handle origin position', () => {
      const spacePos: Vec3 = { x: 0, y: 0, z: 0 };
      const landingZone = calculateLandingZone(spacePos);

      expect(landingZone).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('calculateLaunchPosition()', () => {
    it('should convert X and Z to space scale and set Y to SURFACE_ALTITUDE + 10', () => {
      const groundPos: Vec3 = { x: 10, y: 0, z: 15 };
      const launchPos = calculateLaunchPosition(groundPos);

      expect(launchPos.x).toBe(500);
      expect(launchPos.y).toBe(60); // SURFACE_ALTITUDE (50) + 10
      expect(launchPos.z).toBe(750);
    });

    it('should always set Y to SURFACE_ALTITUDE + 10 regardless of ground Y', () => {
      const onGround: Vec3 = { x: 10, y: 0, z: 10 };
      const elevated: Vec3 = { x: 10, y: 5, z: 10 };

      expect(calculateLaunchPosition(onGround).y).toBe(60);
      expect(calculateLaunchPosition(elevated).y).toBe(60);
    });

    it('should handle negative X and Z coordinates', () => {
      const groundPos: Vec3 = { x: -5, y: 0, z: -10 };
      const launchPos = calculateLaunchPosition(groundPos);

      expect(launchPos.x).toBe(-250);
      expect(launchPos.y).toBe(60);
      expect(launchPos.z).toBe(-500);
    });

    it('should handle origin position', () => {
      const groundPos: Vec3 = { x: 0, y: 0, z: 0 };
      const launchPos = calculateLaunchPosition(groundPos);

      expect(launchPos.x).toBe(0);
      expect(launchPos.y).toBe(60);
      expect(launchPos.z).toBe(0);
    });
  });

  describe('interpolateTransition()', () => {
    const spacePos: Vec3 = { x: 100, y: 200, z: 300 };
    const groundPos: Vec3 = { x: 10, y: 0, z: 30 };

    it('should return spacePos when progress is 0', () => {
      const result = interpolateTransition(spacePos, groundPos, 0);

      expect(result).toEqual(spacePos);
    });

    it('should return groundPos when progress is 1', () => {
      const result = interpolateTransition(spacePos, groundPos, 1);

      expect(result).toEqual(groundPos);
    });

    it('should interpolate at progress 0.5', () => {
      const result = interpolateTransition(spacePos, groundPos, 0.5);

      expect(result.x).toBe(55);  // (100 + 10) / 2
      expect(result.y).toBe(100); // (200 + 0) / 2
      expect(result.z).toBe(165); // (300 + 30) / 2
    });

    it('should interpolate at progress 0.25', () => {
      const result = interpolateTransition(spacePos, groundPos, 0.25);

      expect(result.x).toBe(77.5);  // 100 + (10 - 100) * 0.25
      expect(result.y).toBe(150);   // 200 + (0 - 200) * 0.25
      expect(result.z).toBe(232.5); // 300 + (30 - 300) * 0.25
    });

    it('should clamp progress below 0 to 0', () => {
      const result = interpolateTransition(spacePos, groundPos, -0.5);

      expect(result).toEqual(spacePos);
    });

    it('should clamp progress above 1 to 1', () => {
      const result = interpolateTransition(spacePos, groundPos, 1.5);

      expect(result).toEqual(groundPos);
    });

    it('should handle identical start and end positions', () => {
      const samePos: Vec3 = { x: 50, y: 50, z: 50 };
      const result = interpolateTransition(samePos, samePos, 0.5);

      expect(result).toEqual(samePos);
    });

    it('should handle negative coordinate interpolation', () => {
      const start: Vec3 = { x: -100, y: 200, z: -300 };
      const end: Vec3 = { x: 100, y: -200, z: 300 };
      const result = interpolateTransition(start, end, 0.5);

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.z).toBe(0);
    });
  });
});
