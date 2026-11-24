/**
 * One hemisphere light and one directional "sun". The sun swings across the sky
 * with the game clock, and light intensity and sky colour fade towards night.
 */
import type { Scene } from 'three';
import { Color, DirectionalLight, HemisphereLight } from 'three';
import { MINUTES_PER_DAY, minuteOfDay } from '../sim';

const DAY_SKY = new Color('#a9cbe3');
const NIGHT_SKY = new Color('#0e1724');

export class Lighting {
  readonly hemi = new HemisphereLight('#dfefff', '#4d5a3a', 1.1);
  readonly sun = new DirectionalLight('#fff4e0', 1.6);
  private readonly sky = new Color();

  constructor(
    private readonly scene: Scene,
    private readonly centre: { x: number; z: number },
  ) {
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.target.position.set(centre.x, 0, centre.z);
    const cam = this.sun.shadow.camera;
    cam.left = -90;
    cam.right = 90;
    cam.top = 90;
    cam.bottom = -90;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048);
  }

  setShadows(enabled: boolean): void {
    this.sun.castShadow = enabled;
  }

  /** 0 at night, 1 at full day, smooth through dawn (~05:00–07:00) and dusk (~19:00–21:00). */
  static daylight(minute: number): number {
    const h = minuteOfDay(minute) / 60;
    const s = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    return s(5, 7, h) * (1 - s(19, 21, h));
  }

  update(minute: number): void {
    const day = Lighting.daylight(minute);
    const angle = (minuteOfDay(minute) / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2;
    // Sun rises in the east (+x), peaks at noon, sets in the west.
    const elevation = Math.max(0.25, Math.sin(angle));
    this.sun.position.set(
      this.centre.x + Math.cos(angle) * 120,
      40 + elevation * 120,
      this.centre.z + 60,
    );
    this.sun.intensity = 0.15 + 1.5 * day;
    this.hemi.intensity = 0.35 + 0.8 * day;
    this.sky.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    this.scene.background = this.sky;
  }
}
