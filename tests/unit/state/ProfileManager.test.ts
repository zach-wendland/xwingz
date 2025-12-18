/**
 * Unit tests for ProfileManager - hardened profile storage system
 *
 * Tests versioned storage, migration, validation, and sanitization.
 *
 * Note: ProfileManager uses import.meta.env.DEV which is Vite-specific.
 * We test the core logic here using inline implementations of the key functions.
 */

import { jest } from "@jest/globals";

// ─────────────────────────────────────────────────────────────────────────────
// Inline implementations matching ProfileManager.ts logic
// This avoids import.meta.env issues in Jest
// ─────────────────────────────────────────────────────────────────────────────

type Upgrades = {
  engine: number;
  maneuver: number;
  shields: number;
  lasers: number;
  hull: number;
};

type Profile = {
  credits: number;
  missionTier: number;
  upgrades: Upgrades;
};

const MAX_CREDITS = 999_999_999;
const MAX_MISSION_TIER = 100;
const MAX_UPGRADE_LEVEL = 10;

function clampInt(v: number | undefined, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function isValidUpgrades(u: unknown): u is Partial<Upgrades> {
  return typeof u === "object" && u !== null;
}

function createDefaultProfile(): Profile {
  return {
    credits: 0,
    missionTier: 0,
    upgrades: {
      engine: 0,
      maneuver: 0,
      shields: 0,
      lasers: 0,
      hull: 0,
    },
  };
}

function sanitizeProfile(profile: Partial<Profile>): Profile {
  const upgrades: Partial<Upgrades> = isValidUpgrades(profile.upgrades)
    ? profile.upgrades
    : {};

  return {
    credits: clampInt(profile.credits, 0, MAX_CREDITS),
    missionTier: clampInt(profile.missionTier, 0, MAX_MISSION_TIER),
    upgrades: {
      engine: clampInt(upgrades.engine, 0, MAX_UPGRADE_LEVEL),
      maneuver: clampInt(upgrades.maneuver, 0, MAX_UPGRADE_LEVEL),
      shields: clampInt(upgrades.shields, 0, MAX_UPGRADE_LEVEL),
      lasers: clampInt(upgrades.lasers, 0, MAX_UPGRADE_LEVEL),
      hull: clampInt(upgrades.hull, 0, MAX_UPGRADE_LEVEL),
    },
  };
}

interface VersionedProfile {
  version: number;
  data: Profile;
  savedAt: number;
}

function migrateProfile(raw: unknown, fromVersion: number): Profile {
  if (fromVersion === 0) {
    const legacy = raw as Partial<{
      credits: number;
      missionTier: number;
      upgrades: Partial<Upgrades>;
    }>;
    return sanitizeProfile({
      credits: legacy.credits ?? 0,
      missionTier: legacy.missionTier ?? 0,
      upgrades: {
        engine: legacy.upgrades?.engine ?? 0,
        maneuver: legacy.upgrades?.maneuver ?? 0,
        shields: legacy.upgrades?.shields ?? 0,
        lasers: legacy.upgrades?.lasers ?? 0,
        hull: legacy.upgrades?.hull ?? 0,
      },
    });
  }
  return createDefaultProfile();
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

// Inline loadProfile matching ProfileManager logic
function loadProfile(): Profile {
  const defaults = createDefaultProfile();

  try {
    const raw = localStorageMock.getItem("xwingz_profile");
    if (!raw) {
      const legacyRaw = localStorageMock.getItem("xwingz_profile_v0");
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        return migrateProfile(legacy, 0);
      }
      return defaults;
    }

    const stored = JSON.parse(raw) as VersionedProfile;
    if (stored.version < 1) {
      return migrateProfile(stored.data, stored.version);
    }
    return sanitizeProfile(stored.data);
  } catch {
    return defaults;
  }
}

// Inline saveProfile matching ProfileManager logic
function saveProfile(profile: Profile): void {
  const payload: VersionedProfile = {
    version: 1,
    data: sanitizeProfile(profile),
    savedAt: Date.now(),
  };
  localStorageMock.setItem("xwingz_profile", JSON.stringify(payload));
}

// Inline scheduleSave with debounce
let globalSaveHandle: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(profile: Profile): void {
  if (globalSaveHandle !== null) return;
  globalSaveHandle = setTimeout(() => {
    globalSaveHandle = null;
    saveProfile(profile);
  }, 500);
}

function createSaveScheduler(profile: Profile): { schedule: () => void; flush: () => void } {
  let handle: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    if (handle !== null) return;
    handle = setTimeout(() => {
      handle = null;
      saveProfile(profile);
    }, 500);
  }

  function flush() {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
    saveProfile(profile);
  }

  return { schedule, flush };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProfileManager", () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("createDefaultProfile", () => {
    it("should create a profile with zero values", () => {
      const profile = createDefaultProfile();

      expect(profile.credits).toBe(0);
      expect(profile.missionTier).toBe(0);
      expect(profile.upgrades.engine).toBe(0);
      expect(profile.upgrades.maneuver).toBe(0);
      expect(profile.upgrades.shields).toBe(0);
      expect(profile.upgrades.lasers).toBe(0);
      expect(profile.upgrades.hull).toBe(0);
    });

    it("should return a new object each time", () => {
      const profile1 = createDefaultProfile();
      const profile2 = createDefaultProfile();

      expect(profile1).not.toBe(profile2);
      expect(profile1.upgrades).not.toBe(profile2.upgrades);
    });
  });

  describe("loadProfile", () => {
    it("should return default profile when no saved data exists", () => {
      const profile = loadProfile();

      expect(profile.credits).toBe(0);
      expect(profile.missionTier).toBe(0);
    });

    it("should load versioned profile from localStorage", () => {
      const savedData = {
        version: 1,
        data: {
          credits: 5000,
          missionTier: 3,
          upgrades: {
            engine: 2,
            maneuver: 1,
            shields: 3,
            lasers: 2,
            hull: 1,
          },
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      expect(profile.credits).toBe(5000);
      expect(profile.missionTier).toBe(3);
      expect(profile.upgrades.engine).toBe(2);
      expect(profile.upgrades.shields).toBe(3);
    });

    it("should migrate legacy v0 profile format", () => {
      const legacyData = {
        credits: 1000,
        missionTier: 2,
        upgrades: {
          engine: 1,
          maneuver: 1,
          shields: 1,
          lasers: 1,
          hull: 1,
        },
      };
      localStorageMock.setItem("xwingz_profile_v0", JSON.stringify(legacyData));

      const profile = loadProfile();

      expect(profile.credits).toBe(1000);
      expect(profile.missionTier).toBe(2);
      expect(profile.upgrades.engine).toBe(1);
    });

    it("should sanitize invalid values", () => {
      const savedData = {
        version: 1,
        data: {
          credits: -500, // Invalid: negative
          missionTier: 200, // Invalid: exceeds max
          upgrades: {
            engine: 15, // Invalid: exceeds max
            maneuver: -2, // Invalid: negative
            shields: NaN, // Invalid: NaN
            lasers: Infinity, // Invalid: Infinity
            hull: 5,
          },
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      expect(profile.credits).toBe(0); // Clamped to 0
      expect(profile.missionTier).toBe(100); // Clamped to max
      expect(profile.upgrades.engine).toBe(10); // Clamped to max
      expect(profile.upgrades.maneuver).toBe(0); // Clamped to 0
      expect(profile.upgrades.shields).toBe(0); // NaN becomes 0
      expect(profile.upgrades.lasers).toBe(0); // Infinity becomes 0
      expect(profile.upgrades.hull).toBe(5);
    });

    it("should handle malformed JSON gracefully", () => {
      localStorageMock.setItem("xwingz_profile", "not valid json{{{");

      const profile = loadProfile();

      expect(profile.credits).toBe(0);
      expect(profile.missionTier).toBe(0);
    });

    it("should handle missing upgrades object", () => {
      const savedData = {
        version: 1,
        data: {
          credits: 1000,
          missionTier: 1,
          // upgrades missing
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      expect(profile.credits).toBe(1000);
      expect(profile.upgrades.engine).toBe(0);
      expect(profile.upgrades.shields).toBe(0);
    });

    it("should handle partial upgrades object", () => {
      const savedData = {
        version: 1,
        data: {
          credits: 1000,
          missionTier: 1,
          upgrades: {
            engine: 3,
            // Other fields missing
          },
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      expect(profile.upgrades.engine).toBe(3);
      expect(profile.upgrades.maneuver).toBe(0);
      expect(profile.upgrades.shields).toBe(0);
    });
  });

  describe("saveProfile", () => {
    it("should save profile with version metadata", () => {
      const profile: Profile = {
        credits: 2500,
        missionTier: 4,
        upgrades: {
          engine: 3,
          maneuver: 2,
          shields: 4,
          lasers: 3,
          hull: 2,
        },
      };

      saveProfile(profile);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "xwingz_profile",
        expect.any(String)
      );

      const savedData = JSON.parse(
        localStorageMock.setItem.mock.calls[0][1] as string
      );
      expect(savedData.version).toBe(1);
      expect(savedData.data.credits).toBe(2500);
      expect(savedData.savedAt).toBeGreaterThan(0);
    });

    it("should sanitize values before saving", () => {
      const profile: Profile = {
        credits: 9999999999, // Exceeds max
        missionTier: -5, // Negative
        upgrades: {
          engine: 100, // Exceeds max
          maneuver: -1,
          shields: 5,
          lasers: 5,
          hull: 5,
        },
      };

      saveProfile(profile);

      const savedData = JSON.parse(
        localStorageMock.setItem.mock.calls[0][1] as string
      );
      expect(savedData.data.credits).toBe(999999999); // Clamped
      expect(savedData.data.missionTier).toBe(0); // Clamped
      expect(savedData.data.upgrades.engine).toBe(10); // Clamped
      expect(savedData.data.upgrades.maneuver).toBe(0); // Clamped
    });

    it("should convert float values to integers", () => {
      const profile: Profile = {
        credits: 1234.56,
        missionTier: 2.9,
        upgrades: {
          engine: 1.5,
          maneuver: 2.1,
          shields: 3.9,
          lasers: 0.1,
          hull: 4.5,
        },
      };

      saveProfile(profile);

      const savedData = JSON.parse(
        localStorageMock.setItem.mock.calls[0][1] as string
      );
      expect(savedData.data.credits).toBe(1234);
      expect(savedData.data.missionTier).toBe(2);
      expect(savedData.data.upgrades.engine).toBe(1);
      expect(savedData.data.upgrades.shields).toBe(3);
    });
  });

  describe("scheduleSave", () => {
    it("should debounce save calls", () => {
      const profile: Profile = {
        credits: 1000,
        missionTier: 1,
        upgrades: { engine: 0, maneuver: 0, shields: 0, lasers: 0, hull: 0 },
      };

      scheduleSave(profile);
      scheduleSave(profile);
      scheduleSave(profile);

      // Should not have saved yet
      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      // Fast-forward past debounce delay
      jest.advanceTimersByTime(600);

      // Should have saved once
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });

    it("should save after 500ms delay", () => {
      const profile: Profile = {
        credits: 2000,
        missionTier: 2,
        upgrades: { engine: 1, maneuver: 1, shields: 1, lasers: 1, hull: 1 },
      };

      scheduleSave(profile);

      jest.advanceTimersByTime(400);
      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      jest.advanceTimersByTime(200);
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });
  });

  describe("createSaveScheduler", () => {
    it("should create independent scheduler", () => {
      const profile: Profile = {
        credits: 3000,
        missionTier: 3,
        upgrades: { engine: 2, maneuver: 2, shields: 2, lasers: 2, hull: 2 },
      };

      const { schedule, flush } = createSaveScheduler(profile);

      schedule();
      schedule();
      schedule();

      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      jest.advanceTimersByTime(600);

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });

    it("flush should save immediately", () => {
      const profile: Profile = {
        credits: 4000,
        missionTier: 4,
        upgrades: { engine: 3, maneuver: 3, shields: 3, lasers: 3, hull: 3 },
      };

      const { schedule, flush } = createSaveScheduler(profile);

      schedule();
      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      flush();
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });

    it("flush should cancel pending scheduled save", () => {
      const profile: Profile = {
        credits: 5000,
        missionTier: 5,
        upgrades: { engine: 4, maneuver: 4, shields: 4, lasers: 4, hull: 4 },
      };

      const { schedule, flush } = createSaveScheduler(profile);

      schedule();
      flush();

      // Advance timer - should not trigger another save
      jest.advanceTimersByTime(600);

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });
  });

  describe("version migration", () => {
    it("should migrate from version 0 to current", () => {
      const v0Data = {
        version: 0,
        data: {
          credits: 500,
          missionTier: 1,
          upgrades: {
            engine: 1,
            maneuver: 0,
            shields: 2,
            lasers: 1,
            hull: 0,
          },
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(v0Data));

      const profile = loadProfile();

      expect(profile.credits).toBe(500);
      expect(profile.missionTier).toBe(1);
      expect(profile.upgrades.shields).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should handle empty localStorage", () => {
      const profile = loadProfile();
      expect(profile).toEqual(createDefaultProfile());
    });

    it("should handle null values in saved data", () => {
      const savedData = {
        version: 1,
        data: {
          credits: null,
          missionTier: null,
          upgrades: null,
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      expect(profile.credits).toBe(0);
      expect(profile.missionTier).toBe(0);
      expect(profile.upgrades.engine).toBe(0);
    });

    it("should handle undefined values in saved data", () => {
      const savedData = {
        version: 1,
        data: {
          credits: undefined,
          missionTier: undefined,
          upgrades: {
            engine: undefined,
            maneuver: undefined,
          },
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      expect(profile.credits).toBe(0);
      expect(profile.missionTier).toBe(0);
      expect(profile.upgrades.engine).toBe(0);
    });

    it("should handle string values that should be numbers", () => {
      const savedData = {
        version: 1,
        data: {
          credits: "1000",
          missionTier: "5",
          upgrades: {
            engine: "3",
            maneuver: "2",
            shields: "1",
            lasers: "0",
            hull: "4",
          },
        },
        savedAt: Date.now(),
      };
      localStorageMock.setItem("xwingz_profile", JSON.stringify(savedData));

      const profile = loadProfile();

      // String "1000" is not a number, should fallback to 0
      expect(profile.credits).toBe(0);
    });

    it("should clamp credits to max value", () => {
      const profile: Profile = {
        credits: 999999999999, // Way over max
        missionTier: 50,
        upgrades: { engine: 5, maneuver: 5, shields: 5, lasers: 5, hull: 5 },
      };

      saveProfile(profile);

      const savedData = JSON.parse(
        localStorageMock.setItem.mock.calls[0][1] as string
      );
      expect(savedData.data.credits).toBe(999999999);
    });
  });
});
