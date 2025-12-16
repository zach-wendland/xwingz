/**
 * ConquestMode - Real-time galactic conquest strategic view
 *
 * Enhanced graphics with:
 * - Faction-colored planets with glow effects
 * - Hyperspace fleet trails
 * - Battle indicators with particle effects
 * - Dynamic lighting based on galactic state
 */

import * as THREE from "three";
import { PLANETS, planetToSystem } from "@xwingz/data";
import { CONQUEST_FACTION, CONQUEST_PHASE } from "@xwingz/gameplay";
import { SeededRNG } from "@xwingz/core";
import { getPlanetTexture, clearPlanetTextureCache, createProceduralShip } from "@xwingz/render";
import type { ModeHandler, ModeContext, ModeTransitionData } from "./types";
import { disposeObject } from "../rendering/MeshManager";
import {
  GalaxySimulation,
  type GalaxyPlanetState,
  type GalaxyFleetState
} from "../conquest/GalaxySimulation";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const GALAXY_SCALE = 1000;

// Faction colors (Empire uses Imperial blue/gray per Star Wars canon)
const FACTION_COLORS = {
  [CONQUEST_FACTION.NEUTRAL]: 0x888888,
  [CONQUEST_FACTION.REBEL]: 0xff6644,
  [CONQUEST_FACTION.EMPIRE]: 0x4488ff  // Imperial blue (green reserved for lasers)
} as const;

