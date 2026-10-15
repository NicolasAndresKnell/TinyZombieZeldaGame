// =====================================================================
// WORLD — the tile grid and how walkers move over it.
// Movement checks tiles instead of using a physics engine.
// =====================================================================
import { FEET, TILE_SIZE } from '../config';
import type { LevelData, TileKind } from '../types';
import { canEnter, HEIGHT, isConnector, tileBase } from './terrain';

// Anything that can walk the map: needs a position and a height level.
export interface Mover { x: number; y: number; level: number; tileKind: TileKind }

export class World {
  readonly w: number;
  readonly h: number;
  readonly pixelW: number;
  readonly pixelH: number;

  constructor(readonly level: LevelData) {
    this.w = level.w; this.h = level.h;
    this.pixelW = level.w * TILE_SIZE; this.pixelH = level.h * TILE_SIZE;
  }

  kindAt(tx: number, ty: number): TileKind {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 'W';   // outside = solid
    return this.level.tiles[ty * this.w + tx] as TileKind;
  }
  kindAtPixel(x: number, y: number) { return this.kindAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)); }

  // Tile indexes covered by a feet box standing at (x, y).
  tilesUnder(x: number, y: number): [number, number][] {
    const out: [number, number][] = [];
    const x0 = Math.floor((x - FEET.w / 2) / TILE_SIZE), x1 = Math.floor((x + FEET.w / 2 - 0.01) / TILE_SIZE);
    const y0 = Math.floor((y - FEET.h) / TILE_SIZE), y1 = Math.floor((y - 0.01) / TILE_SIZE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push([tx, ty]);
    return out;
  }

  // Could walker w stand at (x, y)? Only tiles it isn't already touching are checked,
  // so standing half on stairs and half on a roof never traps you.
  canStand(w: Mover, x: number, y: number) {
    const from = this.kindAtPixel(w.x, w.y - 2);
    const before = new Set(this.tilesUnder(w.x, w.y).map(([tx, ty]) => ty * this.w + tx));
    for (const [tx, ty] of this.tilesUnder(x, y)) {
      if (before.has(ty * this.w + tx)) continue;
      if (!canEnter(from, this.kindAt(tx, ty), w.level)) return false;
    }
    return true;
  }

  // Move one axis at a time, so you slide along walls instead of sticking.
  // With `assist`, a blocked move nudges you around corners (up to 6px).
  move(w: Mover, dx: number, dy: number, assist = false) {
    let moved = false;
    for (const [mx, my] of [[dx, 0], [0, dy]]) {
      if (!mx && !my) continue;
      if (this.canStand(w, w.x + mx, w.y + my)) { w.x += mx; w.y += my; moved = true; continue; }
      if (!assist) continue;
      for (let off = 1; off <= 6; off++) {
        const s = [-1, 1].find(sign => my === 0
          ? this.canStand(w, w.x + mx, w.y + sign * off) && this.canStand(w, w.x, w.y + sign)
          : this.canStand(w, w.x + sign * off, w.y + my) && this.canStand(w, w.x + sign, w.y));
        if (s) { if (my === 0) w.y += s; else w.x += s; moved = true; break; }
      }
    }
    // Your height changes when your feet settle on a roof or ground tile.
    const k = this.kindAtPixel(w.x, w.y - 2);
    w.tileKind = k;
    if (!isConnector(k)) w.level = HEIGHT[k] ?? w.level;
    return moved;
  }

  // The nearest street-level tile with open ground around it (searches outward in rings).
  openGroundNear(tx: number, ty: number) {
    const open = (x: number, y: number) => [[0, 0], [1, 0], [-1, 0], [0, -1]].every(([dx, dy]) => {
      const k = this.kindAt(x + dx, y + dy);
      return HEIGHT[k] === 0 && !isConnector(k);
    });
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && open(tx + dx, ty + dy)) return tileBase(tx + dx, ty + dy);
      }
    }
    return tileBase(...this.level.start);
  }
}
