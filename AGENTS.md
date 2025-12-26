# Repository Guidelines

## Project Structure & Module Organization
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
- `npm run typecheck`: run TypeScript project references (`tsc -b`).
- `npm run build`: build packages + apps for production.
- Optional: `npm -w packages/gameplay run build`, `npm -w apps/web run build`.

## Coding Style & Naming Conventions
- TypeScript ESM (`"type": "module"`), prefer `const`, small pure helpers, and explicit types at module boundaries.
- Indentation: 2 spaces; keep lines readable and avoid large one-off allocations inside per-frame loops.
- Determinism is a feature: generation and encounter selection must be pure functions of seeds + coordinates (avoid `Math.random()` in procgen/gameplay).

## Testing Guidelines
- No automated tests yet. Before opening a PR, run `npm run typecheck` and `npm run build`.
- When adding complex procgen or gameplay logic, favor small, isolated pure functions for future tests.

## Commit & Pull Request Guidelines
- Commit messages use a milestone prefix (example: `Phase C: ...`, `Step 5.1: ...`).
- PRs should include: what changed, how to run (`npm run dev`), controls impacted, and screenshots/video for UX/HUD changes.
- Keep PRs focused: one feature or fix per PR; avoid drive-by refactors.
