/**
 * HUDController - Manages flight mode HUD elements
 * Handles flight instruments, targeting brackets, capital ship panels, mission status
 */

import * as THREE from "three";
import { hasComponent } from "bitecs";
import {
  Transform,
  Velocity,
  Ship,
  Shield,
  Health,
  LaserWeapon,
  Targeting,
  HitRadius,
  Team,
  CapitalShipV2,
  Subsystem,
  getTorpedoState,
  computeInterceptTime
} from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import type { FlightScenario } from "../types";
import type { SystemDef } from "@xwingz/procgen";
import type {
  FlightHudElements,
  MissionRuntime,
  YavinDefenseState,
  StarDestroyerMissionState,
  ScreenPoint
} from "./types";

// Local copies of const enums
const SubsystemType = {
  Bridge: 0,
  ShieldGen: 1,
  Engines: 2,
  Targeting: 3,
  Power: 4,
  Hangar: 5
} as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class HUDController {
  private elements: FlightHudElements | null = null;

  // Targeting state
  private lockValue = 0;
  private lockTargetEid = -1;

  // Temp vectors for HUD calculations (reused to avoid allocations)
  private tmpMat = new THREE.Matrix4();
  private tmpNdc = new THREE.Vector3();
  private tmpHudTargetPos = new THREE.Vector3();
  private tmpHudLeadPos = new THREE.Vector3();
  private tmpHudQ = new THREE.Quaternion();
  private tmpHudForward = new THREE.Vector3();
  private tmpHudDir = new THREE.Vector3();
  private tmpTargetScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };
  private tmpLeadScreen: ScreenPoint = { x: 0, y: 0, onScreen: false, behind: false };

  /**
   * Setup HUD elements
   */
  setup(ctx: ModeContext): void {
    ctx.hud.className = "hud-xwing";
    ctx.hud.innerHTML = `
      <div class="hud-reticle">
        <div class="reticle-circle"></div>
        <div class="reticle-cross"></div>
      </div>
      <div class="hud-top">
        <div id="hud-target" class="hud-target">NO TARGET</div>
        <div id="hud-lock" class="hud-lock">LOCK 0%</div>
        <div id="hud-mission" class="hud-mission"></div>
      </div>
      <div id="hud-bracket" class="hud-bracket hidden"></div>
      <div id="hud-lead" class="hud-lead hidden"></div>
      <div id="hud-land-prompt" class="hud-land-prompt hidden">PRESS L TO LAND</div>
      <div class="hud-left">
        <div class="hud-label">SPD</div>
        <div id="hud-speed" class="hud-value">0</div>
        <div class="hud-label">THR</div>
        <div id="hud-throttle" class="hud-value">0%</div>
        <div class="hud-label">SHD</div>
        <div id="hud-shield" class="hud-value">0</div>
        <div class="hud-label">HP</div>
        <div id="hud-hp" class="hud-value">0</div>
        <div class="hud-label">TORP</div>
        <div id="hud-torpedo" class="hud-value">0/0</div>
      </div>
      <div class="hud-right">
        <div class="hud-label">SYS</div>
        <div id="hud-system" class="hud-value"></div>
        <div class="hud-label">FAC</div>
        <div id="hud-faction" class="hud-value"></div>
        <div class="hud-label">CR</div>
        <div id="hud-credits" class="hud-value">0</div>
      </div>
      <div class="hud-bottom">
        <div class="hud-label">HYPERSPACE: H</div>
        <div class="hud-label">TARGET: T</div>
        <div class="hud-label">MAP: M</div>
        <div class="hud-label">BOOST: SHIFT</div>
        <div class="hud-label">BRAKE: X</div>
        <div class="hud-label">TORP: C</div>
        <div class="hud-label">SWITCH: V</div>
        <div class="hud-label">UPGRADES: U</div>
      </div>
      <div id="hud-capital" class="hud-capital-panel hidden">
        <div class="hud-capital-title">IMPERIAL STAR DESTROYER</div>
        <div class="hud-shield-arc">
          <div class="hud-shield-section">
            <div class="hud-shield-label">FRONT SHIELD</div>
            <div class="hud-shield-bar"><div id="hud-cap-shield-front" class="hud-shield-fill" style="width:100%"></div></div>
          </div>
          <div class="hud-shield-section">
            <div class="hud-shield-label">REAR SHIELD</div>
            <div class="hud-shield-bar"><div id="hud-cap-shield-rear" class="hud-shield-fill" style="width:100%"></div></div>
          </div>
        </div>
        <div class="hud-capital-hull">
          <div class="hud-hull-section">
            <div class="hud-hull-label">FORE</div>
            <div class="hud-hull-bar"><div id="hud-cap-hull-fore" class="hud-hull-fill" style="width:100%"></div></div>
          </div>
          <div class="hud-hull-section">
            <div class="hud-hull-label">MID</div>
            <div class="hud-hull-bar"><div id="hud-cap-hull-mid" class="hud-hull-fill" style="width:100%"></div></div>
          </div>
          <div class="hud-hull-section">
            <div class="hud-hull-label">AFT</div>
            <div class="hud-hull-bar"><div id="hud-cap-hull-aft" class="hud-hull-fill" style="width:100%"></div></div>
          </div>
        </div>
        <div id="hud-cap-subsystems" class="hud-subsystem-list"></div>
      </div>
    `;

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = ctx.hud.querySelector<T>(sel);
      if (!el) throw new Error(`HUD element not found: ${sel}`);
      return el;
    };

    this.elements = {
      speed: q<HTMLDivElement>("#hud-speed"),
      throttle: q<HTMLDivElement>("#hud-throttle"),
      shield: q<HTMLDivElement>("#hud-shield"),
      hp: q<HTMLDivElement>("#hud-hp"),
      torpedo: q<HTMLDivElement>("#hud-torpedo"),
      system: q<HTMLDivElement>("#hud-system"),
      faction: q<HTMLDivElement>("#hud-faction"),
      credits: q<HTMLDivElement>("#hud-credits"),
      target: q<HTMLDivElement>("#hud-target"),
      lock: q<HTMLDivElement>("#hud-lock"),
      mission: q<HTMLDivElement>("#hud-mission"),
      bracket: q<HTMLDivElement>("#hud-bracket"),
      lead: q<HTMLDivElement>("#hud-lead"),
      landPrompt: q<HTMLDivElement>("#hud-land-prompt"),
      capitalPanel: q<HTMLDivElement>("#hud-capital"),
      capShieldFront: q<HTMLDivElement>("#hud-cap-shield-front"),
      capShieldRear: q<HTMLDivElement>("#hud-cap-shield-rear"),
      capHullFore: q<HTMLDivElement>("#hud-cap-hull-fore"),
      capHullMid: q<HTMLDivElement>("#hud-cap-hull-mid"),
      capHullAft: q<HTMLDivElement>("#hud-cap-hull-aft"),
      capSubsystems: q<HTMLDivElement>("#hud-cap-subsystems")
    };
  }

  /**
   * Reset HUD state
   */
  reset(): void {
    this.elements = null;
    this.lockValue = 0;
    this.lockTargetEid = -1;
  }

  /**
   * Update all HUD elements
   */
  update(
    ctx: ModeContext,
    state: {
      shipEid: number | null;
      scenario: FlightScenario;
      currentSystem: SystemDef | null;
      playerDead: boolean;
      canLand: boolean;
      baseEid: number | null;
      mission: MissionRuntime | null;
      yavin: YavinDefenseState | null;
      starDestroyerMission: StarDestroyerMissionState | null;
      capitalShipEids: number[];
      subsystemMeshes: Map<number, THREE.Object3D>;
    },
    dt = 1 / 60
  ): void {
    const els = this.elements;
    if (!els) return;

    const { shipEid, scenario, currentSystem, playerDead, canLand, baseEid, mission, yavin, starDestroyerMission } = state;

    // Calculate base HP for Yavin
    const yavinState = scenario === "yavin_defense" ? yavin : null;
    const baseHp =
      yavinState && baseEid !== null && hasComponent(ctx.world, Health, baseEid)
        ? Health.hp[baseEid] ?? 0
        : 0;

    // Player dead state
    if (shipEid === null) {
      this.updateDeadState(ctx, els, currentSystem, yavinState, starDestroyerMission, mission, baseHp, playerDead);
      return;
    }

    // Update flight instruments
    this.updateInstruments(ctx, els, shipEid, currentSystem);

    // Update mission status
    this.updateMissionStatus(els, yavinState, starDestroyerMission, mission, baseHp);

    // Update targeting
    const teid = Targeting.targetEid[shipEid] ?? -1;
    if (teid !== this.lockTargetEid) {
      this.lockTargetEid = teid;
      this.lockValue = 0;
    }

    if (teid >= 0 && Transform.x[teid] !== undefined) {
      this.updateTargetBracket(ctx, els, shipEid, teid, dt);
    } else {
      els.target.textContent = "NO TARGET";
      els.bracket.classList.add("hidden");
      els.lead.classList.add("hidden");
      this.lockValue = 0;
      this.lockTargetEid = -1;
      els.lock.textContent = "LOCK 0%";
    }

    // Landing prompt
    els.landPrompt.classList.toggle("hidden", !canLand);

    // Capital ship HUD
    this.updateCapitalShipHud(ctx, state);
  }

  /**
   * Update HUD when player is dead
   */
  private updateDeadState(
    ctx: ModeContext,
    els: FlightHudElements,
    currentSystem: SystemDef | null,
    yavinState: YavinDefenseState | null,
    starDestroyerMission: StarDestroyerMissionState | null,
    mission: MissionRuntime | null,
    baseHp: number,
    playerDead: boolean
  ): void {
    els.speed.textContent = "0";
    els.throttle.textContent = "0%";
    els.shield.textContent = "0/0";
    els.hp.textContent = "0/0";
    els.torpedo.textContent = "0/0";

    if (currentSystem) {
      els.system.textContent = currentSystem.id;
      els.faction.textContent = currentSystem.controllingFaction;
    }
    els.credits.textContent = ctx.profile.credits.toString();

    this.updateMissionStatus(els, yavinState, starDestroyerMission, mission, baseHp);

    els.target.textContent = playerDead ? "SHIP DESTROYED" : "NO TARGET";
    els.lock.textContent =
      playerDead && (yavinState || starDestroyerMission)
        ? "PRESS H TO RESTART"
        : playerDead
          ? "RESPAWNING..."
          : "LOCK 0%";
    els.bracket.classList.add("hidden");
    els.lead.classList.add("hidden");
  }

  /**
   * Update flight instruments (speed, throttle, shields, HP, torpedoes)
   */
  private updateInstruments(ctx: ModeContext, els: FlightHudElements, shipEid: number, currentSystem: SystemDef | null): void {
    const v = Math.hypot(
      Velocity.vx[shipEid],
      Velocity.vy[shipEid],
      Velocity.vz[shipEid]
    ) || 0;
    const t = Ship.throttle[shipEid] || 0;
    const sp = Shield.sp[shipEid] ?? 0;
    const maxSp = Shield.maxSp[shipEid] ?? 0;
    const hpSelf = Health.hp[shipEid] ?? 0;
    const maxHpSelf = Health.maxHp[shipEid] ?? 0;

    els.speed.textContent = v.toFixed(0);
    els.throttle.textContent = `${Math.round(t * 100)}%`;
    els.shield.textContent = `${sp.toFixed(0)}/${maxSp.toFixed(0)}`;
    els.hp.textContent = `${hpSelf.toFixed(0)}/${maxHpSelf.toFixed(0)}`;

    // Torpedo status
    const torpState = getTorpedoState(ctx.world);
    if (torpState) {
      const lockStr =
        torpState.lockProgress >= 1
          ? "LOCKED"
          : torpState.lockProgress > 0
            ? `${Math.round(torpState.lockProgress * 100)}%`
            : "";
      els.torpedo.textContent = `${torpState.ammo}/${torpState.maxAmmo}${lockStr ? " " + lockStr : ""}`;
      els.torpedo.style.color = torpState.lockProgress >= 1 ? "#ff4444" : "#88ff88";
    } else {
      els.torpedo.textContent = "0/0";
      els.torpedo.style.color = "#88ff88";
    }

    if (currentSystem) {
      els.system.textContent = currentSystem.id;
      els.faction.textContent = currentSystem.controllingFaction;
    }
    els.credits.textContent = ctx.profile.credits.toString();
  }

  /**
   * Update mission status message
   */
  private updateMissionStatus(
    els: FlightHudElements,
    yavinState: YavinDefenseState | null,
    starDestroyerMission: StarDestroyerMissionState | null,
    mission: MissionRuntime | null,
    baseHp: number
  ): void {
    if (yavinState) {
      if (yavinState.messageTimer > 0) {
        els.mission.textContent = yavinState.message;
      } else if (yavinState.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (yavinState.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        els.mission.textContent = `DEFEND GREAT TEMPLE: ${yavinState.enemiesKilled}/${yavinState.enemiesTotal}  BASE ${Math.max(0, baseHp).toFixed(0)}/${yavinState.baseHpMax}`;
      }
    } else if (starDestroyerMission) {
      const sdm = starDestroyerMission;
      if (sdm.messageTimer > 0) {
        els.mission.textContent = sdm.message;
      } else if (sdm.phase === "success") {
        els.mission.textContent = "VICTORY - PRESS M FOR MAP OR H TO RESTART";
      } else if (sdm.phase === "fail") {
        els.mission.textContent = "MISSION FAILED - PRESS H TO RESTART";
      } else {
        const phaseText = sdm.phase === "approach" ? "CLEAR TIES" :
                         sdm.phase === "shields" ? "DESTROY SHIELDS" :
                         sdm.phase === "subsystems" ? "TARGET SUBSYSTEMS" : "ATTACK HULL";
        els.mission.textContent = `DESTROY STAR DESTROYER: ${phaseText}  ${sdm.subsystemsDestroyed}/${sdm.totalSubsystems} SYSTEMS`;
      }
    } else if (mission) {
      if (mission.messageTimer > 0) {
        els.mission.textContent = mission.message;
      } else if (mission.completed) {
        els.mission.textContent = "MISSION COMPLETE — PRESS H TO JUMP";
      } else {
        els.mission.textContent =
          `${mission.def.title}: ${mission.kills}/${mission.def.goalKills}  ` +
          `REWARD ${mission.def.rewardCredits} CR`;
      }
    } else {
      els.mission.textContent = "";
    }
  }

  /**
   * Update targeting bracket and lead pip
   */
  private updateTargetBracket(
    ctx: ModeContext,
    els: FlightHudElements,
    shipEid: number,
    teid: number,
    dtSeconds: number
  ): void {
    const sx = Transform.x[shipEid] ?? 0;
    const sy = Transform.y[shipEid] ?? 0;
    const sz = Transform.z[shipEid] ?? 0;

    const tx = Transform.x[teid] ?? 0;
    const ty = Transform.y[teid] ?? 0;
    const tz = Transform.z[teid] ?? 0;

    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const hp = Health.hp[teid] ?? 0;
    els.target.textContent = `TGT ${teid}  ${dist.toFixed(0)}m  HP ${hp.toFixed(0)}`;

    // Bracket on target
    const screen = this.projectToScreen(ctx, this.tmpHudTargetPos.set(tx, ty, tz), this.tmpTargetScreen);
    els.bracket.classList.remove("hidden");
    els.bracket.classList.toggle("offscreen", !screen.onScreen);
    els.bracket.classList.toggle("behind", screen.behind);
    els.bracket.style.left = `${screen.x}px`;
    els.bracket.style.top = `${screen.y}px`;

    // Lead pip
    const projSpeed = LaserWeapon.projectileSpeed[shipEid] ?? 900;
    const tvx = Velocity.vx[teid] ?? 0;
    const tvy = Velocity.vy[teid] ?? 0;
    const tvz = Velocity.vz[teid] ?? 0;
    const svx = Velocity.vx[shipEid] ?? 0;
    const svy = Velocity.vy[shipEid] ?? 0;
    const svz = Velocity.vz[shipEid] ?? 0;
    const rvx = tvx - svx;
    const rvy = tvy - svy;
    const rvz = tvz - svz;
    const leadTime = computeInterceptTime(dx, dy, dz, rvx, rvy, rvz, projSpeed) ?? dist / projSpeed;
    const leadPos = this.tmpHudLeadPos.set(tx + tvx * leadTime, ty + tvy * leadTime, tz + tvz * leadTime);
    const leadScreen = this.projectToScreen(ctx, leadPos, this.tmpLeadScreen);
    els.lead.classList.toggle("hidden", !leadScreen.onScreen);
    if (leadScreen.onScreen) {
      els.lead.style.left = `${leadScreen.x}px`;
      els.lead.style.top = `${leadScreen.y}px`;
    }

    // Lock meter
    const q = this.tmpHudQ.set(
      Transform.qx[shipEid] ?? 0,
      Transform.qy[shipEid] ?? 0,
      Transform.qz[shipEid] ?? 0,
      Transform.qw[shipEid] ?? 1
    );
    const forward = this.tmpHudForward.set(0, 0, -1).applyQuaternion(q).normalize();
    const dir = this.tmpHudDir.set(dx, dy, dz).normalize();
    const dot = forward.dot(dir);
    const radius = HitRadius.r[teid] ?? 8;
    const sizeAngle = Math.atan2(radius, dist);
    const baseCone = 0.07;
    const cone = baseCone + sizeAngle;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const inCone = screen.onScreen && angle < cone && dist < 900;

    const lockGain = 1.8;
    const lockDecay = 0.6;
    this.lockValue += (inCone ? lockGain : -lockDecay) * dtSeconds;
    this.lockValue = Math.min(1, Math.max(0, this.lockValue));

    const pct = Math.round(this.lockValue * 100);
    els.lock.textContent = this.lockValue >= 1 ? "LOCK" : `LOCK ${pct}%`;
  }

  /**
   * Update capital ship HUD panel
   */
  private updateCapitalShipHud(
    ctx: ModeContext,
    state: {
      capitalShipEids: number[];
      subsystemMeshes: Map<number, THREE.Object3D>;
    }
  ): void {
    const els = this.elements;
    if (!els) return;

    // Hide if no capital ships
    if (state.capitalShipEids.length === 0) {
      els.capitalPanel.classList.add("hidden");
      return;
    }

    // Get the first capital ship
    const shipEid = state.capitalShipEids[0]!;
    if (!hasComponent(ctx.world, CapitalShipV2, shipEid)) {
      els.capitalPanel.classList.add("hidden");
      return;
    }

    els.capitalPanel.classList.remove("hidden");

    // Shield bars
    const shieldFront = CapitalShipV2.shieldFront[shipEid] ?? 0;
    const shieldRear = CapitalShipV2.shieldRear[shipEid] ?? 0;
    const shieldMax = CapitalShipV2.shieldMax[shipEid] ?? 1;
    els.capShieldFront.style.width = `${(shieldFront / shieldMax) * 100}%`;
    els.capShieldRear.style.width = `${(shieldRear / shieldMax) * 100}%`;

    // Hull section bars
    const hullFore = CapitalShipV2.hullFore[shipEid] ?? 0;
    const hullMid = CapitalShipV2.hullMid[shipEid] ?? 0;
    const hullAft = CapitalShipV2.hullAft[shipEid] ?? 0;
    const hullForeMax = CapitalShipV2.hullForeMax[shipEid] ?? 1;
    const hullMidMax = CapitalShipV2.hullMidMax[shipEid] ?? 1;
    const hullAftMax = CapitalShipV2.hullAftMax[shipEid] ?? 1;

    const setHullBarClass = (el: HTMLDivElement, current: number, max: number) => {
      const pct = current / max;
      el.style.width = `${pct * 100}%`;
      el.className = "hud-hull-fill" + (pct < 0.25 ? " critical" : pct < 0.5 ? " damaged" : "");
    };

    setHullBarClass(els.capHullFore, hullFore, hullForeMax);
    setHullBarClass(els.capHullMid, hullMid, hullMidMax);
    setHullBarClass(els.capHullAft, hullAft, hullAftMax);

    // Update subsystems list
    const subsystemNames: Record<number, string> = {
      0: "BRIDGE",
      1: "SHIELD GEN",
      2: "ENGINES",
      3: "TARGETING",
      4: "POWER",
      5: "HANGAR"
    };
    const subsystemIcons: Record<number, string> = {
      0: "bridge",
      1: "shield",
      2: "engine",
      3: "targeting",
      4: "power",
      5: "hangar"
    };

    // Build subsystem list HTML
    let subsystemHtml = "";
    for (const [sid] of state.subsystemMeshes) {
      if (!hasComponent(ctx.world, Subsystem, sid)) continue;
      if ((Subsystem.parentEid[sid] ?? -1) !== shipEid) continue;

      const type = Subsystem.subsystemType[sid] ?? 0;
      const hp = Subsystem.hp[sid] ?? 0;
      const maxHp = Subsystem.maxHp[sid] ?? 1;
      const disabled = Subsystem.disabled[sid] === 1;
      const name = subsystemNames[type] ?? "UNKNOWN";
      const iconClass = subsystemIcons[type] ?? "power";
      const pct = Math.max(0, Math.round((hp / maxHp) * 100));

      subsystemHtml += `
        <div class="hud-subsystem${disabled ? " destroyed" : ""}">
          <div class="hud-subsystem-icon ${iconClass}"></div>
          <span>${name}</span>
          <span class="hud-subsystem-hp">${disabled ? "DISABLED" : pct + "%"}</span>
        </div>
      `;
    }
    els.capSubsystems.innerHTML = subsystemHtml;
  }

  /**
   * Project world position to screen coordinates
   */
  private projectToScreen(ctx: ModeContext, pos: THREE.Vector3, out: ScreenPoint): ScreenPoint {
    const v = this.tmpNdc.copy(pos).project(ctx.camera);
    const w = ctx.renderer.domElement.clientWidth || window.innerWidth;
    const h = ctx.renderer.domElement.clientHeight || window.innerHeight;

    let nx = v.x;
    let ny = v.y;
    const behind = v.z > 1;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }

    const onScreen = !behind && v.z > -1 && v.z < 1 && nx > -1 && nx < 1 && ny > -1 && ny < 1;

    const margin = 0.92;
    const cx = clamp(nx, -margin, margin);
    const cy = clamp(ny, -margin, margin);
    out.x = (cx * 0.5 + 0.5) * w;
    out.y = (-cy * 0.5 + 0.5) * h;
    out.onScreen = onScreen;
    out.behind = behind;
    return out;
  }
}
