/**
 * ProfileManager - Handles persistent player profile storage via localStorage
 */

export type Upgrades = {
  engine: number;
  maneuver: number;
  shields: number;
  lasers: number;
  hull: number;
};

export type Profile = {
  credits: number;
  missionTier: number;
  upgrades: Upgrades;
};

const PROFILE_KEY = "xwingz_profile_v0";

function clampInt(v: number | undefined, min: number, max: number): number {
  if (typeof v !== "number") return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

export function createDefaultProfile(): Profile {
  return {
    credits: 0,
    missionTier: 0,
    upgrades: {
      engine: 0,
      maneuver: 0,
      shields: 0,
      lasers: 0,
      hull: 0
    }
  };
}

export function loadProfile(): Profile {
  const defaults = createDefaultProfile();
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<{
      v: number;
      credits: number;
      missionTier: number;
      upgrades: Partial<Upgrades>;
    }>;
    return {
      credits: typeof parsed.credits === "number" ? Math.max(0, Math.floor(parsed.credits)) : defaults.credits,
      missionTier: typeof parsed.missionTier === "number" ? Math.max(0, Math.floor(parsed.missionTier)) : defaults.missionTier,
      upgrades: {
        engine: clampInt(parsed.upgrades?.engine, 0, 10),
        maneuver: clampInt(parsed.upgrades?.maneuver, 0, 10),
        shields: clampInt(parsed.upgrades?.shields, 0, 10),
        lasers: clampInt(parsed.upgrades?.lasers, 0, 10),
        hull: clampInt(parsed.upgrades?.hull, 0, 10)
      }
    };
  } catch {
    return defaults;
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        v: 0,
        credits: Math.max(0, Math.floor(profile.credits)),
        missionTier: Math.max(0, Math.floor(profile.missionTier)),
        upgrades: profile.upgrades
      })
    );
  } catch {
    // Ignore quota / storage errors
  }
}

/**
 * Creates a debounced save scheduler to avoid excessive localStorage writes.
 */
export function createSaveScheduler(profile: Profile): { schedule: () => void; flush: () => void } {
  let handle: number | null = null;

  function schedule() {
    if (handle !== null) return;
    handle = window.setTimeout(() => {
      handle = null;
      saveProfile(profile);
    }, 500);
  }

  function flush() {
    if (handle !== null) {
      window.clearTimeout(handle);
      handle = null;
    }
    saveProfile(profile);
  }

  return { schedule, flush };
}

// Global save handle for simple scheduleSave usage
let globalSaveHandle: number | null = null;

/**
 * Simple debounced save - schedules a save after 500ms
 */
export function scheduleSave(profile: Profile): void {
  if (globalSaveHandle !== null) return;
  globalSaveHandle = window.setTimeout(() => {
    globalSaveHandle = null;
    saveProfile(profile);
  }, 500);
}
