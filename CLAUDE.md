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
- `ground/` - Infantry combat (Battlefront-style)
  - `components.ts` - Soldier, CharacterController, BlasterWeapon, CommandPost
  - `systems.ts` - Ground movement, capture points, AI state machine
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
