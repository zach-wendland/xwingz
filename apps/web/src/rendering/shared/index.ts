/**
 * Shared rendering utilities
 *
 * Enhanced assets extracted from Conquest mode and made reusable
 * across all game modes (Map, Flight, Ground).
 */

export {
  setupEnhancedSpaceLighting,
  type LightingConfig
} from "./EnhancedLighting";

export {
  buildEnhancedStarfield,
  disposeStarfield,
  type StarfieldConfig
} from "./EnhancedStarfield";

export {
  buildNebulaBackdrop,
  disposeNebula,
  NebulaColors,
  type NebulaConfig
} from "./NebulaBackdrop";
