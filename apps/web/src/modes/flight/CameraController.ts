/**
 * CameraController - Manages flight mode camera behavior
 * Handles smooth follow camera, FOV adjustments, and look-ahead
 */

import * as THREE from "three";
import { Ship } from "@xwingz/gameplay";
import type { ModeContext } from "../types";
import type { SpaceInputState } from "@xwingz/gameplay";

export class CameraController {
  private initialized = false;
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();

  // Temp vectors (reused to avoid allocations)
  private tmpCamOffset = new THREE.Vector3();
  private tmpLookOffset = new THREE.Vector3();
  private tmpLookAt = new THREE.Vector3();
  private tmpDesiredLook = new THREE.Vector3();

  /**
   * Reset camera state
   */
  reset(): void {
    this.initialized = false;
  }

  /**
   * Update camera to follow player ship with smooth interpolation
   */
  update(
    ctx: ModeContext,
    shipEid: number,
    shipMesh: THREE.Object3D,
    input: SpaceInputState,
    dt: number
  ): void {
    const q = shipMesh.quaternion;
    const pos = shipMesh.position;

    // FOV adjustment for boost effect
    const boostFov = (Ship.throttle[shipEid] ?? 0) > 0.9 && input.boost ? 6 : 0;
    ctx.camera.fov = 70 + boostFov;
    ctx.camera.updateProjectionMatrix();

    // Calculate desired camera position (behind and above ship)
    const camOffset = this.tmpCamOffset.set(0, 6, 22).applyQuaternion(q);
    const desiredPos = this.tmpLookAt.copy(pos).add(camOffset);

    // Calculate desired look-at point (ahead of ship)
    const lookOffset = this.tmpLookOffset.set(0, 1.0, -48).applyQuaternion(q);
    const desiredLook = this.tmpDesiredLook.copy(pos).add(lookOffset);

    // Smooth interpolation
    const k = 1 - Math.exp(-dt * 6.5);
    if (!this.initialized) {
      this.smoothPos.copy(desiredPos);
      this.smoothLook.copy(desiredLook);
      this.initialized = true;
    } else {
      this.smoothPos.lerp(desiredPos, k);
      this.smoothLook.lerp(desiredLook, k);
    }

    ctx.camera.position.copy(this.smoothPos);
    ctx.camera.lookAt(this.smoothLook);
  }

  /**
   * Set initial camera position (when entering mode)
   */
  setInitialPosition(ctx: ModeContext, x: number, y: number, z: number): void {
    ctx.camera.position.set(x, y, z);
    ctx.camera.lookAt(0, 0, -50);
  }
}
