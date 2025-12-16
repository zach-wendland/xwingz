/**
 * Procedural Star Wars planet texture generator
 * Creates canvas-based textures for different planet styles
 */

import * as THREE from "three";

export type PlanetStyle = "desert" | "ice" | "jungle" | "ocean" | "volcanic" | "city" | "gas" | "barren" | "mystic";

// Cache for generated textures
const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Simple seeded random for reproducible textures
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Noise function for texture generation
 */
function noise2D(x: number, y: number, rand: () => number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Get random values at corners
  const seed1 = (ix * 374761393 + iy * 668265263) >>> 0;
  const seed2 = ((ix + 1) * 374761393 + iy * 668265263) >>> 0;
  const seed3 = (ix * 374761393 + (iy + 1) * 668265263) >>> 0;
  const seed4 = ((ix + 1) * 374761393 + (iy + 1) * 668265263) >>> 0;

  const r00 = (seed1 & 0xffff) / 0xffff;
  const r10 = (seed2 & 0xffff) / 0xffff;
  const r01 = (seed3 & 0xffff) / 0xffff;
  const r11 = (seed4 & 0xffff) / 0xffff;

  // Smooth interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const v0 = r00 * (1 - sx) + r10 * sx;
  const v1 = r01 * (1 - sx) + r11 * sx;

  void rand; // Keep for API consistency
  return v0 * (1 - sy) + v1 * sy;
}

/**
 * Fractal brownian motion for more natural looking noise
 */
