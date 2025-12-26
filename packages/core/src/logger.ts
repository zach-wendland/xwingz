/**
 * Conditional logging utility for xwingz
 *
 * Provides tagged logging that can be controlled via log levels.
 * In production builds, debug/info messages are silenced.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sensitive Key Redaction
// ─────────────────────────────────────────────────────────────────────────────

/** Keys that contain sensitive data and should be redacted from logs */
const SENSITIVE_KEYS = new Set([
  // Auth headers
  "authorization",
  "x-api-key",
  "x-auth-token",
  "bearer",
  // Cookies and session
  "cookie",
  "set-cookie",
  "session",
  "sessionid",
  "session_id",
  // Tokens and secrets
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "passwd",
  "pwd",
  // Private keys and credentials
  "private_key",
  "privatekey",
  "secret_key",
  "secretkey",
  "credentials",
  "auth"
]);

/** Redacted value placeholder */
const REDACTED = "[REDACTED]";

/**
 * Recursively redact sensitive keys from an object
 * Returns a new object with sensitive values replaced
 */
export function redactSensitiveKeys<T>(obj: T, maxDepth = 10): T {
  if (maxDepth <= 0) return obj;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveKeys(item, maxDepth - 1)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveKeys(value, maxDepth - 1);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Redact sensitive data from log arguments
 * Processes each argument, redacting objects and leaving primitives unchanged
 */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (typeof arg === "object" && arg !== null) {
      return redactSensitiveKeys(arg);
    }
    return arg;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Levels
// ─────────────────────────────────────────────────────────────────────────────

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

// Default to WARN in production, DEBUG in development
let currentLevel: LogLevel = LogLevel.WARN;

/**
 * Set the global log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Enable verbose logging (DEBUG level)
 */
export function enableVerboseLogging(): void {
  currentLevel = LogLevel.DEBUG;
}

/**
 * Create a tagged logger for a specific module
 */
export function createLogger(tag: string) {
  const prefix = `[${tag}]`;

  return {
    debug(...args: unknown[]): void {
      if (currentLevel <= LogLevel.DEBUG) {
        console.debug(prefix, ...args);
      }
    },

    info(...args: unknown[]): void {
      if (currentLevel <= LogLevel.INFO) {
        console.log(prefix, ...args);
      }
    },

    warn(...args: unknown[]): void {
      if (currentLevel <= LogLevel.WARN) {
        console.warn(prefix, ...args);
      }
    },

    error(...args: unknown[]): void {
      if (currentLevel <= LogLevel.ERROR) {
        console.error(prefix, ...args);
      }
    }
  };
}

// Convenience: global logger without tag
export const logger = {
  debug(...args: unknown[]): void {
    if (currentLevel <= LogLevel.DEBUG) {
      console.debug(...args);
    }
  },

  info(...args: unknown[]): void {
    if (currentLevel <= LogLevel.INFO) {
      console.log(...args);
    }
  },

  warn(...args: unknown[]): void {
    if (currentLevel <= LogLevel.WARN) {
      console.warn(...args);
    }
  },

  error(...args: unknown[]): void {
    if (currentLevel <= LogLevel.ERROR) {
      console.error(...args);
    }
  }
};
