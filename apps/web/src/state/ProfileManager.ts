/**
 * ProfileManager - Handles persistent player profile storage
 *
 * Features:
 * - Versioned storage with migration support
 * - Fallback to IndexedDB when localStorage fails
 * - Validation and sanitization of loaded data
 * - Debounced saves to reduce write frequency
 */

import { createLogger } from "@xwingz/core";

const log = createLogger("ProfileManager");

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

// Storage keys
const PROFILE_KEY = "xwingz_profile";
const CURRENT_VERSION = 1;

// Max values to prevent overflow/exploits
const MAX_CREDITS = 999_999_999;
const MAX_MISSION_TIER = 100;
const MAX_UPGRADE_LEVEL = 10;

// IndexedDB fallback database
const IDB_NAME = "xwingz";
const IDB_STORE = "profile";

// ─────────────────────────────────────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clampInt(v: number | undefined, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function isValidUpgrades(u: unknown): u is Partial<Upgrades> {
  return typeof u === "object" && u !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Profile
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Version Migration
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedProfile {
  version: number;
  data: Profile;
  savedAt: number;
}

function migrateProfile(raw: unknown, fromVersion: number): Profile {
  const defaults = createDefaultProfile();

  // Handle pre-versioned data (v: 0 format)
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
        hull: legacy.upgrades?.hull ?? 0
      }
    });
  }

  // Future migrations would go here (e.g., v1 -> v2)
  // if (fromVersion === 1) { ... }

  return defaults;
}

function sanitizeProfile(profile: Partial<Profile>): Profile {
  const upgrades: Partial<Upgrades> = isValidUpgrades(profile.upgrades) ? profile.upgrades : {};

  return {
    credits: clampInt(profile.credits, 0, MAX_CREDITS),
    missionTier: clampInt(profile.missionTier, 0, MAX_MISSION_TIER),
    upgrades: {
      engine: clampInt(upgrades.engine, 0, MAX_UPGRADE_LEVEL),
      maneuver: clampInt(upgrades.maneuver, 0, MAX_UPGRADE_LEVEL),
      shields: clampInt(upgrades.shields, 0, MAX_UPGRADE_LEVEL),
      lasers: clampInt(upgrades.lasers, 0, MAX_UPGRADE_LEVEL),
      hull: clampInt(upgrades.hull, 0, MAX_UPGRADE_LEVEL)
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB Fallback
// ─────────────────────────────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function saveToIDB(payload: VersionedProfile): Promise<boolean> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const request = store.put(payload, "profile");
      request.onerror = () => resolve(false);
      request.onsuccess = () => resolve(true);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorage Operations
// ─────────────────────────────────────────────────────────────────────────────

function loadFromLocalStorage(): VersionedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      // Check for legacy v0 format
      const legacyRaw = localStorage.getItem("xwingz_profile_v0");
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        return {
          version: 0,
          data: legacy,
          savedAt: Date.now()
        };
      }
      return null;
    }
    return JSON.parse(raw) as VersionedProfile;
  } catch {
    return null;
  }
}

function saveToLocalStorage(payload: VersionedProfile): boolean {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    // Quota exceeded or storage disabled
    log.warn("localStorage save failed:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function loadProfile(): Profile {
  const defaults = createDefaultProfile();

  // Try localStorage first
  let stored = loadFromLocalStorage();

  // If nothing in localStorage, try IndexedDB (async fallback loaded synchronously returns null)
  if (!stored) {
    // For sync load, we can only use localStorage
    // IndexedDB will be checked on first save if needed
    return defaults;
  }

  // Handle version migration
  if (stored.version < CURRENT_VERSION) {
    return migrateProfile(stored.data, stored.version);
  }

  // Validate and return
  return sanitizeProfile(stored.data);
}

export function saveProfile(profile: Profile): void {
  const payload: VersionedProfile = {
    version: CURRENT_VERSION,
    data: sanitizeProfile(profile),
    savedAt: Date.now()
  };

  // Try localStorage first
  const localSaved = saveToLocalStorage(payload);

  // If localStorage failed, try IndexedDB as fallback
  if (!localSaved) {
    saveToIDB(payload).catch(() => {
      // Both storage methods failed - data may be lost
      log.error("All storage methods failed!");
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Save Scheduler (Debounced)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a debounced save scheduler to avoid excessive writes.
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
