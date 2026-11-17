/**
 * Camera input: held keys (WASD/arrows pan, Q/E rotate, R/F tilt, Z/X zoom),
 * mouse wheel zoom, right-drag rotate, middle-drag pan and optional edge scroll.
 */
import type { CameraRig } from '../render/cameraRig';

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const CAMERA_KEYS = new Set([
  ...Object.keys(PAN_KEYS),
  'KeyQ',
  'KeyE',
  'KeyR',
  'KeyF',
  'KeyZ',
  'KeyX',
]);

const PAN_SPEED = 40; // tiles per second at the reference zoom
const ROTATE_SPEED = 1.6; // radians per second
const EDGE_PX = 12;

export class CameraInput {
  private readonly held = new Set<string>();
  private drag: { button: number; x: number; y: number } | null = null;
  private pointer: { x: number; y: number } | null = null;
  edgeScroll = false;

  constructor(
    private readonly rig: CameraRig,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.rig.zoom(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('pointerleave', () => (this.pointer = null));
  }

  /** Returns true if the key is a camera key (and so is consumed). */
  keyDown(code: string): boolean {
    if (!CAMERA_KEYS.has(code)) return false;
    this.held.add(code);
    return true;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Start a camera drag for right (2) / middle (1) buttons, or left (0) when asked to pan. */
  beginDrag(e: PointerEvent, forcePan = false): boolean {
    if (e.button !== 1 && e.button !== 2 && !forcePan) return false;
    this.drag = { button: forcePan ? 1 : e.button, x: e.clientX, y: e.clientY };
    return true;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  moveDrag(e: PointerEvent): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    if (this.drag.button === 2) this.rig.rotate(-dx * 0.006, dy * 0.004);
    else this.rig.pan(-dx * 0.12, dy * 0.12);
  }

  endDrag(): void {
    this.drag = null;
  }

  update(dt: number): void {
    let right = 0;
    let forward = 0;
    for (const code of this.held) {
      const p = PAN_KEYS[code];
      if (p) {
        right += p[0];
        forward += p[1];
      }
    }
    if (this.edgeScroll && this.pointer && !this.drag) {
      const { innerWidth: w, innerHeight: h } = window;
      if (this.pointer.x < EDGE_PX) right -= 1;
      if (this.pointer.x > w - EDGE_PX) right += 1;
      if (this.pointer.y < EDGE_PX) forward += 1;
      if (this.pointer.y > h - EDGE_PX) forward -= 1;
    }
    if (right || forward) this.rig.pan(right * PAN_SPEED * dt, forward * PAN_SPEED * dt);
    const yaw = (this.held.has('KeyQ') ? 1 : 0) - (this.held.has('KeyE') ? 1 : 0);
    const pitch = (this.held.has('KeyR') ? 1 : 0) - (this.held.has('KeyF') ? 1 : 0);
    if (yaw || pitch) this.rig.rotate(yaw * ROTATE_SPEED * dt, pitch * ROTATE_SPEED * 0.5 * dt);
    const zoom = (this.held.has('KeyX') ? 1 : 0) - (this.held.has('KeyZ') ? 1 : 0);
    if (zoom) this.rig.zoom(Math.exp(zoom * 1.5 * dt));
  }
}
