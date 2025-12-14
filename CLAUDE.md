# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install              # Install workspace dependencies
npm run dev              # Run web client (Vite dev server)
npm run build            # Build packages + apps for production
npm run build:packages   # Build all packages in dependency order
npm run build:apps       # Build apps only (requires packages built first)
npm run typecheck        # TypeScript project references check (tsc -b)

# Testing
npm run test             # Run all Jest tests
npm run test:unit        # Run unit tests only
npm run test:watch       # Run tests in watch mode
npm run e2e              # Run Playwright e2e tests (starts dev server automatically)

# Single test file
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/ground/systems.test.ts

# Workspace-specific builds
npm -w packages/gameplay run build
npm -w apps/web run build
```

## Architecture

**Monorepo Structure:**
- `apps/web/` - Browser game client (Three.js + Vite)
- `packages/` - Shared libraries with dependency order:
  - `core` → `physics` → `render` → `data` → `procgen` → `gameplay` → `ui`
- `tools/seed-inspector/` - Procgen debugging tool
- `tests/unit/` - Jest unit tests
- `tests/e2e/` - Playwright integration tests

**Core Technologies:**
- **bitecs** - Entity Component System (ECS) for game state
- **Three.js** - 3D rendering
- **Rapier.js** - Physics (via WASM, needs `vite-plugin-wasm`)
- TypeScript ESM throughout (`"type": "module"`)

**Gameplay Package (`packages/gameplay/`):**
- `space/` - Space combat (ships, weapons, AI)
  - `components.ts` - ECS components (Transform, Ship, LaserWeapon, Projectile, etc.)
  - `systems.ts` - Per-frame systems (movement, combat, spawning)
  - `input.ts` - Player input handling
- `ground/` - Infantry combat (Battlefront-style)
  - `components.ts` - Soldier, CharacterController, BlasterWeapon, CommandPost, etc.
  - `systems.ts` - Ground movement, capture points, AI state machine
  - `input.ts` - Third-person controls with pointer lock

**Key Patterns:**
- Components are defined with `defineComponent()` from bitecs using typed arrays
- Systems iterate over entities via `defineQuery()` and run each frame
- Input handlers return state objects that sync to ECS components
- Deterministic generation: procgen uses seeds, avoid `Math.random()` in gameplay

## Coding Conventions

- 2-space indentation
- Prefer `const`, small pure functions, explicit types at module boundaries
- Avoid allocations in per-frame loops (reuse objects/arrays)
- Commit messages: milestone prefix convention (`Step 5.1: ...`, `Phase C: ...`)
