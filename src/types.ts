export interface Position {
  x: number;
  y: number;
}

export type Direction = 'down' | 'up' | 'left' | 'right';

export const TILE_KIND = {
  Street: 'S',
  Paving: 'P',
  Lot: 'A',
  Grass: 'G',
  Bridge: 'R',
  Stairs: 'T',
  Ramp: 'M',
  RoofLevelOne: '1',
  RoofLevelTwo: '2',
  RoofLevelThree: '3',
  Water: 'W',
  BuildingWall: 'B',
  Obstacle: 'K',
} as const;

export type TileKind = typeof TILE_KIND[keyof typeof TILE_KIND];

export type EnemyKind = 'walker' | 'spitter' | 'brute' | 'boss';
export type EnemyTextureKey = `zombie_${EnemyKind}`;

export interface EnemyStats {
  textureKey: EnemyTextureKey;
  health: number;
  scale: number;
  wanderSpeed: number;
  chaseSpeed: number;
  chaseRange: number;
  attackKind: 'melee' | 'spit' | 'slam' | 'boss';
  damage: number;
  windupMs: number;
  attackMs: number;
  cooldownMs: number;
  stunMs: number;
  knockbackMultiplier: number;
  attackRange?: number;
  meleeReach?: number;
  preferredDistanceRange?: [minimumDistance: number, maximumDistance: number];
  slamRadius?: number;
  spitSpeed?: number;
}

export type TilePosition = [tileX: number, tileY: number, heightLevel: number];

export interface LevelData {
  width: number;
  height: number;
  tiles: string;
  start: [tileX: number, tileY: number];
  props: [textureKey: string, pixelX: number, pixelY: number][];
  zombies: TilePosition[];
  brains: TilePosition[];
}

export type AnimationFrameTable = Record<string, [firstFrame: number, frameCount: number]>;

export interface SpriteData {
  heroAnimations: AnimationFrameTable;
  zombieAnimations: AnimationFrameTable;
  propSizes: Record<string, [width: number, height: number]>;
  brain: { brain: [width: number, height: number]; brain_drop: [width: number, height: number]; frames: number };
}

export interface NetworkPlayerState {
  x: number;
  y: number;
  heightLevel: number;
  facing: Direction;
  animationKey: string;
  isDead: boolean;
  playerName?: string;
}

export interface RemotePlayer {
  id: string;
  hero: NetworkPlayerState;
}
