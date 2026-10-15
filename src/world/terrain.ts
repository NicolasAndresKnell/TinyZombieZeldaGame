import { TILE_KIND } from '../types';
import { TILE_SIZE } from '../config';
import type { TileKind, Position } from '../types';

export const TILE_HEIGHT_LEVELS: Partial<Record<TileKind, number>> = {
  [TILE_KIND.Street]: 0,
  [TILE_KIND.Paving]: 0,
  [TILE_KIND.Lot]: 0,
  [TILE_KIND.Grass]: 0,
  [TILE_KIND.Bridge]: 0,
  [TILE_KIND.RoofLevelOne]: 1,
  [TILE_KIND.RoofLevelTwo]: 2,
  [TILE_KIND.RoofLevelThree]: 3,
};
export const HEIGHT_LEVEL_LABELS = ['STREET', 'ROOF L1', 'ROOF L2', 'ROOF L3'];

export const isSolid = (tileKind: TileKind) => tileKind === TILE_KIND.Water || tileKind === TILE_KIND.BuildingWall || tileKind === TILE_KIND.Obstacle;
export const isSlope = (tileKind: TileKind) => tileKind === TILE_KIND.Stairs || tileKind === TILE_KIND.Ramp;
export const isConnector = (tileKind: TileKind) => isSlope(tileKind) || tileKind === TILE_KIND.Bridge;

export function canEnter(from: TileKind, to: TileKind, level: number): boolean {
  if (isSolid(to)) return false;
  if (isConnector(to)) return true;
  const destinationHeight = TILE_HEIGHT_LEVELS[to];
  if (isSlope(from)) return true;
  if (from === TILE_KIND.Bridge && level >= 1) return destinationHeight !== undefined && destinationHeight >= 1;
  return destinationHeight === level;
}

export const tileBase = (tileX: number, tileY: number): Position => ({ x: tileX * TILE_SIZE + TILE_SIZE / 2, y: (tileY + 1) * TILE_SIZE });