function fbm(x: number, y: number, octaves: number, rand: () => number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2D(x * frequency, y * frequency, rand);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

/**
 * Create a desert planet texture (Tatooine-style)
 */
function createDesertTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Create dune patterns
      const dunes = fbm(u * 8, v * 4 + Math.sin(u * 6) * 0.5, 4, rand);
      const detail = fbm(u * 20, v * 20, 3, rand) * 0.2;

      // Color variations
      const variation = dunes + detail;

      // Sandy orange-tan colors
      const r = Math.floor(200 + variation * 55);
      const g = Math.floor(150 + variation * 50);
      const b = Math.floor(80 + variation * 40);

      const i = (y * size + x) * 4;
      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create an ice planet texture (Hoth-style)
 */
function createIceTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Ice and glacier patterns
      const ice = fbm(u * 6, v * 6, 5, rand);
      const cracks = Math.abs(Math.sin(u * 30 + ice * 5) * Math.cos(v * 25 + ice * 4)) * 0.3;

      const variation = ice - cracks;

      // White-blue ice colors
      const r = Math.floor(200 + variation * 55);
      const g = Math.floor(210 + variation * 45);
      const b = Math.floor(240 + variation * 15);

      const i = (y * size + x) * 4;
      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create a jungle planet texture (Yavin 4 / Endor style)
 */
function createJungleTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Forest and vegetation patterns
      const forest = fbm(u * 10, v * 10, 5, rand);
      const rivers = Math.max(0, 0.5 - Math.abs(fbm(u * 5, v * 5, 3, rand) - 0.5) * 4);

      const variation = forest;

      // Mix green with some orange (like Yavin 4)
      const hasOrange = seed % 2 === 0;
      if (rivers > 0.3) {
        // Water/river
        const i = (y * size + x) * 4;
        data[i] = 40;
        data[i + 1] = 80 + Math.floor(rivers * 40);
        data[i + 2] = 100 + Math.floor(rivers * 40);
        data[i + 3] = 255;
      } else if (hasOrange && variation > 0.6) {
        // Orange vegetation (Yavin-style)
        const i = (y * size + x) * 4;
        data[i] = Math.floor(180 + variation * 40);
        data[i + 1] = Math.floor(120 + variation * 30);
        data[i + 2] = Math.floor(50 + variation * 20);
        data[i + 3] = 255;
      } else {
        // Green forest
        const i = (y * size + x) * 4;
        data[i] = Math.floor(40 + variation * 40);
        data[i + 1] = Math.floor(100 + variation * 60);
        data[i + 2] = Math.floor(40 + variation * 40);
        data[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create an ocean planet texture (Scarif / Naboo style)
 */
function createOceanTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Ocean and island patterns
      const terrain = fbm(u * 6, v * 6, 5, rand);
      const waves = Math.sin(u * 40 + v * 30 + terrain * 5) * 0.05;

      const isLand = terrain > 0.55;
      const isBeach = terrain > 0.5 && terrain <= 0.55;

      const i = (y * size + x) * 4;

      if (isLand) {
        // Green island
        const variation = terrain - 0.55;
        data[i] = Math.floor(60 + variation * 60);
        data[i + 1] = Math.floor(130 + variation * 50);
        data[i + 2] = Math.floor(50 + variation * 40);
      } else if (isBeach) {
        // Sandy beach
        data[i] = 220;
        data[i + 1] = 200;
        data[i + 2] = 150;
      } else {
        // Ocean water
        const depth = (0.5 - terrain) * 2;
        data[i] = Math.floor(30 + waves * 30);
        data[i + 1] = Math.floor(80 + depth * 60 + waves * 20);
        data[i + 2] = Math.floor(150 + depth * 80 + waves * 30);
      }
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create a volcanic planet texture (Mustafar-style)
 */
function createVolcanicTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Lava rivers and volcanic rock
      const rock = fbm(u * 8, v * 8, 4, rand);
      const lava = Math.max(0, 0.4 - Math.abs(fbm(u * 4, v * 4, 3, rand) - 0.5) * 2);
      const heat = fbm(u * 12, v * 12, 2, rand);

      const i = (y * size + x) * 4;

      if (lava > 0.15) {
        // Lava flow - bright orange/red
        const intensity = lava * 2;
        data[i] = Math.floor(255 * Math.min(1, intensity + 0.5));
        data[i + 1] = Math.floor(100 * intensity);
        data[i + 2] = Math.floor(20 * intensity);
      } else {
        // Dark volcanic rock
        const brightness = 20 + rock * 40 + heat * 30;
        data[i] = Math.floor(brightness * 1.2);
        data[i + 1] = Math.floor(brightness * 0.4);
        data[i + 2] = Math.floor(brightness * 0.3);
      }
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create a city planet texture (Coruscant-style)
 */
function createCityTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // City grid pattern
      const gridX = Math.abs(Math.sin(u * 80)) * 0.3;
      const gridY = Math.abs(Math.sin(v * 80)) * 0.3;
      const grid = Math.max(gridX, gridY);

      // Large districts
      const districts = fbm(u * 4, v * 4, 2, rand);

      // Lights
      const lights = rand() > 0.97 ? 1 : 0;

      const i = (y * size + x) * 4;

      // Metallic gray with lights
      const base = 60 + districts * 40 + grid * 20;

      if (lights) {
        // City lights - yellowish
        data[i] = 255;
        data[i + 1] = 240;
        data[i + 2] = 180;
      } else {
        data[i] = Math.floor(base + 10);
        data[i + 1] = Math.floor(base + 20);
        data[i + 2] = Math.floor(base + 40);
      }
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create a gas giant texture (Bespin-style)
 */
function createGasTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Horizontal cloud bands
      const bands = Math.sin(v * 20 + fbm(u * 4, v * 2, 3, rand) * 2) * 0.5 + 0.5;
      const turbulence = fbm(u * 8, v * 3, 4, rand);

      const variation = bands + turbulence * 0.3;

      // Orange/brown/white cloud colors (Bespin-style)
      const i = (y * size + x) * 4;
      data[i] = Math.floor(200 + variation * 55);
      data[i + 1] = Math.floor(150 + variation * 60);
      data[i + 2] = Math.floor(100 + variation * 80);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create a mystic/swamp planet texture (Dagobah-style)
 */
function createMysticTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Swampy, murky patterns
      const swamp = fbm(u * 6, v * 6, 5, rand);
      const mist = fbm(u * 3, v * 3, 2, rand) * 0.3;
      const fog = Math.sin(u * 10 + v * 8 + swamp * 4) * 0.1;

      const variation = swamp + mist + fog;

      // Dark murky greens and browns
      const i = (y * size + x) * 4;
      data[i] = Math.floor(40 + variation * 40);
      data[i + 1] = Math.floor(60 + variation * 50);
      data[i + 2] = Math.floor(30 + variation * 40);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Create a barren planet texture
 */
function createBarrenTexture(size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(seed);

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Cratered, barren surface
      const terrain = fbm(u * 8, v * 8, 5, rand);
      const craters = Math.max(0, 0.3 - fbm(u * 15, v * 15, 2, rand)) * 2;

      const variation = terrain - craters * 0.3;

      // Gray-brown rocky surface
      const i = (y * size + x) * 4;
      const base = 100 + variation * 60;
      data[i] = Math.floor(base * 1.0);
      data[i + 1] = Math.floor(base * 0.9);
      data[i + 2] = Math.floor(base * 0.85);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Get or create a planet texture for the given style
 */
export function getPlanetTexture(style: PlanetStyle, planetId: string, textureSize = 256): THREE.CanvasTexture {
  const cacheKey = `${style}_${planetId}_${textureSize}`;

  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey)!;
  }

  // Create seed from planet ID
  const seed = planetId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 31337;

  let canvas: HTMLCanvasElement;

  switch (style) {
    case "desert":
      canvas = createDesertTexture(textureSize, seed);
      break;
    case "ice":
      canvas = createIceTexture(textureSize, seed);
      break;
    case "jungle":
      canvas = createJungleTexture(textureSize, seed);
      break;
    case "ocean":
      canvas = createOceanTexture(textureSize, seed);
      break;
    case "volcanic":
      canvas = createVolcanicTexture(textureSize, seed);
      break;
    case "city":
      canvas = createCityTexture(textureSize, seed);
      break;
    case "gas":
      canvas = createGasTexture(textureSize, seed);
      break;
    case "mystic":
      canvas = createMysticTexture(textureSize, seed);
      break;
    case "barren":
    default:
      canvas = createBarrenTexture(textureSize, seed);
      break;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  textureCache.set(cacheKey, texture);

  return texture;
}

/**
 * Clear texture cache (for cleanup)
 */
export function clearPlanetTextureCache(): void {
  for (const texture of textureCache.values()) {
    texture.dispose();
  }
  textureCache.clear();
}
