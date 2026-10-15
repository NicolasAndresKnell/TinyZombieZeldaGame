import type { Direction, EnemyStats, EnemyKind, Position } from './types';

export const TILE_SIZE = 16;
export const VIEWPORT = { width: 320, height: 180 };

export const CHARACTER_FRAME = { width: 48, height: 32, feetOffsetY: 30 };
export const COLLISION_FOOTPRINT = { width: 10, height: 5 };

export const PLAYER = {
  speed: 82,
  maxHealth: 5,
  invulnerableMs: 1000,
  knockbackSpeed: 170, knockbackMs: 180,
};

interface SwordSwingTiming {
  animation: 'attack' | 'combo';
  swingMs: number;
  hitDelayMs: number;
  damage: number;
  lungeDistance: number;
  knockbackSpeed: number;
}

export type SwordComboStep = SwordSwingTiming & (
  | { isFinisher: false; reach: number; width: number; height: number }
  | { isFinisher: true; radius: number }
);

export const SWORD_COMBO: SwordComboStep[] = [
  { isFinisher: false, animation: 'attack', swingMs: 240, hitDelayMs: 110, damage: 1, reach: 13, width: 20, height: 18, lungeDistance: 0, knockbackSpeed: 150 },
  { isFinisher: false, animation: 'combo',  swingMs: 210, hitDelayMs: 90,  damage: 1, reach: 16, width: 22, height: 20, lungeDistance: 6, knockbackSpeed: 170 },
  { animation: 'attack', swingMs: 340, hitDelayMs: 120, damage: 2, radius: 28,           lungeDistance: 4, knockbackSpeed: 240, isFinisher: true },
];
export const COMBO_WINDOW_MS = 380;
export const FINISHER_REST_MS = 260;

export const ENEMY_TYPES: Record<EnemyKind, EnemyStats> = {
  walker: {
    textureKey: 'zombie_walker', health: 3, scale: 1, wanderSpeed: 14, chaseSpeed: 31, chaseRange: 100,
    attackKind: 'melee', attackRange: 17, meleeReach: 22, damage: 1, windupMs: 220, attackMs: 420, cooldownMs: 1100,
    stunMs: 260, knockbackMultiplier: 1,
  },
  spitter: {
    textureKey: 'zombie_spitter', health: 2, scale: 1, wanderSpeed: 14, chaseSpeed: 26, chaseRange: 140,
    attackKind: 'spit', preferredDistanceRange: [56, 110], damage: 1, windupMs: 240, attackMs: 380, cooldownMs: 1700,
    spitSpeed: 95, stunMs: 260, knockbackMultiplier: 1.1,
  },
  brute: {
    textureKey: 'zombie_brute', health: 6, scale: 1.35, wanderSpeed: 10, chaseSpeed: 22, chaseRange: 110,
    attackKind: 'slam', attackRange: 26, slamRadius: 34, damage: 2, windupMs: 650, attackMs: 1000, cooldownMs: 1800,
    stunMs: 180, knockbackMultiplier: 0.45,
  },
  boss: {
    textureKey: 'zombie_boss', health: 30, scale: 2, wanderSpeed: 0, chaseSpeed: 26, chaseRange: 600,
    attackKind: 'boss', attackRange: 34, slamRadius: 52, damage: 2, windupMs: 700, attackMs: 1050, cooldownMs: 1500,
    spitSpeed: 105, stunMs: 120, knockbackMultiplier: 0.15,
  },
};

const SPAWN_DISTRIBUTION_STRIDE = 7;
const SPAWN_DISTRIBUTION_SIZE = 20;
const WALKER_SPAWN_SLOTS = 12;
const SPITTER_SPAWN_SLOTS = 5;

export const enemyKindForSpawn = (spawnIndex: number): EnemyKind => {
  const spawnDistributionSlot = (spawnIndex * SPAWN_DISTRIBUTION_STRIDE) % SPAWN_DISTRIBUTION_SIZE;
  return spawnDistributionSlot < WALKER_SPAWN_SLOTS ? 'walker' : spawnDistributionSlot < WALKER_SPAWN_SLOTS + SPITTER_SPAWN_SLOTS ? 'spitter' : 'brute';
};
export const ENEMY_ACTIVATION_DISTANCE = 420;

export const BRAINS_TO_WIN = 10;

export const RAISED_DEPTH = 10000;
export const BRIDGE_DEPTH = 9999;
export const HUD_DEPTH = 100000;

export const DIRECTION_VECTORS: Record<Direction, Position> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
export const UI = {
  heartFull: 0xe0504f, heartEmpty: 0x3b3445, font: '"Pixelify Sans", monospace', ink: '#3a2c38',
  brain: 0xf08caa, gold: 0xffce48,
};
export const SHADOW_ALPHA = 0.4;

export const MULTIPLAYER = {
  channel: 'tiny-zombie',
  maxNameLength: 12,
  nameAboveFeet: CHARACTER_FRAME.feetOffsetY + 2,
  sendMs: 100, heartbeatMs: 1000, staleMs: 5000, smoothing: 12,
  tints: [0x8fd3ff, 0xffd36b, 0xb48cff, 0x7dffa0, 0xff9ad5],
};

export const depthForHeight = (level: number, y: number) => (level >= 1 ? RAISED_DEPTH : 0) + y;

export const SIMULATION = {
  maximumFrameDurationMs: 50,
  millisecondsPerSecond: 1000,
};

export const WORLD_MOVEMENT = {
  tileEdgeEpsilon: 0.01,
  feetSampleOffsetY: 2,
  maximumCornerAssistDistance: 6,
  openGroundSearchRadius: 12,
};

export const PICKUPS = {
  brainCollectionRadius: 13,
  dropCollectionRadius: 16,
  healthRestoredPerBrain: 1,
};

export const SPIT_PROJECTILE = {
  lifetimeSeconds: 2.2,
  collisionHalfExtent: 6,
  spawnOffset: 8,
  imageOffsetY: 9,
  rotationSpeed: 10,
};
