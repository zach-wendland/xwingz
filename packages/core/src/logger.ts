/**
 * Conditional logging utility for xwingz
 *
 * Provides tagged logging that can be controlled via log levels.
 * In production builds, debug/info messages are silenced.
 */

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
