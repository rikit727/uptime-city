/**
 * RTS-style camera: orbits a target point on the ground. Pitch is clamped to
 * PITCH_MIN..PITCH_MAX so the player never looks straight down or along the ground.
 * Input handling lives in app/; this class only holds and applies camera maths.
 */
import { PerspectiveCamera, Vector3 } from 'three';

export const PITCH_MIN = (30 * Math.PI) / 180;
export const PITCH_MAX = (70 * Math.PI) / 180;
export const DISTANCE_MIN = 8;
export const DISTANCE_MAX = 170;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly target = new Vector3();
  yaw = Math.PI / 4;
  pitch = (50 * Math.PI) / 180;
  distance = 90;

  constructor(
    aspect: number,
    private readonly bounds: { width: number; height: number },
  ) {
    this.camera = new PerspectiveCamera(45, aspect, 0.5, 1200);
    this.target.set(bounds.width / 2, 0, bounds.height / 2);
    this.apply();
  }

  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, PITCH_MIN, PITCH_MAX);
    this.apply();
  }

  zoom(factor: number): void {
    this.distance = clamp(this.distance * factor, DISTANCE_MIN, DISTANCE_MAX);
    this.apply();
  }

  /** Pan in screen-aligned ground directions; amounts are in tiles at the current zoom. */
  pan(right: number, forward: number): void {
    const scale = this.distance / 60;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Camera looks along -(sin, cos) in the xz plane.
    this.target.x += (cos * right - sin * forward) * scale;
    this.target.z += (-sin * right - cos * forward) * scale;
    this.target.x = clamp(this.target.x, 0, this.bounds.width);
    this.target.z = clamp(this.target.z, 0, this.bounds.height);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  apply(): void {
    const horizontal = this.distance * Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + horizontal * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
      this.target.z + horizontal * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }
}
