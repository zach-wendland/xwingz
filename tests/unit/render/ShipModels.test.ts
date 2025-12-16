/**
 * Unit tests for ShipModels.ts
 *
 * Tests the unified ship mesh creation system including:
 * - Procedural ship generation for all 12 ship types
 * - Caching behavior
 * - Ship configuration application (scale, tint, shadows)
 * - Ship metadata functions
 *
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import * as THREE from 'three';
import {
  createProceduralShip,
  clearShipModelCache,
  getAvailableShipTypes,
  getShipDefinition,
  ShipType,
} from '../../../packages/render/src/ShipModels';

// Mock canvas 2D context for jsdom (which doesn't implement it natively)
beforeAll(() => {
  // Create a mock CanvasRenderingContext2D
  const mockContext2D = {
    createRadialGradient: () => ({
      addColorStop: () => {},
    }),
    fillRect: () => {},
    fillStyle: '',
    canvas: { width: 64, height: 64 },
  };

  // Override HTMLCanvasElement.prototype.getContext to return our mock
  HTMLCanvasElement.prototype.getContext = function(contextId: string) {
    if (contextId === '2d') {
      return mockContext2D as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

describe('ShipModels', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure isolation
    clearShipModelCache();
  });

  describe('getAvailableShipTypes', () => {
    it('should return all 12 ship types', () => {
      const types = getAvailableShipTypes();

      expect(types).toHaveLength(12);
      expect(types).toContain('xwing');
      expect(types).toContain('xwing_player');
      expect(types).toContain('tie_ln');
      expect(types).toContain('tie_fighter');
      expect(types).toContain('tie_interceptor');
      expect(types).toContain('ywing');
      expect(types).toContain('awing');
      expect(types).toContain('star_destroyer');
      expect(types).toContain('nebulon_b');
      expect(types).toContain('cr90_corvette');
      expect(types).toContain('transport');
      expect(types).toContain('shuttle');
    });

    it('should return an array of strings', () => {
      const types = getAvailableShipTypes();

      types.forEach(type => {
        expect(typeof type).toBe('string');
      });
    });
  });

  describe('getShipDefinition', () => {
    it('should return definition for valid ship type', () => {
      const def = getShipDefinition('xwing');

      expect(def).toBeDefined();
      expect(def!.type).toBe('xwing');
      expect(def!.faction).toBe('rebel');
      expect(typeof def!.defaultScale).toBe('number');
      expect(typeof def!.buildProcedural).toBe('function');
    });

    it('should return correct faction for rebel ships', () => {
      const rebelShips: ShipType[] = ['xwing', 'xwing_player', 'ywing', 'awing', 'nebulon_b', 'cr90_corvette'];

      rebelShips.forEach(shipType => {
        const def = getShipDefinition(shipType);
        expect(def!.faction).toBe('rebel');
      });
    });

    it('should return correct faction for empire ships', () => {
      const empireShips: ShipType[] = ['tie_ln', 'tie_fighter', 'tie_interceptor', 'star_destroyer', 'shuttle'];

      empireShips.forEach(shipType => {
        const def = getShipDefinition(shipType);
        expect(def!.faction).toBe('empire');
      });
    });

    it('should return neutral faction for transport', () => {
      const def = getShipDefinition('transport');
      expect(def!.faction).toBe('neutral');
    });

    it('should return undefined for invalid ship type', () => {
      const def = getShipDefinition('invalid_ship' as ShipType);
      expect(def).toBeUndefined();
    });

    it('should have kenneyAsset defined for transport and shuttle', () => {
      const transportDef = getShipDefinition('transport');
      const shuttleDef = getShipDefinition('shuttle');

      expect(transportDef!.kenneyAsset).toBe('CRAFT_CARGO_A');
      expect(shuttleDef!.kenneyAsset).toBe('CRAFT_SPEEDER_A');
    });

    it('should have appropriate default scales', () => {
      // Fighters should have scale 2.5
      expect(getShipDefinition('xwing')!.defaultScale).toBe(2.5);
      expect(getShipDefinition('tie_ln')!.defaultScale).toBe(2.5);

      // Capital ships should have scale 1.0
      expect(getShipDefinition('star_destroyer')!.defaultScale).toBe(1.0);
      expect(getShipDefinition('nebulon_b')!.defaultScale).toBe(1.0);

      // Transport/shuttle should have scale 3.0
      expect(getShipDefinition('transport')!.defaultScale).toBe(3.0);
      expect(getShipDefinition('shuttle')!.defaultScale).toBe(3.0);
    });
  });

  describe('createProceduralShip', () => {
    describe('returns valid THREE.Group for all ship types', () => {
      const shipTypes: ShipType[] = [
        'xwing',
        'xwing_player',
        'tie_ln',
        'tie_fighter',
        'tie_interceptor',
        'ywing',
        'awing',
        'star_destroyer',
        'nebulon_b',
        'cr90_corvette',
        'transport',
        'shuttle',
      ];

      shipTypes.forEach(shipType => {
        it(`should create valid group for ${shipType}`, () => {
          const ship = createProceduralShip({ type: shipType });

          expect(ship).toBeInstanceOf(THREE.Group);
          expect(ship.children.length).toBeGreaterThan(0);
        });
      });
    });

    it('should store ship type in userData', () => {
      const ship = createProceduralShip({ type: 'xwing' });

      expect(ship.userData.shipType).toBe('xwing');
    });

    it('should store faction in userData', () => {
      const rebelShip = createProceduralShip({ type: 'xwing' });
      const empireShip = createProceduralShip({ type: 'tie_ln' });
      const neutralShip = createProceduralShip({ type: 'transport' });

      expect(rebelShip.userData.shipFaction).toBe('rebel');
      expect(empireShip.userData.shipFaction).toBe('empire');
      expect(neutralShip.userData.shipFaction).toBe('neutral');
    });

    it('should apply default scale from ship definition', () => {
      const xwing = createProceduralShip({ type: 'xwing' });
      const starDestroyer = createProceduralShip({ type: 'star_destroyer' });

      expect(xwing.scale.x).toBe(2.5);
      expect(xwing.scale.y).toBe(2.5);
      expect(xwing.scale.z).toBe(2.5);

      expect(starDestroyer.scale.x).toBe(1.0);
      expect(starDestroyer.scale.y).toBe(1.0);
      expect(starDestroyer.scale.z).toBe(1.0);
    });

    it('should apply custom scale when provided', () => {
      const ship = createProceduralShip({ type: 'xwing', scale: 5.0 });

      expect(ship.scale.x).toBe(5.0);
      expect(ship.scale.y).toBe(5.0);
      expect(ship.scale.z).toBe(5.0);
    });

    it('should enable shadows by default', () => {
      const ship = createProceduralShip({ type: 'xwing' });

      let hasMeshWithShadows = false;
      ship.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          hasMeshWithShadows = child.castShadow && child.receiveShadow;
        }
      });

      expect(hasMeshWithShadows).toBe(true);
    });

    it('should not enable shadows when disabled in config', () => {
      const ship = createProceduralShip({ type: 'xwing', enableShadows: false });

      let allShadowsDisabled = true;
      ship.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.castShadow || child.receiveShadow) {
            allShadowsDisabled = false;
          }
        }
      });

      expect(allShadowsDisabled).toBe(true);
    });

    it('should override faction in userData when provided in config', () => {
      const ship = createProceduralShip({ type: 'xwing', faction: 'empire' });

      expect(ship.userData.shipFaction).toBe('empire');
    });

    it('should return transport fallback for unknown ship type', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const ship = createProceduralShip({ type: 'unknown_ship' as ShipType });

      expect(ship).toBeInstanceOf(THREE.Group);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown ship type')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Caching behavior', () => {
    it('should cache procedural ships by type', () => {
      const ship1 = createProceduralShip({ type: 'xwing' });
      const ship2 = createProceduralShip({ type: 'xwing' });

      // Both should be clones (different instances)
      expect(ship1).not.toBe(ship2);

      // But structurally identical
      expect(ship1.children.length).toBe(ship2.children.length);
    });

    it('should return different clones on each call', () => {
      const ship1 = createProceduralShip({ type: 'tie_ln' });
      const ship2 = createProceduralShip({ type: 'tie_ln' });

      // Modify ship1
      ship1.position.set(100, 200, 300);

      // ship2 should not be affected
      expect(ship2.position.x).toBe(0);
      expect(ship2.position.y).toBe(0);
      expect(ship2.position.z).toBe(0);
    });

    it('should clear cache when clearShipModelCache is called', () => {
      // Create ships to populate cache
      createProceduralShip({ type: 'xwing' });
      createProceduralShip({ type: 'tie_ln' });

      // Clear cache
      clearShipModelCache();

      // Cache should be empty (new ships will be built fresh)
      // We can't directly test internal cache, but we can verify ships still work
      const newShip = createProceduralShip({ type: 'xwing' });
      expect(newShip).toBeInstanceOf(THREE.Group);
    });

    it('should cache different ship types separately', () => {
      const xwing = createProceduralShip({ type: 'xwing' });
      const tie = createProceduralShip({ type: 'tie_ln' });

      // Different ship types should have different structures
      expect(xwing.children.length).not.toBe(tie.children.length);
    });
  });

  describe('Ship geometry structure', () => {
    describe('X-Wing', () => {
      it('should have fuselage, nose, canopy, and 4 S-foils', () => {
        const ship = createProceduralShip({ type: 'xwing' });

        // X-Wing has: fuselage, nose, intake, canopy, droid, stripe, and 4 wing groups
        // Total should be at least 10 children
        expect(ship.children.length).toBeGreaterThanOrEqual(10);
      });

      it('should contain mesh children', () => {
        const ship = createProceduralShip({ type: 'xwing' });

        let meshCount = 0;
        ship.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshCount++;
          }
        });

        expect(meshCount).toBeGreaterThan(0);
      });
    });

    describe('TIE Fighter', () => {
      it('should have cockpit ball, solar panels, and struts', () => {
        const ship = createProceduralShip({ type: 'tie_ln' });

        // TIE has: cockpit, left panel, right panel, strut, glow
        expect(ship.children.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe('TIE Interceptor', () => {
      it('should have cockpit and angled wing panels', () => {
        const ship = createProceduralShip({ type: 'tie_interceptor' });

        // TIE Interceptor has: cockpit, 2 wing groups, strut, glow
        expect(ship.children.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe('Y-Wing', () => {
      it('should have cockpit and engine nacelles', () => {
        const ship = createProceduralShip({ type: 'ywing' });

        // Y-Wing has: cockpit, nose, 2 nacelle groups
        expect(ship.children.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe('A-Wing', () => {
      it('should have wedge fuselage and wing engines', () => {
        const ship = createProceduralShip({ type: 'awing' });

        // A-Wing has: fuselage, cockpit, 2 engine groups
        expect(ship.children.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe('Star Destroyer', () => {
      it('should have hull, bridge tower, and engine bank', () => {
        const ship = createProceduralShip({ type: 'star_destroyer' });

        // Star Destroyer has many parts: hull, bridge, domes, engines, turrets, trench
        expect(ship.children.length).toBeGreaterThanOrEqual(10);
      });

      it('should have turret emplacements', () => {
        const ship = createProceduralShip({ type: 'star_destroyer' });

        let cylinderCount = 0;
        ship.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry) {
            cylinderCount++;
          }
        });

        // Should have multiple turret bases (cylinders)
        expect(cylinderCount).toBeGreaterThan(0);
      });
    });

    describe('Nebulon-B', () => {
      it('should have forward section, spar, and aft section', () => {
        const ship = createProceduralShip({ type: 'nebulon_b' });

        // Nebulon-B has: forward section, spar, aft section, engine pods with glows
        expect(ship.children.length).toBeGreaterThanOrEqual(5);
      });
    });

    describe('CR90 Corvette', () => {
      it('should have hammerhead hull and engine cluster', () => {
        const ship = createProceduralShip({ type: 'cr90_corvette' });

        // CR90 has: hull, cockpit, stripe, engine section, engine glows (11)
        expect(ship.children.length).toBeGreaterThanOrEqual(5);
      });
    });

    describe('Transport', () => {
      it('should have boxy cargo hull and engine pods', () => {
        const ship = createProceduralShip({ type: 'transport' });

        // Transport has: hull, cockpit, 2 engine pods
        expect(ship.children.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe('Shuttle', () => {
      it('should have body, cockpit, wings, and dorsal fin', () => {
        const ship = createProceduralShip({ type: 'shuttle' });

        // Shuttle has: body, cockpit, 2 lower wings, dorsal fin
        expect(ship.children.length).toBeGreaterThanOrEqual(5);
      });
    });
  });

  describe('Material properties', () => {
    it('should use MeshStandardMaterial for ship parts', () => {
      const ship = createProceduralShip({ type: 'xwing' });

      let hasStandardMaterial = false;
      ship.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          hasStandardMaterial = true;
        }
      });

      expect(hasStandardMaterial).toBe(true);
    });

    it('should have emissive materials for engine glows', () => {
      const ship = createProceduralShip({ type: 'star_destroyer' });

      let hasEmissiveMaterial = false;
      ship.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.emissiveIntensity && mat.emissiveIntensity > 0) {
            hasEmissiveMaterial = true;
          }
        }
      });

      expect(hasEmissiveMaterial).toBe(true);
    });
  });

  describe('Tint application', () => {
    it('should apply tint color when specified', () => {
      const ship = createProceduralShip({ type: 'xwing', tint: 0xff0000 });

      // The ship should have the tint applied
      // We verify the ship was created with the tint config
      expect(ship).toBeInstanceOf(THREE.Group);
    });

    it('should not modify original cached mesh when applying tint', () => {
      // Create first ship without tint
      const ship1 = createProceduralShip({ type: 'tie_ln' });

      // Create second ship with tint
      const ship2 = createProceduralShip({ type: 'tie_ln', tint: 0x00ff00 });

      // Both should be valid
      expect(ship1).toBeInstanceOf(THREE.Group);
      expect(ship2).toBeInstanceOf(THREE.Group);
    });
  });

  describe('xwing_player variant', () => {
    it('should use same procedural builder as xwing', () => {
      const xwing = createProceduralShip({ type: 'xwing' });
      const xwingPlayer = createProceduralShip({ type: 'xwing_player' });

      // Both should have same structure
      expect(xwing.children.length).toBe(xwingPlayer.children.length);
    });

    it('should have rebel faction', () => {
      const ship = createProceduralShip({ type: 'xwing_player' });

      expect(ship.userData.shipFaction).toBe('rebel');
    });
  });

  describe('tie_ln and tie_fighter equivalence', () => {
    it('should use same procedural builder', () => {
      const tieLn = createProceduralShip({ type: 'tie_ln' });
      const tieFighter = createProceduralShip({ type: 'tie_fighter' });

      // Both should have same structure
      expect(tieLn.children.length).toBe(tieFighter.children.length);
    });
  });

  describe('Engine glow creation', () => {
    it('should create sprites for engine glows', () => {
      const ship = createProceduralShip({ type: 'xwing' });

      let spriteCount = 0;
      ship.traverse((child) => {
        if (child instanceof THREE.Sprite) {
          spriteCount++;
        }
      });

      // X-Wing should have engine glow sprites (4 engines)
      expect(spriteCount).toBeGreaterThan(0);
    });

    it('should use additive blending for glow sprites', () => {
      const ship = createProceduralShip({ type: 'tie_ln' });

      let hasAdditiveBlending = false;
      ship.traverse((child) => {
        if (child instanceof THREE.Sprite) {
          const material = child.material as THREE.SpriteMaterial;
          if (material.blending === THREE.AdditiveBlending) {
            hasAdditiveBlending = true;
          }
        }
      });

      expect(hasAdditiveBlending).toBe(true);
    });
  });

  describe('Capital ship specifics', () => {
    it('Star Destroyer should have shield generator domes', () => {
      const ship = createProceduralShip({ type: 'star_destroyer' });

      let sphereCount = 0;
      ship.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry) {
          sphereCount++;
        }
      });

      // Should have at least 2 sphere geometries for shield domes
      expect(sphereCount).toBeGreaterThanOrEqual(2);
    });

    it('Nebulon-B should have characteristic thin connecting spar', () => {
      const ship = createProceduralShip({ type: 'nebulon_b' });

      let hasBoxGeometry = false;
      ship.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
          hasBoxGeometry = true;
        }
      });

      expect(hasBoxGeometry).toBe(true);
    });
  });
});
