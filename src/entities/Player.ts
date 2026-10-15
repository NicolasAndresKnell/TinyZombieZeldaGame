import Phaser from 'phaser';
import { SWORD_COMBO, COMBO_WINDOW_MS, DIRECTION_VECTORS, FINISHER_REST_MS, PLAYER } from '../config';
import { spinSlash } from '../effects';
import type { GameScene } from '../scenes/GameScene';
import type { Direction } from '../types';
import { Walker } from './Walker';

type KeyboardKey = Phaser.Input.Keyboard.Key;
type PlayerControls = Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'attack' | 'attack2', KeyboardKey>;

export type PlayerAttackHitbox =
  ({ rect: Phaser.Geom.Rectangle; radius?: undefined } | { radius: number; rect?: undefined })
  & { damage: number; knockbackSpeed: number; isFinisher: boolean };

export class Player extends Walker {
  health = PLAYER.maxHealth;
  facing: Direction = 'down';
  private attackUntil = 0;
  private nextAttackAt = 0;
  private invulnerableUntil = 0;
  private comboStep = 0;
  private comboUntil = 0;
  private queuedAttack = false;
  private keys: PlayerControls;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, x, y, 'hero', 0);
    this.keys = scene.input.keyboard!.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
      attack: 'SPACE', attack2: 'J',
    }) as PlayerControls;
    this.playAnimation('idle');
  }

  get isDead() { return this.health <= 0; }

  playAnimation(kind: string, restart = false) {
    const side = this.facing === 'left' || this.facing === 'right';
    this.setFlipX(this.facing === 'left');
    this.anims.play(`hero_${kind}_${side ? 'side' : 'down'}`, !restart);
  }

  update(time: number, deltaSeconds: number) {
    this.setAlpha(time < this.invulnerableUntil && Math.floor(time / 80) % 2 ? 0.35 : 1);
    if (this.isDead) return;
    if (this.applyPush(time, deltaSeconds)) return;

    const keys = this.keys;
    const pressed = Phaser.Input.Keyboard.JustDown(keys.attack) || Phaser.Input.Keyboard.JustDown(keys.attack2);
    if (time < this.attackUntil) {
      if (pressed) this.queuedAttack = true;
      return;
    }
    if ((pressed || this.queuedAttack) && time >= this.nextAttackAt) {
      this.queuedAttack = false;
      return this.attack(time);
    }
    this.queuedAttack = false;

    const deltaX = Number(keys.right.isDown || keys.d.isDown) - Number(keys.left.isDown || keys.a.isDown);
    const deltaY = Number(keys.down.isDown || keys.s.isDown) - Number(keys.up.isDown || keys.w.isDown);

    const movement = new Phaser.Math.Vector2(deltaX, deltaY).normalize().scale(PLAYER.speed * deltaSeconds);
    this.scene.world.move(this, movement.x, movement.y, true);

    if (deltaX < 0) this.facing = 'left';
    else if (deltaX > 0) this.facing = 'right';
    else if (deltaY < 0) this.facing = 'up';
    else if (deltaY > 0) this.facing = 'down';
    this.playAnimation(deltaX || deltaY ? 'walk' : 'idle');
  }

  private attack(time: number) {

    this.comboStep = time <= this.comboUntil && this.comboStep < SWORD_COMBO.length ? this.comboStep + 1 : 1;
    const hit = SWORD_COMBO[this.comboStep - 1];
    this.attackUntil = time + hit.swingMs;
    this.nextAttackAt = time + hit.swingMs + (hit.isFinisher ? FINISHER_REST_MS : 0);
    this.comboUntil = hit.isFinisher ? 0 : time + hit.swingMs + COMBO_WINDOW_MS;
    this.playAnimation(hit.animation, true);

    const facingVector = DIRECTION_VECTORS[this.facing];
    for (let i = 0; i < hit.lungeDistance; i += 2) this.scene.world.move(this, facingVector.x * 2, facingVector.y * 2, true);

    let area: { rect: Phaser.Geom.Rectangle } | { radius: number };
    if (hit.isFinisher) {
      area = { radius: hit.radius };
      spinSlash(this.scene, this, hit.radius);
    } else {
      const centerX = this.x + facingVector.x * hit.reach;
      const centerY = this.y - 3 + facingVector.y * hit.reach - (facingVector.x ? 4 : 0);
      const hitboxWidth = facingVector.x ? hit.height : hit.width, hitboxHeight = facingVector.x ? hit.width : hit.height;
      area = { rect: new Phaser.Geom.Rectangle(centerX - hitboxWidth / 2, centerY - hitboxHeight / 2, hitboxWidth, hitboxHeight) };
    }
    if (this.comboStep > 1) this.scene.hud.popText(this.x, this.y - 30, hit.isFinisher ? 'x3!' : 'x2', hit.isFinisher ? '#ffce48' : '#fff4e0');
    this.scene.time.delayedCall(hit.hitDelayMs, () => {
      if (!this.isDead) this.scene.onPlayerAttack({ ...area, damage: hit.damage, knockbackSpeed: hit.knockbackSpeed, isFinisher: hit.isFinisher });
    });
  }

  takeHit(fromX: number, fromY: number, time: number, damage = 1) {
    if (this.isDead || time < this.invulnerableUntil) return false;
    this.health = Math.max(0, this.health - damage);
    this.invulnerableUntil = time + PLAYER.invulnerableMs;
    this.attackUntil = 0;
    this.comboUntil = 0;
    this.push(fromX, fromY, PLAYER.knockbackSpeed, PLAYER.knockbackMs, time);
    this.playAnimation('hurt', true);
    return true;
  }
}