const FACTION_GLOW = {
  [CONQUEST_FACTION.NEUTRAL]: 0x444444,
  [CONQUEST_FACTION.REBEL]: 0xff2200,
  [CONQUEST_FACTION.EMPIRE]: 0x2266ff  // Imperial blue glow
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ConquestMode Class
// ─────────────────────────────────────────────────────────────────────────────

export class ConquestMode implements ModeHandler {
  // Galaxy simulation (exposed for testing)
  public simulation: GalaxySimulation | null = null;

  // Three.js objects
  private planetMeshes: THREE.Group[] = [];
  private fleetMeshes: Map<number, THREE.Object3D> = new Map();
  private hyperspaceTrails: Map<number, THREE.Line> = new Map();
  private battleIndicators: Map<number, THREE.Object3D> = new Map();
  private starfield: THREE.Points | null = null;
  private nebula: THREE.Mesh | null = null;
  private selectionRing: THREE.Mesh | null = null;

  // State (exposed for testing)
  public selectedPlanetIndex = -1;
  private hoveredPlanetIndex = -1;
  private gameSpeed = 1.0;
  private paused = false;

  // Input helpers
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Event handlers
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // Reusable objects (avoid allocations)
  // private tmpVec3 = new THREE.Vector3();
  // private tmpColor = new THREE.Color();

  enter(ctx: ModeContext, _data?: ModeTransitionData): void {
    ctx.controls.enabled = true;

    // Clear scene
    ctx.scene.clear();

    // Setup lighting
    this.setupLighting(ctx.scene);

    // Setup camera
    ctx.camera.position.set(0, 400, 800);
    ctx.camera.lookAt(0, 0, 0);

    // Initialize simulation
    this.simulation = new GalaxySimulation(ctx.world);
    this.simulation.initialize(42, CONQUEST_FACTION.REBEL);

    // Build visual galaxy
    this.buildStarfield(ctx.scene);
    this.buildNebula(ctx.scene);
    this.buildPlanets(ctx.scene);
    this.buildSelectionRing(ctx.scene);

    // Attach input handlers
    this.attachInputHandlers(ctx);

    // Update HUD
    this.updateHud(ctx);
  }

  tick(ctx: ModeContext, dt: number): void {
    if (!this.simulation) return;

    // Run simulation (unless paused)
    if (!this.paused) {
      this.simulation.tick(dt * this.gameSpeed);
    }

    // Update visual state
    this.updatePlanetVisuals();
    this.updateFleetVisuals(ctx.scene);
    this.updateBattleIndicators(ctx.scene, dt);
    this.updateSelectionRing();

    // Rotate nebula slowly
    if (this.nebula) {
      this.nebula.rotation.y += dt * 0.02;
    }

    // Update controls and render
    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);

    // Update HUD periodically
    this.updateHud(ctx);
  }

  exit(ctx: ModeContext): void {
    this.detachInputHandlers();

    // Cleanup meshes (including sprite textures)
    for (const group of this.planetMeshes) {
      group.traverse((child) => {
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
      ctx.scene.remove(group);
      disposeObject(group);
    }
    this.planetMeshes = [];

    for (const mesh of this.fleetMeshes.values()) {
      ctx.scene.remove(mesh);
      disposeObject(mesh);
    }
    this.fleetMeshes.clear();

    for (const trail of this.hyperspaceTrails.values()) {
      ctx.scene.remove(trail);
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
    }
    this.hyperspaceTrails.clear();

    for (const indicator of this.battleIndicators.values()) {
      ctx.scene.remove(indicator);
      disposeObject(indicator);
    }
    this.battleIndicators.clear();

    if (this.starfield) {
      ctx.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
      this.starfield = null;
    }

    if (this.nebula) {
      ctx.scene.remove(this.nebula);
      disposeObject(this.nebula);
      this.nebula = null;
    }

    if (this.selectionRing) {
      ctx.scene.remove(this.selectionRing);
      disposeObject(this.selectionRing);
      this.selectionRing = null;
    }

    // Reset simulation
    if (this.simulation) {
      this.simulation.reset();
      this.simulation = null;
    }

    // Clear planet texture cache
    clearPlanetTextureCache();

    this.selectedPlanetIndex = -1;
    this.hoveredPlanetIndex = -1;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene Setup
  // ─────────────────────────────────────────────────────────────────────────────

  private setupLighting(scene: THREE.Scene): void {
    // Ambient for base visibility
    scene.add(new THREE.AmbientLight(0x303050, 0.6));

    // Main directional (sun-like)
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(500, 800, 400);
    scene.add(sun);

    // Blue fill light
    const fill = new THREE.DirectionalLight(0x4488ff, 0.5);
    fill.position.set(-400, -200, -500);
    scene.add(fill);

    // Central galactic glow
    const coreGlow = new THREE.PointLight(0xffffcc, 0.8, 1200, 1.2);
    coreGlow.position.set(0, 100, 0);
    scene.add(coreGlow);
  }

  private buildStarfield(scene: THREE.Scene): void {
    const count = 4000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    // Use fixed seed for deterministic starfield
    const rng = new SeededRNG(42);

    for (let i = 0; i < count; i++) {
      const r = 3000 + rng.next() * 12000;
      const theta = rng.next() * Math.PI * 2;
      const phi = Math.acos(rng.next() * 2 - 1);

      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Color variation - blue/white stars
      const brightness = 0.6 + rng.next() * 0.4;
      colors[i * 3 + 0] = brightness * (0.8 + rng.next() * 0.2);
      colors[i * 3 + 1] = brightness * (0.85 + rng.next() * 0.15);
      colors[i * 3 + 2] = brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.5,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9
    });

    this.starfield = new THREE.Points(geometry, material);
    scene.add(this.starfield);
  }

  private buildNebula(scene: THREE.Scene): void {
    // Procedural nebula backdrop
    const geometry = new THREE.SphereGeometry(2500, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x1a0a30,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.6
    });

    this.nebula = new THREE.Mesh(geometry, material);
    scene.add(this.nebula);
  }

  private buildPlanets(scene: THREE.Scene): void {
    if (!this.simulation) return;

    const planets = this.simulation.getPlanets();

    for (const planet of planets) {
      const group = this.createPlanetMesh(planet);
      scene.add(group);
      this.planetMeshes.push(group);
    }
  }

  private createPlanetMesh(planet: GalaxyPlanetState): THREE.Group {
    const group = new THREE.Group();
    const pos = planet.planetDef.position;
    const scale = GALAXY_SCALE * 0.18;

    group.position.set(pos[0] * scale, 0, pos[1] * scale);
    group.userData.planetIndex = planet.planetIndex;

    // Get procedural planet texture
    const planetTexture = getPlanetTexture(
      planet.planetDef.style as any,
      planet.planetDef.id,
      256
    );

    // Planet sphere with textured material
    const planetGeo = new THREE.SphereGeometry(16, 32, 32);
    const planetMat = new THREE.MeshStandardMaterial({
      map: planetTexture,
      emissive: 0xffffff,
      emissiveMap: planetTexture,
      emissiveIntensity: 0.8,
      roughness: 0.8,
      metalness: 0.1
    });
    const planetMesh = new THREE.Mesh(planetGeo, planetMat);
    planetMesh.name = "planet";
    group.add(planetMesh);

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(19, 24, 24);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: FACTION_GLOW[planet.controller],
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    atmosMesh.name = "atmosphere";
    group.add(atmosMesh);

    // Faction ring indicator
    const ringGeo = new THREE.RingGeometry(22, 24, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: FACTION_COLORS[planet.controller],
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.name = "factionRing";
    group.add(ring);

    // Name label (sprite)
    const label = this.createTextSprite(planet.planetDef.name.toUpperCase());
    label.position.set(0, 32, 0);
    group.add(label);

    return group;
  }

  private createTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(50, 12.5, 1);
    return sprite;
  }

  private buildSelectionRing(scene: THREE.Scene): void {
    const geometry = new THREE.RingGeometry(28, 32, 64);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.selectionRing = new THREE.Mesh(geometry, material);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    scene.add(this.selectionRing);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Visual Updates
  // ─────────────────────────────────────────────────────────────────────────────

  private updatePlanetVisuals(): void {
    if (!this.simulation) return;

    const planets = this.simulation.getPlanets();

    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i]!;
      const group = this.planetMeshes[i];
      if (!group) continue;

      // Update faction colors
      const atmosMesh = group.getObjectByName("atmosphere") as THREE.Mesh | undefined;
      if (atmosMesh) {
        const mat = atmosMesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(FACTION_GLOW[planet.controller]);
        mat.opacity = planet.underAttack ? 0.6 : 0.3;
      }

      const ring = group.getObjectByName("factionRing") as THREE.Mesh | undefined;
      if (ring) {
        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.color.setHex(FACTION_COLORS[planet.controller]);
      }

      const planetMesh = group.getObjectByName("planet") as THREE.Mesh | undefined;
      if (planetMesh) {
        const mat = planetMesh.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(FACTION_COLORS[planet.controller]);
        mat.emissiveIntensity = planet.underAttack ? 0.4 : 0.15;
      }
    }
  }

  private updateFleetVisuals(scene: THREE.Scene): void {
    if (!this.simulation) return;

    const fleets = this.simulation.getFleets();
    const planets = this.simulation.getPlanets();
    const activeFleetEids = new Set(fleets.map((f) => f.eid));

    // Remove meshes for destroyed fleets
    for (const [eid, mesh] of this.fleetMeshes) {
      if (!activeFleetEids.has(eid)) {
        scene.remove(mesh);
        disposeObject(mesh);
        this.fleetMeshes.delete(eid);

        // Also clean up trails
        const trail = this.hyperspaceTrails.get(eid);
        if (trail) {
          scene.remove(trail);
          trail.geometry.dispose();
          (trail.material as THREE.Material).dispose();
          this.hyperspaceTrails.delete(eid);
        }
      }
    }

    for (const fleet of fleets) {
      let mesh = this.fleetMeshes.get(fleet.eid);

      // Create fleet mesh if needed
      if (!mesh) {
        mesh = this.createFleetMesh(fleet);
        scene.add(mesh);
        this.fleetMeshes.set(fleet.eid, mesh);
      }

      // Update position
      if (fleet.currentPlanetEid >= 0 && fleet.destinationPlanetEid < 0) {
        // At a planet
        const planet = planets.find((p) => p.eid === fleet.currentPlanetEid);
        if (planet) {
          const pos = planet.planetDef.position;
          const scale = GALAXY_SCALE * 0.18;
          mesh.position.set(pos[0] * scale + 30, 15, pos[1] * scale);
        }
        mesh.visible = true;

        // Remove hyperspace trail
        const trail = this.hyperspaceTrails.get(fleet.eid);
        if (trail) {
          scene.remove(trail);
          trail.geometry.dispose();
          (trail.material as THREE.Material).dispose();
          this.hyperspaceTrails.delete(fleet.eid);
        }
      } else if (fleet.destinationPlanetEid >= 0) {
        // In hyperspace
        const srcPlanet = planets.find((p) => p.eid === fleet.currentPlanetEid);
        const destPlanet = planets.find((p) => p.eid === fleet.destinationPlanetEid);

        if (srcPlanet && destPlanet) {
          const scale = GALAXY_SCALE * 0.18;
          const srcPos = new THREE.Vector3(
            srcPlanet.planetDef.position[0] * scale,
            15,
            srcPlanet.planetDef.position[1] * scale
          );
          const destPos = new THREE.Vector3(
            destPlanet.planetDef.position[0] * scale,
            15,
            destPlanet.planetDef.position[1] * scale
          );

          // Interpolate position
          const t = fleet.movementProgress;
          mesh.position.lerpVectors(srcPos, destPos, t);

          // Update or create hyperspace trail
          this.updateHyperspaceTrail(scene, fleet.eid, srcPos, mesh.position, fleet.faction);
        }
        mesh.visible = true;
      }

      // Update fleet color
      const fleetMat = (mesh.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial | undefined;
      if (fleetMat) {
        fleetMat.color.setHex(FACTION_COLORS[fleet.faction]);
      }
    }
  }

  private createFleetMesh(fleet: GalaxyFleetState): THREE.Group {
    const group = new THREE.Group();

    // Use faction-appropriate ship models for visual variety
    const isRebel = fleet.faction === CONQUEST_FACTION.REBEL;

    // Create a small representative ship (scales down for strategic view)
    if (fleet.capitalShips > 0) {
      // Capital fleet - show a mini star destroyer or nebulon-b
      const capShip = createProceduralShip({
        type: isRebel ? "nebulon_b" : "star_destroyer",
        scale: 0.15, // Very small for strategic map
        enableShadows: false
      });
      capShip.position.y = 8;
      group.add(capShip);
    } else {
      // Fighter fleet - show mini fighters
      const fighterType = isRebel ? "xwing" : "tie_ln";
      for (let i = 0; i < Math.min(fleet.fighterSquadrons, 3); i++) {
        const fighter = createProceduralShip({
          type: fighterType,
          scale: 0.3,
          enableShadows: false
        });
        fighter.position.set((i - 1) * 6, 8, 0);
        fighter.rotation.x = Math.PI / 6; // Angle upward slightly
        group.add(fighter);
      }
    }

    // Glow effect underneath to show faction and make visible from far
    const glowGeo = new THREE.CircleGeometry(12, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: FACTION_GLOW[fleet.faction],
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 2;
    group.add(glow);

    return group;
  }

  private updateHyperspaceTrail(
    scene: THREE.Scene,
    fleetEid: number,
    start: THREE.Vector3,
    current: THREE.Vector3,
    faction: number
  ): void {
    let trail = this.hyperspaceTrails.get(fleetEid);

    if (!trail) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        color: FACTION_COLORS[faction as keyof typeof FACTION_COLORS],
        transparent: true,
        opacity: 0.6
      });
      trail = new THREE.Line(geometry, material);
      scene.add(trail);
      this.hyperspaceTrails.set(fleetEid, trail);
    }

    const positions = new Float32Array([
      start.x, start.y, start.z,
      current.x, current.y, current.z
    ]);
    trail.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    trail.geometry.attributes.position!.needsUpdate = true;
  }

  private updateBattleIndicators(scene: THREE.Scene, _dt: number): void {
    if (!this.simulation) return;

    const planets = this.simulation.getPlanets();

    for (const planet of planets) {
      if (planet.underAttack) {
        let indicator = this.battleIndicators.get(planet.eid);

        if (!indicator) {
          indicator = this.createBattleIndicator();
          scene.add(indicator);
          this.battleIndicators.set(planet.eid, indicator);
        }

        // Position at planet
        const pos = planet.planetDef.position;
        const scale = GALAXY_SCALE * 0.18;
        indicator.position.set(pos[0] * scale, 40, pos[1] * scale);
        indicator.visible = true;

        // Pulse animation
        const pulseScale = 1 + Math.sin(Date.now() * 0.005) * 0.2;
        indicator.scale.setScalar(pulseScale);
      } else {
        const indicator = this.battleIndicators.get(planet.eid);
        if (indicator) {
          indicator.visible = false;
        }
      }
    }
  }

  private createBattleIndicator(): THREE.Object3D {
    const group = new THREE.Group();

    // Crossed swords icon (simplified as X)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.9
    });

    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 2), mat);
    bar1.rotation.z = Math.PI / 4;
    group.add(bar1);

    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 2), mat);
    bar2.rotation.z = -Math.PI / 4;
    group.add(bar2);

    // Glow ring
    const ringGeo = new THREE.RingGeometry(12, 15, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);

    return group;
  }

  private updateSelectionRing(): void {
    if (!this.selectionRing || this.selectedPlanetIndex < 0) {
      if (this.selectionRing) this.selectionRing.visible = false;
      return;
    }

    const group = this.planetMeshes[this.selectedPlanetIndex];
    if (!group) return;

    this.selectionRing.position.copy(group.position);
    this.selectionRing.position.y = 1;
    this.selectionRing.visible = true;

    // Animate rotation
    this.selectionRing.rotation.z += 0.01;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private attachInputHandlers(ctx: ModeContext): void {
    this.keyHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          ctx.requestModeChange("map", { type: "map" });
          break;
        case " ":
          this.paused = !this.paused;
          break;
        case "+":
        case "=":
          this.gameSpeed = Math.min(4, this.gameSpeed + 0.5);
          break;
        case "-":
          this.gameSpeed = Math.max(0.25, this.gameSpeed - 0.25);
          break;
        case "Enter":
          this.enterSelectedPlanet(ctx);
          break;
        case "b":
        case "B":
          // Quick battle at Coruscant
          this.startCoruscantBattle(ctx);
          break;
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    this.pointerMoveHandler = (ev: PointerEvent) => {
      this.mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      this.updateHover(ctx);
    };
    window.addEventListener("pointermove", this.pointerMoveHandler);

    this.clickHandler = (_ev: MouseEvent) => {
      if (this.hoveredPlanetIndex >= 0) {
        this.selectedPlanetIndex = this.hoveredPlanetIndex;
      }
    };
    window.addEventListener("click", this.clickHandler);
  }

  private detachInputHandlers(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.pointerMoveHandler) {
      window.removeEventListener("pointermove", this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.clickHandler) {
      window.removeEventListener("click", this.clickHandler);
      this.clickHandler = null;
    }
  }

  private updateHover(ctx: ModeContext): void {
    this.raycaster.setFromCamera(this.mouse, ctx.camera);

    this.hoveredPlanetIndex = -1;
    for (let i = 0; i < this.planetMeshes.length; i++) {
      const group = this.planetMeshes[i]!;
      const planet = group.getObjectByName("planet");
      if (!planet) continue;

      const hits = this.raycaster.intersectObject(planet);
      if (hits.length > 0) {
        this.hoveredPlanetIndex = i;
        break;
      }
    }
  }

  private enterSelectedPlanet(ctx: ModeContext): void {
    if (this.selectedPlanetIndex < 0 || !this.simulation) return;

    const planet = this.simulation.getPlanetByIndex(this.selectedPlanetIndex);
    if (!planet) return;

    const system = planetToSystem(planet.planetDef);

    // If battle is occurring, enter combat
    if (planet.underAttack) {
      ctx.requestModeChange("flight", {
        type: "flight",
        system,
        scenario: "conquest"
      });
    } else {
      // Enter sandbox flight
      ctx.requestModeChange("flight", {
        type: "flight",
        system,
        scenario: "sandbox"
      });
    }
  }

  private startCoruscantBattle(ctx: ModeContext): void {
    // Quick access to Battle of Coruscant proof-of-concept
    const coruscantDef = PLANETS.find((p) => p.id === "coruscant");
    if (!coruscantDef) return;

    const system = planetToSystem(coruscantDef);

    ctx.requestModeChange("flight", {
      type: "flight",
      system,
      scenario: "yavin_defense" // Re-use yavin_defense scenario with Coruscant backdrop
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HUD
  // ─────────────────────────────────────────────────────────────────────────────

  private updateHud(ctx: ModeContext): void {
    if (!this.simulation) return;

    const overview = this.simulation.getOverview();
    const phaseName = this.getPhaseName(overview.phase);
    const speedStr = this.paused ? "PAUSED" : `${this.gameSpeed.toFixed(1)}x`;

    let hudText =
      `GALACTIC CONQUEST - ${phaseName}\n` +
      `Time: ${Math.floor(overview.gameTime)}s | Speed: ${speedStr}\n\n` +
      `REBEL ALLIANCE: ${overview.rebelPlanets} planets | ${Math.floor(overview.rebelCredits)} credits\n` +
      `GALACTIC EMPIRE: ${overview.empirePlanets} planets | ${Math.floor(overview.empireCredits)} credits\n` +
      `Neutral: ${overview.neutralPlanets} planets\n\n`;

    if (this.selectedPlanetIndex >= 0) {
      const planet = this.simulation.getPlanetByIndex(this.selectedPlanetIndex);
      if (planet) {
        const factionName = this.getFactionName(planet.controller);
        hudText +=
          `Selected: ${planet.planetDef.name.toUpperCase()}\n` +
          `Controller: ${factionName}\n` +
          `Garrison: ${Math.floor(planet.garrison)}\n` +
          `Resources: ${Math.floor(planet.resources)}\n` +
          `${planet.underAttack ? ">>> UNDER ATTACK <<<" : ""}\n` +
          `Press ENTER to enter system\n`;
      }
    } else {
      hudText += `Click a planet to select\nB for Battle of Coruscant\n`;
    }

    hudText += `\nESC: Return to map | SPACE: Pause | +/-: Speed`;

    ctx.hud.className = "hud-conquest";
    ctx.hud.innerText = hudText;
  }

  private getPhaseName(phase: number): string {
    switch (phase) {
      case CONQUEST_PHASE.SETUP:
        return "SETUP";
      case CONQUEST_PHASE.PLAYING:
        return "IN PROGRESS";
      case CONQUEST_PHASE.REBEL_VICTORY:
        return "REBEL VICTORY!";
      case CONQUEST_PHASE.EMPIRE_VICTORY:
        return "EMPIRE VICTORY!";
      default:
        return "UNKNOWN";
    }
  }

  private getFactionName(faction: number): string {
    switch (faction) {
      case CONQUEST_FACTION.REBEL:
        return "Rebel Alliance";
      case CONQUEST_FACTION.EMPIRE:
        return "Galactic Empire";
      default:
        return "Neutral";
    }
  }
}
