export type SpaceInputState = {
  pitch: number;   // -1..1
  yaw: number;     // -1..1
  roll: number;    // -1..1
  throttleDelta: number; // -1..1 (per second)
  boost: boolean;
  brake: boolean;
  firePrimary: boolean;
  fireSecondary: boolean;  // Proton torpedoes
  switchWeapon: boolean;   // Toggle between lasers/torpedoes
  cycleTarget: boolean;
  hyperspace: boolean;
  toggleMap: boolean;
};

export function createSpaceInput(target: Window = window) {
  const keys = new Set<string>();
  let cycleTarget = false;
  let hyperspace = false;
  let toggleMap = false;
  let switchWeapon = false;

  function onKeyDown(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.add(key);
    if (e.key.toLowerCase() === "t") cycleTarget = true;
    if (e.key.toLowerCase() === "h") hyperspace = true;
    if (e.key.toLowerCase() === "m") toggleMap = true;
    if (e.key.toLowerCase() === "v") switchWeapon = true;  // V to switch weapons
  }
  function onKeyUp(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(key);
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
    fireSecondary: false,
    switchWeapon: false,
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
    state.firePrimary = keys.has(" ");
    state.fireSecondary = keys.has("c");  // C to fire torpedoes
    state.switchWeapon = switchWeapon;
    state.cycleTarget = cycleTarget;
    state.hyperspace = hyperspace;
    state.toggleMap = toggleMap;

    switchWeapon = false;
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
