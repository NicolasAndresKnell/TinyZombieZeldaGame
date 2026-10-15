import { TILE_KIND } from '../types';
import Phaser from 'phaser';
import { CHARACTER_FRAME, depthForHeight, SHADOW_ALPHA } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { TileKind } from '../types';
import { isSlope } from '../world/terrain';

export class Walker extends Phaser.GameObjects.Sprite {
  declare scene: GameScene;
  level: number;
  tileKind: TileKind = TILE_KIND.Paving;
  shadow: Phaser.GameObjects.Ellipse;

  private pushX = 0;
  private pushY = 0;
  private pushUntil = 0;

  constructor(scene: GameScene, x: number, y: number, texture: string, level: number, scale = 1) {
    super(scene, x, y, texture, 0);
    scene.add.existing(this);
    this.setOrigin(0.5, CHARACTER_FRAME.feetOffsetY / CHARACTER_FRAME.height).setScale(scale);
    this.level = level;
    this.shadow = scene.add.ellipse(x, y, 12 * scale, 4 * scale, 0x000000, SHADOW_ALPHA);
  }

  get onStairs() { return isSlope(this.tileKind); }

  sameHeightAs(other: Walker) {
    return this.level === other.level || this.onStairs || other.onStairs;
  }

  push(fromX: number, fromY: number, speed: number, durationMs: number, time: number) {
    const knockbackVelocity = new Phaser.Math.Vector2(this.x - fromX, this.y - fromY).normalize().scale(speed);
    this.pushX = knockbackVelocity.x; this.pushY = knockbackVelocity.y; this.pushUntil = time + durationMs;
  }

  applyPush(time: number, deltaSeconds: number) {
    if (time >= this.pushUntil) return false;
    this.scene.world.move(this, this.pushX * deltaSeconds, this.pushY * deltaSeconds);
    return true;
  }

  syncDepth() {
    this.setDepth(depthForHeight(this.level, this.y));
    this.shadow.setPosition(this.x, this.y - 1).setDepth(depthForHeight(this.level, this.y) - 0.5);
  }

  destroy(fromScene?: boolean) {
    this.shadow?.destroy();
    super.destroy(fromScene);
  }
}
