import Phaser from 'phaser';
import { CHARACTER_FRAME, ENEMY_TYPES } from '../config';
import sprites from '../data/sprites.json';
import type { AnimationFrameTable, SpriteData } from '../types';

const { heroAnimations, zombieAnimations, propSizes } = sprites as unknown as SpriteData;
const SHEETS = ['hero', ...Object.values(ENEMY_TYPES).map(enemyStats => enemyStats.textureKey)];
const IMAGES = ['tiles', 'brain', 'brain_drop', 'spit', 'level_ground', 'level_bridges', ...Object.keys(propSizes)];
const FRAME_RATE: Record<string, number> = { idle: 6, walk: 10, attack: 16, combo: 18, hurt: 12, dead: 6, shot: 12, windup: 8, cast: 10 };

export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    this.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    for (const key of SHEETS) this.load.spritesheet(key, `${key}.png`, { frameWidth: CHARACTER_FRAME.width, frameHeight: CHARACTER_FRAME.height });
    for (const key of IMAGES) this.load.image(key, `${key}.png`);
  }

  create() {
    this.createAnimations('hero', heroAnimations);
    for (const enemyStats of Object.values(ENEMY_TYPES)) this.createAnimations(enemyStats.textureKey, zombieAnimations);
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
