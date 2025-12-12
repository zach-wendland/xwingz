import { createWorld, IWorld } from "bitecs";
import { DEFAULT_TIME_CONFIG, TimeConfig } from "./time";

export type GameConfig = {
  globalSeed: bigint;
  time?: Partial<TimeConfig>;
};

export interface Game {
  world: IWorld;
  start(): void;
  stop(): void;
  setTick(fn: (dtSeconds: number) => void): void;
}

export function createGame(config: GameConfig): Game {
  const world = createWorld();
  const time: TimeConfig = { ...DEFAULT_TIME_CONFIG, ...config.time };

  let running = false;
  let lastMs = 0;
  let accumulatorMs = 0;
  const fixedDtMs = 1000 / time.tickHz;
  let tickFn: (dtSeconds: number) => void = () => {};

  function frame(nowMs: number) {
    if (!running) return;
    if (lastMs === 0) lastMs = nowMs;
    let deltaMs = nowMs - lastMs;
    if (deltaMs > time.maxDeltaMs) deltaMs = time.maxDeltaMs;
    lastMs = nowMs;
    accumulatorMs += deltaMs;
    while (accumulatorMs >= fixedDtMs) {
      tickFn(fixedDtMs / 1000);
      accumulatorMs -= fixedDtMs;
    }
    requestAnimationFrame(frame);
  }

  return {
    world,
    start() {
      if (running) return;
      running = true;
      lastMs = 0;
      accumulatorMs = 0;
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
    },
    setTick(fn) {
      tickFn = fn;
    }
  };
}

