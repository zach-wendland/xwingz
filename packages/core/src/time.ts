export type TimeConfig = {
  tickHz: number;
  maxDeltaMs: number;
};

export const DEFAULT_TIME_CONFIG: TimeConfig = {
  tickHz: 60,
  maxDeltaMs: 50
};

