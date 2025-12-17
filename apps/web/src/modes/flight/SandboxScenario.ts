/**
 * SandboxScenario - Standard space combat missions with hyperspace jumping
 */

import * as THREE from "three";
import { createRng, deriveSeed, GalaxyCache, type SystemDef } from "@xwingz/procgen";
import { Transform, Velocity, Targeting } from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import type { ExplosionManager } from "../../rendering/effects";
import {
  type FlightHudElements,
  type MissionRuntime,
  type TargetBracketState
} from "./FlightScenarioTypes";
import {
  createStarfield,
  disposeStarfield,
  spawnEnemyFighters,
  syncTargets,
  createMission,
  updatePlayerHudValues,
  updateSystemInfo,
  updateTargetBracket,
  clearTargetBracket
} from "./FlightShared";

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox Scenario Context
// ─────────────────────────────────────────────────────────────────────────────

export interface SandboxContext {
  ctx: ModeContext;
  currentSystem: SystemDef;
  shipEid: number | null;
  targetEids: number[];
  targetMeshes: Map<number, THREE.Object3D>;
  projectileMeshes: Map<number, THREE.Mesh>;
  explosions: ExplosionManager | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox Scenario Handler
// ─────────────────────────────────────────────────────────────────────────────

export class SandboxScenario {
  // Galaxy cache for hyperspace
  private cache: GalaxyCache;
  private jumpIndex = 0;

  // Starfield
  private starfield: THREE.Points | null = null;

  // Mission state
  private mission: MissionRuntime | null = null;

  // Targeting state
  private lockState: TargetBracketState = { lockValue: 0, lockTargetEid: -1 };

  constructor() {
    this.cache = new GalaxyCache({ globalSeed: 42n }, { maxSectors: 256 });
  }

  enter(sctx: SandboxContext): void {
    this.jumpIndex = 0;
    this.mission = null;
    this.lockState = { lockValue: 0, lockTargetEid: -1 };

    // Build starfield
    this.starfield = createStarfield(sctx.currentSystem.seed);
    sctx.ctx.scene.add(this.starfield);

    // Start mission
    this.startMission(sctx);
  }

  tick(sctx: SandboxContext, dt: number): boolean {
    // Sync targets and handle kills
    const syncResult = syncTargets(
      sctx.ctx,
      sctx.ctx.scene,
      sctx.targetMeshes,
      sctx.explosions
    );
    // Update array in place to preserve FlightMode's reference
    sctx.targetEids.length = 0;
    sctx.targetEids.push(...syncResult.targetEids);

    if (syncResult.killedCount > 0 && sctx.shipEid !== null && this.mission && !this.mission.completed) {
      this.mission.kills += syncResult.killedCount;
      sctx.ctx.profile.credits += syncResult.killedCount * 5;

      if (this.mission.kills >= this.mission.def.goalKills) {
        this.mission.kills = this.mission.def.goalKills;
        this.mission.completed = true;
        sctx.ctx.profile.credits += this.mission.def.rewardCredits;
        sctx.ctx.profile.missionTier += 1;
        this.mission.message = `MISSION COMPLETE  +${this.mission.def.rewardCredits} CR`;
        this.mission.messageTimer = 4;
      }
      sctx.ctx.scheduleSave();
    }

    // Spawn next wave if needed
    if (
      this.mission &&
      !this.mission.completed &&
      this.mission.kills < this.mission.def.goalKills &&
      sctx.targetEids.length === 0
    ) {
      this.spawnMissionWave(sctx);
    }

    // Update mission message timer
    if (this.mission && this.mission.messageTimer > 0) {
      this.mission.messageTimer = Math.max(0, this.mission.messageTimer - dt);
    }

    return false; // Don't exit flight mode
  }

  handleHyperspace(sctx: SandboxContext): boolean {
    this.hyperspaceJump(sctx);
    return false; // We handled it, don't process default
  }

