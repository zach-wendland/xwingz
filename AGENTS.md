# Repository Guidelines

## Project Structure
- `apps/web/`: browser game client (Three.js + TypeScript).
- `tools/seed-inspector/`: procgen debugging tool.
- `packages/`: shared libraries:
  - `packages/procgen/`: deterministic galaxy/system generation (seed → data).
  - `packages/gameplay/`: ECS simulation (spaceflight/combat).
  - `packages/render/`: renderer setup/helpers.
  - `packages/data/`: curated IDs/archetypes (factions, ships, etc).
  - `packages/core/`: app/game loop utilities.
- `legacy/` and `EchoesOfTheOuterRim/`: legacy content; not part of the main TS game loop.

## Build, Test, and Development Commands
- `npm install`: install workspace dependencies.
- `npm run dev`: run the web client locally (Vite).
- `npm run typecheck`: TypeScript project references check (`tsc -b`).
- `npm run build`: build packages + apps for production.
- Optional per-workspace builds: `npm -w packages/gameplay run build`, `npm -w apps/web run build`.

## Coding Style & Naming Conventions
- TypeScript ESM (`"type": "module"`). Prefer `const`, small pure helpers, and explicit types at module boundaries.
- Indentation: 2 spaces; keep lines readable and avoid large one-off allocations inside per-frame loops.
- Determinism is a feature: generation and encounter selection should be pure functions of seeds + coordinates (avoid `Math.random()` in procgen/gameplay).

## Testing Guidelines
- There are currently no automated tests. Before opening a PR, run `npm run typecheck` and `npm run build`.
- When adding complex procgen or gameplay logic, prefer small, isolated pure functions so future tests can target them.

## Commit & Pull Request Guidelines
- Commit messages follow a simple “milestone prefix” convention (e.g. `Phase C: ...`, `Step 5.1: ...`).
- PRs should include: what changed, how to run (`npm run dev`), controls impacted, and screenshots/video for UX/HUD changes.
- Keep PRs focused: one feature/fix per PR; avoid drive-by refactors.

