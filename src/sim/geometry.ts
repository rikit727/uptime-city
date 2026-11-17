/**
 * Tile-shape helpers shared by the sim (to apply commands) and the UI (to
 * preview them), so a preview always matches what the command will do.
 */
import type { TileCoord } from './types';

/**
 * Tiles for a road dragged from `a` to `b`: an L-shaped path that runs along
 * the longer axis first, then turns. A straight drag gives a straight road.
 */
export function roadPath(a: TileCoord, b: TileCoord): TileCoord[] {
  const out: TileCoord[] = [];
  const horizontalFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horizontalFirst) {
    for (const x of steps(a.x, b.x)) out.push({ x, y: a.y });
    for (const y of steps(a.y, b.y).slice(1)) out.push({ x: b.x, y });
  } else {
    for (const y of steps(a.y, b.y)) out.push({ x: a.x, y });
    for (const x of steps(a.x, b.x).slice(1)) out.push({ x, y: b.y });
  }
  return out;
}

/** Integers from `from` to `to` inclusive, in either direction. */
function steps(from: number, to: number): number[] {
  const dir = to >= from ? 1 : -1;
  const out: number[] = [];
  for (let v = from; v !== to + dir; v += dir) out.push(v);
  return out;
}

/** All tiles in the rectangle spanned by two corners (inclusive), row by row. */
export function rectTiles(a: TileCoord, b: TileCoord): TileCoord[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out: TileCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}
