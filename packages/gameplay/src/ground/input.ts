// ─────────────────────────────────────────────────────────────────────────────
// GROUND INPUT STATE (Third-person infantry controls)
// ─────────────────────────────────────────────────────────────────────────────

export type GroundInputState = {
  moveX: number;       // -1..1 (A/D strafe)
  moveZ: number;       // -1..1 (W/S forward/back)
  jump: boolean;       // Space (one-shot)
  sprint: boolean;     // Shift held
  crouch: boolean;     // Ctrl held
  interact: boolean;   // E key (one-shot, vehicle enter/exit)
  firePrimary: boolean; // Mouse left or Space
  aimYaw: number;      // Accumulated mouse X (radians)
  aimPitch: number;    // Accumulated mouse Y (radians, clamped)
};

const PITCH_MIN = -Math.PI * 0.44; // ~-80 degrees
const PITCH_MAX = Math.PI * 0.44;  // ~+80 degrees
const MOUSE_SENSITIVITY = 0.002;

export function createGroundInput(target: HTMLElement | Window = window) {
  const keys = new Set<string>();
  let jumpPressed = false;
  let interactPressed = false;
  let mouseDeltaX = 0;
  let mouseDeltaY = 0;
  let isPointerLocked = false;

  const state: GroundInputState = {
    moveX: 0,
    moveZ: 0,
    jump: false,
    sprint: false,
    crouch: false,
    interact: false,
    firePrimary: false,
    aimYaw: 0,
    aimPitch: 0
  };

  function onKeyDown(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.add(key);

    if (key === " " || key === "Space") jumpPressed = true;
    if (key === "e") interactPressed = true;
  }

  function onKeyUp(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(key);
  }

  function onMouseMove(e: MouseEvent) {
    if (!isPointerLocked) return;
    mouseDeltaX += e.movementX;
    mouseDeltaY += e.movementY;
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button === 0) {
      // Left click - request pointer lock or mark fire
      if (!isPointerLocked && target instanceof HTMLElement) {
        target.requestPointerLock();
      }
    }
  }

  function onPointerLockChange() {
    isPointerLocked = document.pointerLockElement === target;
  }

  // Attach listeners
  const eventTarget = target instanceof Window ? window : target;
  eventTarget.addEventListener("keydown", onKeyDown as EventListener);
  eventTarget.addEventListener("keyup", onKeyUp as EventListener);
  eventTarget.addEventListener("mousemove", onMouseMove as EventListener);
  eventTarget.addEventListener("mousedown", onMouseDown as EventListener);
  document.addEventListener("pointerlockchange", onPointerLockChange);

  function axis(neg: string[], pos: string[]): number {
    const n = neg.some((k) => keys.has(k)) ? 1 : 0;
    const p = pos.some((k) => keys.has(k)) ? 1 : 0;
    return p - n;
  }

  function update(): void {
    // WASD movement
    state.moveX = axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
    state.moveZ = axis(["s", "ArrowDown"], ["w", "ArrowUp"]);

    // Modifiers
    state.sprint = keys.has("Shift") || keys.has("ShiftLeft") || keys.has("ShiftRight");
    state.crouch = keys.has("Control") || keys.has("ControlLeft") || keys.has("ControlRight");

    // One-shot inputs
    state.jump = jumpPressed;
    state.interact = interactPressed;
    jumpPressed = false;
    interactPressed = false;

    // Fire
    state.firePrimary = keys.has(" ") || keys.has("Space");

    // Mouse look (accumulate into yaw/pitch)
    if (isPointerLocked) {
      state.aimYaw -= mouseDeltaX * MOUSE_SENSITIVITY;
      state.aimPitch -= mouseDeltaY * MOUSE_SENSITIVITY;
      state.aimPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, state.aimPitch));
    }
    mouseDeltaX = 0;
    mouseDeltaY = 0;
  }

  function dispose(): void {
    eventTarget.removeEventListener("keydown", onKeyDown as EventListener);
    eventTarget.removeEventListener("keyup", onKeyUp as EventListener);
    eventTarget.removeEventListener("mousemove", onMouseMove as EventListener);
    eventTarget.removeEventListener("mousedown", onMouseDown as EventListener);
    document.removeEventListener("pointerlockchange", onPointerLockChange);
  }

  function requestPointerLock(): void {
    if (target instanceof HTMLElement) {
      target.requestPointerLock();
    }
  }

  function exitPointerLock(): void {
    if (isPointerLocked) {
      document.exitPointerLock();
    }
  }

  return {
    state,
    update,
    dispose,
    requestPointerLock,
    exitPointerLock,
    get isPointerLocked() {
      return isPointerLocked;
    }
  };
}
