export type SpaceInputState = {
  pitch: number;   // -1..1
  yaw: number;     // -1..1
  roll: number;    // -1..1
  throttleDelta: number; // -1..1 (per second)
  boost: boolean;
  brake: boolean;
  firePrimary: boolean;
  cycleTarget: boolean;
  hyperspace: boolean;
  toggleMap: boolean;
};

export function createSpaceInput(target: Window = window) {
  const keys = new Set<string>();
  let firePrimary = false;
  let cycleTarget = false;
  let hyperspace = false;
  let toggleMap = false;

  function onKeyDown(e: KeyboardEvent) {
    keys.add(e.key);
    if (e.key === " " || e.code === "Space") firePrimary = true;
    if (e.key.toLowerCase() === "t") cycleTarget = true;
    if (e.key.toLowerCase() === "h") hyperspace = true;
    if (e.key.toLowerCase() === "m") toggleMap = true;
  }
  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key);
  }
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);

  function axis(neg: string[], pos: string[]) {
    const n = neg.some((k) => keys.has(k)) ? 1 : 0;
    const p = pos.some((k) => keys.has(k)) ? 1 : 0;
    return p - n;
  }

  const state: SpaceInputState = {
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttleDelta: 0,
    boost: false,
    brake: false,
    firePrimary: false,
    cycleTarget: false,
    hyperspace: false,
    toggleMap: false
  };

  function update() {
    state.pitch = axis(["s", "ArrowDown"], ["w", "ArrowUp"]);
    state.yaw = axis(["d", "ArrowRight"], ["a", "ArrowLeft"]);
    state.roll = axis(["e"], ["q"]);
    state.throttleDelta = axis(["f"], ["r"]); // R up, F down
    state.boost = keys.has("Shift") || keys.has("ShiftLeft") || keys.has("ShiftRight");
    state.brake = keys.has("x");
    state.firePrimary = firePrimary;
    state.cycleTarget = cycleTarget;
    state.hyperspace = hyperspace;
    state.toggleMap = toggleMap;

    firePrimary = false;
    cycleTarget = false;
    hyperspace = false;
    toggleMap = false;
  }

  function dispose() {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
  }

  return { state, update, dispose };
}
