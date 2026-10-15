import Phaser from 'phaser';
import { CHARACTER_FRAME, ENEMY_TYPES } from '../config';
import sprites from '../data/sprites.json';
import type { AnimationFrameTable, SpriteData } from '../types';

const { heroAnimations, zombieAnimations, propSizes, brain } = sprites as unknown as SpriteData;
const SHEETS = ['hero', ...Object.values(ENEMY_TYPES).map(enemyStats => enemyStats.textureKey)];
const IMAGES = ['tiles', 'spit', 'level_ground', 'level_bridges', ...Object.keys(propSizes)];
const SPINNING_BRAINS = ['brain', 'brain_drop'] as const;
const FRAME_RATE: Record<string, number> = { idle: 6, walk: 10, slash1: 16, slash2: 14, spin: 20, attack: 16, hurt: 12, dead: 6, shot: 12, windup: 8, cast: 10 };
const BRAIN_SPIN_FRAME_RATE = 10;

export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    for (const key of SHEETS) this.load.spritesheet(key, `${key}.png`, { frameWidth: CHARACTER_FRAME.width, frameHeight: CHARACTER_FRAME.height });
    for (const key of IMAGES) this.load.image(key, `${key}.png`);
    for (const key of SPINNING_BRAINS) this.load.spritesheet(key, `${key}.png`, { frameWidth: brain[key][0], frameHeight: brain[key][1] });
  }

  create() {
    this.createAnimations('hero', heroAnimations);
    for (const enemyStats of Object.values(ENEMY_TYPES)) this.createAnimations(enemyStats.textureKey, zombieAnimations);
    for (const key of SPINNING_BRAINS) {
      this.anims.create({ key: `${key}_spin`, frames: this.anims.generateFrameNumbers(key), frameRate: BRAIN_SPIN_FRAME_RATE, repeat: -1 });
    }
    this.scene.start('GameScene');
  }

  private createAnimations(texture: string, table: AnimationFrameTable) {
    for (const [name, [start, count]] of Object.entries(table)) {
      const kind = name.split('_')[0];
      this.anims.create({
        key: `${texture}_${name}`,
        frames: this.anims.generateFrameNumbers(texture, { start, end: start + count - 1 }),
        frameRate: FRAME_RATE[kind],
        repeat: kind === 'idle' || kind === 'walk' ? -1 : 0,
      });
    }
  }
}
