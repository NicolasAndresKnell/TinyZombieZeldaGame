// =====================================================================
// TERRAIN RULES — the map is a grid of one-letter tile kinds (see tools/level.py).
//   S street  P paving  A lot  G grass   → ground, height 0
//   1 2 3 roofs                          → heights 1, 2, 3
//   T stairs   R bridge (street underneath)
//   W water  B building wall  K block/tree → solid
// =====================================================================
import { TILE_SIZE } from '../config';
import type { TileKind, Vec } from '../types';

export const HEIGHT: Partial<Record<TileKind, number>> = { S: 0, P: 0, A: 0, G: 0, R: 0, 1: 1, 2: 2, 3: 3 };
export const HEIGHT_NAMES = ['STREET', 'ROOF L1', 'ROOF L2', 'ROOF L3'];

export const isSolid = (k: TileKind) => k === 'W' || k === 'B' || k === 'K';
export const isConnector = (k: TileKind) => k === 'T' || k === 'R';   // stairs and bridges

// Can a walker at `level`, standing on tile kind `from`, step onto tile kind `to`?
// Stairs and bridges can be entered from anywhere; leaving stairs puts you at the
// height of wherever you step; from a raised bridge you can only step onto a roof.
// Everywhere else you can only walk onto tiles of your own height.
// (tools/level.py uses the same rules to check every brain can be reached.)
export function canEnter(from: TileKind, to: TileKind, level: number): boolean {
  if (isSolid(to)) return false;
  if (isConnector(to)) return true;
  const h = HEIGHT[to];
  if (from === 'T') return true;
  if (from === 'R' && level >= 1) return h !== undefined && h >= 1;
  return h === level;
}

// Bottom-centre of a tile, in pixels.
export const tileBase = (tx: number, ty: number): Vec => ({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: (ty + 1) * TILE_SIZE });
