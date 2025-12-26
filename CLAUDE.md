# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install              # Install workspace dependencies
npm run dev              # Run web client (Vite dev server)
npm run build            # Build all packages + apps (parallel via Turborepo)
npm run build:packages   # Build only packages
npm run build:apps       # Build only apps and tools
npm run typecheck        # TypeScript project references check

# Testing
npm run test             # Run all Jest tests
npm run test:unit        # Run unit tests only
npm run test:watch       # Run tests in watch mode
npm run e2e              # Run Playwright e2e tests

# Linting and Formatting
npm run lint             # Run Biome linter on all workspaces
npm run format           # Format all files with Biome

# Single test file
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/ground/systems.test.ts

# Turborepo-specific commands
npx turbo run build --filter=packages/core  # Build only core + dependents
npx turbo run build --force                 # Force rebuild ignoring cache
rm -rf .turbo                               # Clear Turborepo cache
```

**Build System Notes:**
- Uses Turborepo for parallel builds with automatic dependency ordering
- Build outputs cached in `.turbo/` directory (40-50% faster incremental builds)
- TypeScript 5.9.3 hoisted to root level for consistency

## Architecture

**Monorepo Structure:**
- `apps/web/` - Browser game client (Three.js + Vite), package name: `web`
- `packages/` - Shared libraries with build dependency order:
  - `core` → `data` → `render` → `procgen` → `physics` → `gameplay` → `ui`
- `tools/seed-inspector/` - Procgen debugging tool
- `tests/unit/` - Jest unit tests
- `tests/e2e/` - Playwright e2e tests (SwiftShader for headless WebGL)

**Turborepo Filter Syntax:**
- Use package names, not paths: `--filter=web` (not `--filter=apps/web`)
- Path filters require `./` prefix: `--filter=./packages/*`

**Core Technologies:**
- **bitecs** - Entity Component System (ECS) for game state
- **Three.js** - 3D rendering
- **Rapier.js** - Physics (via WASM, needs `vite-plugin-wasm`)
- TypeScript ESM throughout (`"type": "module"`)

**Game Modes (`apps/web/src/modes/`):**
- `ConquestMode` - Real-time galactic conquest with strategic layer
- `FlightMode` - Space combat (fighters, capital ships)
- `GroundMode` - Infantry/Battlefront-style ground combat
- `MapMode` - Galaxy map and fleet management

**Render Package (`packages/render/`):**
- `ShipModels.ts` - Unified ship mesh system with 12 procedural ship types (X-Wing, TIE Fighter, TIE Interceptor, Y-Wing, A-Wing, Star Destroyer, Nebulon-B, CR90, Transport, Shuttle)
- `AssetLoader.ts` - GLTF/GLB loading with caching, Kenney Space Kit integration
- `PlanetTextures.ts` - Procedural planet texture generator via `getPlanetTexture(style, id, size)` for 9 Star Wars planet styles (desert, ice, jungle, ocean, volcanic, city, gas, barren, mystic)

**Gameplay Package (`packages/gameplay/`):**
- `space/` - Space combat (ships, weapons, AI)
  - `capital-components.ts`, `capital-systems.ts` - Capital ship subsystems (shields, turrets, hangars)
  - `components.ts` - Fighter/bomber ECS components
  - `systems.ts` - Per-frame systems (movement, combat, spawning)
  - `objective-types.ts`, `objective-tracker.ts`, `kill-tracker.ts` - Mission objective system
  - `projectile-pool.ts` - Object pooling for projectile entities (reduces GC pressure)
  - `spatial-index.ts` - Unified spatial hashing for collision/targeting queries
- `ground/` - Infantry combat (Battlefront-style)
  - `components.ts` - Soldier, CharacterController, BlasterWeapon, CommandPost
  - `systems.ts` - Ground movement, capture points, AI state machine
  - `hoth-components.ts` - Hoth-specific: ATATWalker, TurretEmplacement, Snowtrooper
  - `atat-system.ts` - AT-AT walker, targeting, weapon, trip systems
  - `turret-system.ts` - Turret emplacement and AI systems
- `conquest/` - Galactic conquest campaign
  - `components.ts` - ConquestPlanet, ConquestFleet, GroundForce, BattlePending
  - `systems.ts` - Fleet movement, resource generation, battle resolution
- `transition/` - Space↔ground seamless transitions

**Key Patterns:**
- Components are defined with `defineComponent()` from bitecs using typed arrays
- Systems iterate over entities via `defineQuery()` and run each frame
- Input handlers return state objects that sync to ECS components
- Domain tags (`InSpaceDomain`, `InGroundDomain`) control which systems affect entities
- `Persistent` component marks entities that survive mode transitions

**Flight Mode Scenario System (`apps/web/src/modes/flight/`):**
FlightMode uses a modular scenario handler pattern. Each scenario implements `FlightScenarioHandler`:
- `SandboxScenario.ts` - Free roam with random spawns
- `YavinDefenseScenario.ts` - Planetary defense with terrain, fog, environmental props
- `StarDestroyerScenario.ts` - Capital ship assault with wingmen, phase progression, debris field
- `HothSpeederScenario.ts` - T-47 snowspeeder tow cable mini-game (circles AT-AT legs)

Scenario handlers implement: `enter()`, `tick()`, `handleHyperspace()`, `updateHud()`, `getMissionMessage()`, `canLand()`, `exit()`

Supporting modules:
- `FlightScenarioTypes.ts` - Shared types (`FlightContext`, `FlightHudElements`, mission state types)
- `FlightShared.ts` - Shared utilities (camera, targeting, weapons)
- `SceneBuilder.ts` - Starfield, planetary terrain generation
- `CameraController.ts` - Third-person chase camera
- `CapitalShipController.ts` - Capital ship mesh/entity management
- `HUDController.ts` - HUD element creation and bracket positioning
- `E2EHelpers.ts` - Test hooks exposed on `window.__xwingz` and `window.__xwingzTest`
- `ObjectiveHud.ts` - DOM-based objective progress display
- `AnnouncementSystem.ts` - Objective completion overlay announcements
- `RadioChatterSystem.ts` - Text-based radio dialogue display

**Ground Mode Scenario System (`apps/web/src/modes/ground/`):**
GroundMode mirrors the flight scenario pattern. Each scenario implements `GroundScenarioHandler`:
- `DefaultScenario.ts` - Battlefront-style command post capture
- `HothDefenseScenario.ts` - Two-phase mega mission: outdoor trench defense → interior Echo Base escort to Millennium Falcon

Scenario handlers implement: `enter()`, `tick()`, `updateHud()`, `getMissionMessage()`, `canTransition()`, `exit()`

**E2E Testing (`tests/e2e/`):**
Tests use Playwright with SwiftShader for headless WebGL. The `?e2e=1` URL param enables test helpers:
```typescript
// Read game state
window.__xwingz?.mode           // "map" | "flight"
window.__xwingz?.scenario       // "sandbox" | "yavin_defense" | "destroy_star_destroyer"
window.__xwingz?.capitalShipCount
window.__xwingz?.targetCount
window.__xwingz?.enterFlight(system, scenario)

// Test actions
window.__xwingzTest?.killAllEnemies()
window.__xwingzTest?.destroyStarDestroyer()
```

## Mission Objective System

The gameplay package provides a generic, reusable objective tracking system used by flight and ground scenarios.

**Core Types (`@xwingz/gameplay`):**
```typescript
import {
  ObjectiveTracker,
  KillTracker,
  ObjectiveDefinition,
  ObjectiveContext,
  ObjectiveStatus,
  TriggerType,
  ProgressIndicatorType,
  createDefaultObjectiveContext,
  missionStartTrigger,
  objectiveCompleteTrigger,
  killCountTrigger
} from "@xwingz/gameplay";
```

**ObjectiveTracker Usage:**
```typescript
const tracker = new ObjectiveTracker(objectiveDefinitions);
tracker.initialize();  // Not start()

// Per-frame update - returns events
const events = tracker.tick(dt, objectiveContext);  // Returns ObjectiveEvent[]

// Query state
tracker.getActiveObjective();
tracker.getObjectivesByStatus(ObjectiveStatus.COMPLETED);  // Not getCompletedObjectives()
tracker.getOptionalObjectives();
```

**KillTracker Usage:**
```typescript
const killTracker = new KillTracker(shieldThreshold);
killTracker.recordKill("tie_fighter", wave);
killTracker.getTrackingData();  // Returns full KillTrackingData object
killTracker.getStreak();  // Not getCurrentStreak()
```

**HUD Systems (`apps/web/src/modes/flight/`):**
```typescript
import { ObjectiveHud } from "./ObjectiveHud";
import { AnnouncementSystem, newObjectiveAnnouncement } from "./AnnouncementSystem";
import { RadioChatterSystem, RadioSpeaker } from "./RadioChatterSystem";

// Create with container (use ctx.overlay, NOT ctx.container)
const hud = new ObjectiveHud(ctx.overlay);
const announcements = new AnnouncementSystem(ctx.overlay);
const radio = new RadioChatterSystem(ctx.overlay);

// Per-frame updates
hud.update(tracker, dt);
announcements.tick(dt);  // Not update()
radio.tick(dt);  // Not update()

// Queue messages
announcements.announce(newObjectiveAnnouncement("New Objective", "Subtitle"));
radio.say("Message text", RadioSpeaker.COMMAND);  // Not queue()

// Cleanup
hud.dispose();
announcements.dispose();
radio.dispose();
```

**TriggerType Options:**
- `MISSION_START`, `OBJECTIVE_COMPLETE` - Sequencing triggers
- `KILL_COUNT`, `KILL_ALL`, `KILL_STREAK` - Kill-based triggers
- `SUBSYSTEMS_DESTROYED`, `ENTITY_DESTROYED`, `ENTITY_HEALTH_BELOW` - Target state triggers
- `REACH_LOCATION`, `INTERACT`, `ESCORT_ALIVE` - Location/escort triggers
- `COMPOUND` - AND logic for multiple conditions

## Deterministic RNG

All gameplay code uses seeded RNG for determinism and reproducibility:

```typescript
import { SeededRNG, seededRandom, seededRange, setGlobalSeed } from '@xwingz/core';

// Global RNG (shared state)
setGlobalSeed(42);                    // Set global seed
const value = seededRandom();         // 0-1 range
const range = seededRange(10, 100);   // Custom range

// Per-instance RNG (isolated state)
const rng = new SeededRNG(entityId);  // Use entity ID as seed
rng.next();                           // 0-1 range
rng.range(min, max);                  // Float in range
rng.int(min, max);                    // Integer in range (inclusive)
```

**Rules:**
- **NEVER** use `Math.random()` in gameplay code
- Use entity IDs as seeds for per-entity variation
- Visual-only effects (starfields, particles) can use fixed seeds
- Procgen uses the seed system from `@xwingz/procgen`

## Logging

Use the conditional logger instead of raw `console.*` calls:

```typescript
import { createLogger, LogLevel, setLogLevel } from '@xwingz/core';

const log = createLogger("ModuleName");
log.debug("Verbose details");  // Only in DEBUG mode
log.info("General info");      // DEBUG or INFO mode
log.warn("Warnings");          // DEBUG, INFO, or WARN mode (default)
log.error("Errors");           // Always shown (except NONE)

// Control log level globally
setLogLevel(LogLevel.DEBUG);   // Enable all logs
```

**Rules:**
- **NEVER** use raw `console.log/warn/error` in gameplay or render code
- Use tagged loggers (`createLogger("Tag")`) for module-specific output
- Default level is WARN in production, DEBUG in development

## Object Pooling

Projectile entities use object pooling to reduce GC pressure:

```typescript
import { acquireProjectile, releaseProjectile, isPooled, initProjectilePool } from '@xwingz/gameplay';

// On game init
initProjectilePool(world);  // Pre-allocates 64 entities

// Spawn projectile (reuses pooled entity or creates new)
const eid = acquireProjectile(world, 0);  // 0=laser, 1=torpedo

// Return to pool instead of removeEntity()
releaseProjectile(world, eid, 0);

// Check if entity is pooled (inactive)
if (isPooled(world, eid)) { /* skip processing */ }
```

**Pool Behavior:**
- Pre-allocates 64 laser projectiles at init
- Max pool size: 512 entities per type
- Pooled entities have `Pooled` component and are moved off-screen
- `getProjectiles()` automatically filters out pooled entities

## Spatial Indexing

Space combat uses a unified spatial index for collision and targeting:

```typescript
import { rebuildSpaceCombatIndex, spaceCombatIndex } from '@xwingz/gameplay';

// Call once per frame before queries
rebuildSpaceCombatIndex(world);

// Query nearby entities
const nearby = spaceCombatIndex.queryCombatants(x, y, z, radius);
const enemies = spaceCombatIndex.queryEnemies(world, x, y, z, radius, myTeam);
const aiOnly = spaceCombatIndex.queryAIEntities(x, y, z, radius);
```

## Coding Conventions

- 2-space indentation
- Prefer `const`, small pure functions, explicit types at module boundaries
- Avoid allocations in per-frame loops (reuse objects/arrays)
- Commit messages: milestone prefix convention (`Step 5.1: ...`, `Phase C: ...`)

## Star Wars Visual Canon

When creating ship visuals:
- TIE engine glow: blue (`0x4488ff`), NOT green - TIE ions glow blue in films
- Empire faction UI colors: Imperial blue/gray (`0x4488ff`), NOT green - green is for lasers only
- Rebel faction: orange/red tones (`0xff6644`)
- Neutral/contested: gray (`0x888888`)

Hoth color palette:
- Snow: `0xf0f4ff`
- Ice caves: `0xaaccff`
- Rebel orange flight suits: `0xff6644`
- Imperial gray: `0x666677`
- AT-AT armor: `0x888899`
