import { TILE_KIND } from '../types';
import { COLLISION_FOOTPRINT, TILE_SIZE, WORLD_MOVEMENT } from '../config';
import type { LevelData, TileKind } from '../types';
import { canEnter, TILE_HEIGHT_LEVELS, isConnector, tileBase } from './terrain';

export interface Mover { x: number; y: number; level: number; tileKind: TileKind }

export class World {
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;

  constructor(readonly level: LevelData) {
    this.width = level.width; this.height = level.height;
    this.pixelWidth = level.width * TILE_SIZE; this.pixelHeight = level.height * TILE_SIZE;
  }

  kindAt(tileX: number, tileY: number): TileKind {
    if (tileX < 0 || tileY < 0 || tileX >= this.width || tileY >= this.height) return TILE_KIND.Water;
    return this.level.tiles[tileY * this.width + tileX] as TileKind;
  }
  kindAtPixel(x: number, y: number) { return this.kindAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)); }

  tilesUnder(x: number, y: number): [number, number][] {
    const tiles: [number, number][] = [];
    const minTileX = Math.floor((x - COLLISION_FOOTPRINT.width / 2) / TILE_SIZE), maxTileX = Math.floor((x + COLLISION_FOOTPRINT.width / 2 - WORLD_MOVEMENT.tileEdgeEpsilon) / TILE_SIZE);
    const minTileY = Math.floor((y - COLLISION_FOOTPRINT.height) / TILE_SIZE), maxTileY = Math.floor((y - WORLD_MOVEMENT.tileEdgeEpsilon) / TILE_SIZE);
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) for (let tileX = minTileX; tileX <= maxTileX; tileX++) tiles.push([tileX, tileY]);
    return tiles;
  }

  canStand(mover: Mover, x: number, y: number) {
    const from = this.kindAtPixel(mover.x, mover.y - WORLD_MOVEMENT.feetSampleOffsetY);
    const before = new Set(this.tilesUnder(mover.x, mover.y).map(([tileX, tileY]) => tileY * this.width + tileX));
    for (const [tileX, tileY] of this.tilesUnder(x, y)) {
      if (before.has(tileY * this.width + tileX)) continue;
      if (!canEnter(from, this.kindAt(tileX, tileY), mover.level)) return false;
    }
    return true;
  }

  move(mover: Mover, deltaX: number, deltaY: number, assist = false) {
    let moved = false;
    for (const [movementX, movementY] of [[deltaX, 0], [0, deltaY]]) {
      if (!movementX && !movementY) continue;
      if (this.canStand(mover, mover.x + movementX, mover.y + movementY)) { mover.x += movementX; mover.y += movementY; moved = true; continue; }
      if (!assist) continue;
      for (let offset = 1; offset <= WORLD_MOVEMENT.maximumCornerAssistDistance; offset++) {
        const nudgeDirection = [-1, 1].find(sign => movementY === 0
          ? this.canStand(mover, mover.x + movementX, mover.y + sign * offset) && this.canStand(mover, mover.x, mover.y + sign)
          : this.canStand(mover, mover.x + sign * offset, mover.y + movementY) && this.canStand(mover, mover.x + sign, mover.y));
        if (nudgeDirection) { if (movementY === 0) mover.y += nudgeDirection; else mover.x += nudgeDirection; moved = true; break; }
      }
    }

    const tileKind = this.kindAtPixel(mover.x, mover.y - WORLD_MOVEMENT.feetSampleOffsetY);
    mover.tileKind = tileKind;
    if (!isConnector(tileKind)) mover.level = TILE_HEIGHT_LEVELS[tileKind] ?? mover.level;
    return moved;
  }

  openGroundNear(tileX: number, tileY: number) {
    const open = (x: number, y: number) => [[0, 0], [1, 0], [-1, 0], [0, -1]].every(([deltaX, deltaY]) => {
      const tileKind = this.kindAt(x + deltaX, y + deltaY);
      return TILE_HEIGHT_LEVELS[tileKind] === 0 && !isConnector(tileKind);
    });
    for (let searchRadius = 0; searchRadius < WORLD_MOVEMENT.openGroundSearchRadius; searchRadius++) {
      for (let deltaY = -searchRadius; deltaY <= searchRadius; deltaY++) for (let deltaX = -searchRadius; deltaX <= searchRadius; deltaX++) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) === searchRadius && open(tileX + deltaX, tileY + deltaY)) return tileBase(tileX + deltaX, tileY + deltaY);
      }
    }
    return tileBase(...this.level.start);
  }
}
