/**
 * One hemisphere light and one directional "sun". The sun swings across the sky
 * with the game clock; light intensity and sky colour fade towards night using
 * the sim's seasonal day length, and cloud cover greys and dims the sky.
 */
import type { Scene } from 'three';
import { Color, DirectionalLight, HemisphereLight } from 'three';
import { MINUTES_PER_DAY, daylight, minuteOfDay } from '../sim';

const DAY_SKY = new Color('#a9cbe3');
const OVERCAST_SKY = new Color('#9aa3ab');
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

  private readonly daySky = new Color();

  /** `cloud` is 0..1 cover from the weather. */
  update(minute: number, cloud: number): void {
    const day = daylight(minute);
    const angle = (minuteOfDay(minute) / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2;
    // Sun rises in the east (+x), peaks at noon, sets in the west.
    const elevation = Math.max(0.25, Math.sin(angle));
    this.sun.position.set(
      this.centre.x + Math.cos(angle) * 120,
      40 + elevation * 120,
      this.centre.z + 60,
    );
    this.sun.intensity = 0.15 + 1.5 * day * (1 - 0.45 * cloud);
    this.hemi.intensity = 0.35 + 0.8 * day * (1 - 0.15 * cloud);
    this.daySky.copy(DAY_SKY).lerp(OVERCAST_SKY, cloud);
    this.sky.copy(NIGHT_SKY).lerp(this.daySky, day);
    this.scene.background = this.sky;
  }
}