  updateHud(sctx: SandboxContext, els: FlightHudElements, dt: number): void {
    updatePlayerHudValues(els, sctx.shipEid, sctx.ctx);
    updateSystemInfo(els, sctx.currentSystem, sctx.ctx.profile.credits);

    // Mission message
    if (this.mission) {
      if (this.mission.messageTimer > 0) {
        els.mission.textContent = this.mission.message;
      } else if (this.mission.completed) {
        els.mission.textContent = "MISSION COMPLETE — PRESS H TO JUMP";
      } else {
        els.mission.textContent =
          `${this.mission.def.title}: ${this.mission.kills}/${this.mission.def.goalKills}  ` +
          `REWARD ${this.mission.def.rewardCredits} CR`;
      }
    }

    // Target bracket
    if (sctx.shipEid !== null) {
      const teid = this.getTargetEid(sctx);
      if (teid >= 0 && Transform.x[teid] !== undefined) {
        this.lockState = updateTargetBracket(sctx.ctx, els, sctx.shipEid, teid, this.lockState, dt);
      } else {
        clearTargetBracket(els);
        this.lockState = { lockValue: 0, lockTargetEid: -1 };
      }
    }
  }

  getMissionMessage(_sctx: SandboxContext): string {
    if (!this.mission) return "";
    if (this.mission.messageTimer > 0) return this.mission.message;
    if (this.mission.completed) return "MISSION COMPLETE — PRESS H TO JUMP";
    return `${this.mission.def.title}: ${this.mission.kills}/${this.mission.def.goalKills}`;
  }

  canLand(_sctx: SandboxContext): boolean {
    return false; // No landing in sandbox
  }

  exit(sctx: SandboxContext): void {
    disposeStarfield(sctx.ctx.scene, this.starfield);
    this.starfield = null;
    this.mission = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private getTargetEid(sctx: SandboxContext): number {
    if (sctx.shipEid === null) return -1;
    return Targeting.targetEid[sctx.shipEid] ?? -1;
  }

  private startMission(sctx: SandboxContext): void {
    this.mission = createMission(sctx.currentSystem, sctx.ctx.profile.missionTier);
    this.spawnMissionWave(sctx);
  }

  private spawnMissionWave(sctx: SandboxContext): void {
    if (!this.mission) return;
    const key = `${this.mission.def.id}:wave:${this.mission.wave}`;
    this.mission.wave += 1;

    const result = spawnEnemyFighters(
      sctx.ctx,
      sctx.ctx.scene,
      sctx.currentSystem,
      key,
      sctx.targetEids,
      sctx.targetMeshes
    );
    sctx.targetEids = result.targetEids;
    // Note: targetMeshes is mutated in place
  }

  private hyperspaceJump(sctx: SandboxContext): void {
    const neighbors = this.cache
      .sectorsInRadius(sctx.currentSystem.sectorCoord, 1)
      .flatMap((sector) => sector.systems.map((_, i) => this.cache.system(sector.coord, i)))
      .filter((s) => s.id !== sctx.currentSystem.id);

    if (neighbors.length === 0) return;

    const jumpSeed = deriveSeed(sctx.currentSystem.seed, "jump", this.jumpIndex++);
    const rng = createRng(jumpSeed);
    const next = rng.pick(neighbors);

    // Update starfield
    disposeStarfield(sctx.ctx.scene, this.starfield);
    this.starfield = createStarfield(next.seed);
    sctx.ctx.scene.add(this.starfield);

    // Update system reference (caller should update their reference too)
    (sctx as { currentSystem: SystemDef }).currentSystem = next;

    // Clear projectiles handled by FlightMode
    // Start new mission
    this.mission = createMission(next, sctx.ctx.profile.missionTier);
    const result = spawnEnemyFighters(
      sctx.ctx,
      sctx.ctx.scene,
      next,
      `${this.mission.def.id}:wave:0`,
      sctx.targetEids,
      sctx.targetMeshes
    );
    sctx.targetEids = result.targetEids;
    this.mission.wave = 1;

    // Reset player position
    if (sctx.shipEid !== null) {
      Transform.x[sctx.shipEid] = 0;
      Transform.y[sctx.shipEid] = 0;
      Transform.z[sctx.shipEid] = 0;
      Velocity.vx[sctx.shipEid] = 0;
      Velocity.vy[sctx.shipEid] = 0;
      Velocity.vz[sctx.shipEid] = 0;
    }
  }

  // For external access to updated system after jump
  getCurrentSystem(sctx: SandboxContext): SystemDef {
    return sctx.currentSystem;
  }
}
