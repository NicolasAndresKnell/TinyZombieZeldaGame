// =====================================================================
// CONFIG — shared numbers. Change tuning here, not inside scenes.
// =====================================================================
import type { Direction, EnemyType, EnemyTypeName, Vec } from './types';

export const TILE_SIZE = 16;
export const SCREEN = { w: 320, h: 180 };

// Every character frame is a 48x32 cell; the feet sit at (24, 30).
// That's why sprites use origin (0.5, 30/32): x/y = where the feet touch the ground.
export const CELL = { w: 48, h: 32, footY: 30 };
export const FEET = { w: 10, h: 5 };      // collision box under every walker

export const PLAYER = {
  speed: 82,                       // pixels per second
  maxHealth: 5,                    // hearts (each brain heals one)
  invulnerableMs: 1000,
  knockbackSpeed: 170, knockbackMs: 180,
};

export interface ComboHit {
  anim: 'attack' | 'combo';
  swingMs: number; hitDelayMs: number; damage: number; lunge: number; knock: number;
  reach?: number; w?: number; h?: number;   // a box in front of the hero...
  radius?: number; finisher?: boolean;      // ...or a ring all around (the finisher)
}

// The sword combo: tap attack again near the end of a swing to chain the next hit.
// Hit 3 is a spinning finisher that hits all around you.
export const COMBO: ComboHit[] = [
  { anim: 'attack', swingMs: 240, hitDelayMs: 110, damage: 1, reach: 13, w: 20, h: 18, lunge: 0, knock: 150 },
  { anim: 'combo',  swingMs: 210, hitDelayMs: 90,  damage: 1, reach: 16, w: 22, h: 20, lunge: 6, knock: 170 },
  { anim: 'attack', swingMs: 340, hitDelayMs: 120, damage: 2, radius: 28,           lunge: 4, knock: 240, finisher: true },
];
export const COMBO_WINDOW_MS = 380;      // time after a swing in which the next tap continues the combo
export const FINISHER_REST_MS = 260;     // short pause after the finisher

// Three enemy types (plus the boss). Outline colour on the sprite tells them apart.
export const ENEMY_TYPES: Record<EnemyTypeName, EnemyType> = {
  walker: {   // grey outline: shambles up and swings
    sheet: 'zombie_walker', health: 3, scale: 1, wanderSpeed: 14, chaseSpeed: 31, chaseRange: 100,
    attack: 'melee', range: 17, reach: 22, damage: 1, windupMs: 220, attackMs: 420, cooldownMs: 1100,
    stunMs: 260, knockTaken: 1,
  },
  spitter: {  // green outline: keeps its distance and spits
    sheet: 'zombie_spitter', health: 2, scale: 1, wanderSpeed: 14, chaseSpeed: 26, chaseRange: 140,
    attack: 'spit', keepAway: [56, 110], damage: 1, windupMs: 240, attackMs: 380, cooldownMs: 1700,
    spitSpeed: 95, stunMs: 260, knockTaken: 1.1,
  },
  brute: {    // red outline: slow and tough, winds up a ground slam
    sheet: 'zombie_brute', health: 6, scale: 1.35, wanderSpeed: 10, chaseSpeed: 22, chaseRange: 110,
    attack: 'slam', range: 26, slamRadius: 34, damage: 2, windupMs: 650, attackMs: 1000, cooldownMs: 1800,
    stunMs: 180, knockTaken: 0.45,
  },
  boss: {     // gold outline: the Brain King, the bonus objective
    sheet: 'zombie_boss', health: 30, scale: 2, wanderSpeed: 0, chaseSpeed: 26, chaseRange: 600,
    attack: 'boss', range: 34, slamRadius: 52, damage: 2, windupMs: 700, attackMs: 1050, cooldownMs: 1500,
    spitSpeed: 105, stunMs: 120, knockTaken: 0.15,
  },
};
// Which type each spawn point gets: mostly walkers, some spitters, a few brutes.
export const typeForSpawn = (i: number): EnemyTypeName => {
  const r = (i * 7) % 20;
  return r < 12 ? 'walker' : r < 17 ? 'spitter' : 'brute';
};
export const SLEEP_RANGE = 420;   // enemies further than this from the player don't think (saves work)

export const BRAINS_TO_WIN = 10;

// Drawing order: walkers above street level are drawn over bridges (depth 9999),
// walkers on the street are drawn under them.
export const RAISED_DEPTH = 10000;
export const BRIDGE_DEPTH = 9999;
export const HUD_DEPTH = 100000;

export const DIRS: Record<Direction, Vec> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
export const UI = {
  heartFull: 0xe0504f, heartEmpty: 0x3b3445, font: '"Pixelify Sans", monospace', ink: '#3a2c38',
  brain: 0xf08caa, gold: 0xffce48,
};
export const SHADOW_ALPHA = 0.4;

// Multiplayer: how often we send our hero, and how other heroes are drawn.
export const NET = {
  channel: 'tiny-zombie',
  maxNameLength: 12,
  sendMs: 100, heartbeatMs: 1000, staleMs: 5000, smoothing: 12,
  tints: [0x8fd3ff, 0xffd36b, 0xb48cff, 0x7dffa0, 0xff9ad5],
};

export const depthFor = (level: number, y: number) => (level >= 1 ? RAISED_DEPTH : 0) + y;
