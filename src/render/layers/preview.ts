/** Tool preview (tiles a drag will change, and blocked tiles) plus the hover cursor. */
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three';
import { TileInstances } from './tileInstances';

const OK = new Color('#ffffff');
const REMOVE = new Color('#ff9a3c');
const BLOCKED = new Color('#d03030');

export interface PreviewTiles {
  affected: readonly number[];
  blocked: readonly number[];
  /** Tiles of buildings that will be demolished (orange). */
  removed?: readonly number[];
  /** Tint affected tiles as removals (bulldoze) rather than additions. */
  removing?: boolean;
  /** Whole action invalid (e.g. too expensive): tint everything red. */
  invalid?: boolean;
}

export class PreviewLayer {
  readonly group = new Group();
  private readonly tiles: TileInstances;
  private readonly cursor: Mesh;

  constructor(
    width: number,
    height: number,
    private readonly mapWidth = width,
  ) {
    const mat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
    mat.depthWrite = false;
    this.tiles = new TileInstances(width * height * 2, width, 0.96, 0.04, mat);
    this.tiles.mesh.renderOrder = 10;
    this.group.add(this.tiles.mesh);
    const cursorMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
    cursorMat.depthWrite = false;
    this.cursor = new Mesh(new BoxGeometry(1, 0.05, 1), cursorMat);
    this.cursor.renderOrder = 11;
    this.cursor.visible = false;
    this.group.add(this.cursor);
  }

  setCursor(tile: number | null): void {
    if (tile === null) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cursor.position.set(
      (tile % this.mapWidth) + 0.5,
      0.08,
      Math.floor(tile / this.mapWidth) + 0.5,
    );
  }

  show(p: PreviewTiles | null): void {
    this.tiles.begin();
    if (p) {
      const main = p.invalid ? BLOCKED : p.removing ? REMOVE : OK;
      for (const i of p.affected) this.tiles.add(i, 0.09, main);
      for (const i of p.removed ?? []) this.tiles.add(i, 0.1, REMOVE);
      for (const i of p.blocked) this.tiles.add(i, 0.09, BLOCKED);
    }
    this.tiles.end();
  }
}
