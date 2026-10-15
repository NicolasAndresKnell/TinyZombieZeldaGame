// =====================================================================
// WALKER — anything that moves on the map: hero, enemies, other players.
// It has a height `level` and moves with scene.world.move().
// =====================================================================
import Phaser from 'phaser';
import { CELL, depthFor, SHADOW_ALPHA } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { TileKind } from '../types';

export class Walker extends Phaser.GameObjects.Sprite {
  declare scene: GameScene;
  level: number;
  tileKind: TileKind = 'P';
  shadow: Phaser.GameObjects.Ellipse;
  // Knockback: a push that lasts a few frames.
  private pushX = 0;
  private pushY = 0;
  private pushUntil = 0;

  constructor(scene: GameScene, x: number, y: number, texture: string, level: number, scale = 1) {
    super(scene, x, y, texture, 0);
    scene.add.existing(this);
    this.setOrigin(0.5, CELL.footY / CELL.h).setScale(scale);
    this.level = level;
    this.shadow = scene.add.ellipse(x, y, 12 * scale, 4 * scale, 0x000000, SHADOW_ALPHA);
  }

  get onStairs() { return this.tileKind === 'T'; }

  // Same height, or one of us on stairs (stairs are between heights).
  sameHeightAs(other: Walker) {
    return this.level === other.level || this.onStairs || other.onStairs;
  }

  push(fromX: number, fromY: number, speed: number, ms: number, time: number) {
    const v = new Phaser.Math.Vector2(this.x - fromX, this.y - fromY).normalize().scale(speed);
    this.pushX = v.x; this.pushY = v.y; this.pushUntil = time + ms;
  }

  // Apply a running knockback. Returns true while being pushed.
  applyPush(time: number, dt: number) {
    if (time >= this.pushUntil) return false;
    this.scene.world.move(this, this.pushX * dt, this.pushY * dt);
    return true;
  }

  // Sort by feet; raised walkers go above bridges. Keep the shadow under the feet.
  syncDepth() {
    this.setDepth(depthFor(this.level, this.y));
    this.shadow.setPosition(this.x, this.y - 1).setDepth(depthFor(this.level, this.y) - 0.5);
  }

  destroy(fromScene?: boolean) {
    this.shadow?.destroy();
    super.destroy(fromScene);
  }
}
