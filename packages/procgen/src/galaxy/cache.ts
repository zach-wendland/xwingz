import { getSector } from "./sector";
import { getSystem, type SystemDef } from "./system";
import type { GenCtx, SectorDef, Vec3i } from "./types";

export type GalaxyCacheConfig = {
  maxSectors: number;
};

const DEFAULT_CFG: GalaxyCacheConfig = { maxSectors: 128 };

export class GalaxyCache {
  private sectors = new Map<string, SectorDef>();
  private cfg: GalaxyCacheConfig;

  constructor(private ctx: GenCtx, cfg?: Partial<GalaxyCacheConfig>) {
    this.cfg = { ...DEFAULT_CFG, ...cfg };
  }

  private key(coord: Vec3i): string {
    return `${coord[0]},${coord[1]},${coord[2]}`;
  }

  sector(coord: Vec3i): SectorDef {
    const k = this.key(coord);
    const cached = this.sectors.get(k);
    if (cached) {
      // refresh insertion order for LRU
      this.sectors.delete(k);
      this.sectors.set(k, cached);
      return cached;
    }
    const def = getSector(coord, this.ctx);
    this.sectors.set(k, def);
    this.evictIfNeeded();
    return def;
  }

  system(sectorCoord: Vec3i, systemIndex: number): SystemDef {
    const sector = this.sector(sectorCoord);
    return getSystem(sector, systemIndex, this.ctx);
  }

  sectorsInRadius(center: Vec3i, radius: number): SectorDef[] {
    const out: SectorDef[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          out.push(this.sector([center[0] + dx, center[1] + dy, center[2] + dz]));
        }
      }
    }
    return out;
  }

  clear() {
    this.sectors.clear();
  }

  private evictIfNeeded() {
    while (this.sectors.size > this.cfg.maxSectors) {
      const oldestKey = this.sectors.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.sectors.delete(oldestKey);
    }
  }
}

