# FlightMode Refactoring Summary

## Overview
Refactoring the 2,638-line FlightMode.ts "god object" into focused, maintainable modules.

## Progress

### Completed Modules

1. **types.ts** ✅
   - Extracted all shared types
   - FlightHudElements, TerrainParams, MissionRuntime, etc.
   - 100 lines

2. **SceneBuilder.ts** ✅
   - Starfield generation
   - Yavin terrain with heightmap
   - Tree instancing
   - Great Temple construction
   - ~260 lines

3. **CameraController.ts** ✅
   - Follow camera logic
   - Smooth interpolation
   - FOV boost effect
   - ~90 lines

4. **HUDController.ts** ✅
   - HUD setup and element management
   - Flight instruments
   - Targeting brackets and lead pip
   - Capital ship panel
   - Mission status messages
   - ~600 lines

5. **CapitalShipController.ts** ✅
   - Star Destroyer spawning
   - Turret mesh building (GLB + procedural)
   - Subsystem meshes
   - Mesh syncing
   - ~370 lines

6. **E2EHelpers.ts** ✅
   - Test-only helper methods
   - ~70 lines

### Remaining Work

7. **EntitySpawner.ts** (TODO)
   - Player ship spawning
   - Enemy fighter spawning
   - Ally spawning (wingmen)
   - Mesh building for fighters
   - Upgrade application
   - ~400 lines

8. **MissionManager.ts** (TODO)
   - Mission state machines
   - Wave spawning
   - Yavin defense logic
   - Star Destroyer mission logic
   - Mission completion/failure
   - ~500 lines

9. **MeshSyncManager.ts** (TODO)
   - Projectile mesh syncing
   - Target mesh syncing
   - Ally mesh syncing
   - Death effects
   - ~250 lines

10. **FlightMode.ts** (TODO - Refactor)
    - Main coordinator
    - enter(), tick(), exit() orchestration
    - Input handling
    - System calls
    - Hyperspace jump
    - Delegates to controllers
    - ~400 lines (down from 2,638)

11. **index.ts** (TODO)
    - Re-export FlightMode as default
    - ~5 lines

## Architecture

### Dependency Flow
```
FlightMode (coordinator)
  ├── SceneBuilder (scene construction)
  ├── CameraController (camera follow)
  ├── HUDController (presentation)
  ├── CapitalShipController (capital ships)
  ├── EntitySpawner (fighter spawning)
  ├── MissionManager (game logic)
  ├── MeshSyncManager (render sync)
  └── E2EHelpers (testing)
```

### Key Patterns
- **Delegation**: FlightMode delegates to specialized controllers
- **Dependency Injection**: Controllers receive ModeContext
- **Single Responsibility**: Each module has one clear purpose
- **Testability**: Controllers can be tested independently

## Benefits

### Before
- 2,638 lines in one file
- 8 responsibilities mixed together
- Hard to test individual features
- High cognitive load

### After
- 10 focused modules, largest ~600 lines
- Clear separation of concerns
- Each module testable in isolation
- Easy to navigate and understand

## Next Steps

1. Create EntitySpawner.ts
2. Create MissionManager.ts
3. Create MeshSyncManager.ts
4. Refactor main FlightMode.ts to use controllers
5. Create index.ts
6. Update imports in parent files
7. Run tests and verify functionality
8. Delete old FlightMode.ts

## Testing Strategy

- Run build after each module extraction
- Run e2e tests after major integrations
- Verify no regressions in:
  - Sandbox missions
  - Yavin defense
  - Star Destroyer mission
  - Hyperspace jumps
  - Landing transitions

## Files

**Created:**
- `apps/web/src/modes/flight/types.ts`
- `apps/web/src/modes/flight/SceneBuilder.ts`
- `apps/web/src/modes/flight/CameraController.ts`
- `apps/web/src/modes/flight/HUDController.ts`
- `apps/web/src/modes/flight/CapitalShipController.ts`
- `apps/web/src/modes/flight/E2EHelpers.ts`

**To Create:**
- `apps/web/src/modes/flight/EntitySpawner.ts`
- `apps/web/src/modes/flight/MissionManager.ts`
- `apps/web/src/modes/flight/MeshSyncManager.ts`
- `apps/web/src/modes/flight/FlightMode.ts` (refactored)
- `apps/web/src/modes/flight/index.ts`

**To Update:**
- `apps/web/src/modes/FlightMode.ts` (delete after migration)
- Any files importing FlightMode
