// =====================================================================
// PLAYER — knocked back (no control) → swinging (frozen) → walking.
// The art has a front view and a side view; walking up reuses the front view.
// =====================================================================
import Phaser from 'phaser';
import { COMBO, COMBO_WINDOW_MS, DIRS, FINISHER_REST_MS, PLAYER } from '../config';
import { spinSlash } from '../effects';
import type { GameScene } from '../scenes/GameScene';
import type { Direction } from '../types';
import { Walker } from './Walker';

type Key = Phaser.Input.Keyboard.Key;
type Keys = Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'attack' | 'attack2', Key>;

// What a swing can hit: a box in front of the hero, or a ring around them.
export type PlayerHit =
  ({ rect: Phaser.Geom.Rectangle; radius?: undefined } | { radius: number; rect?: undefined })
  & { damage: number; knock: number; finisher: boolean };

export class Player extends Walker {
  health = PLAYER.maxHealth;
  facing: Direction = 'down';
  private attackUntil = 0;
  private nextAttackAt = 0;
  private invulnerableUntil = 0;
  private comboStep = 0;          // which hit of the combo we're on (1-3)
  private comboUntil = 0;         // the next tap continues the combo until this time
  private queuedAttack = false;   // a tap during a swing waits for the swing to finish
  private keys: Keys;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, x, y, 'hero', 0);
    this.keys = scene.input.keyboard!.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
      attack: 'SPACE', attack2: 'J',
    }) as Keys;
    this.playAnim('idle');
  }

  get isDead() { return this.health <= 0; }

  playAnim(kind: string, restart = false) {
    const side = this.facing === 'left' || this.facing === 'right';
    this.setFlipX(this.facing === 'left');
    this.anims.play(`hero_${kind}_${side ? 'side' : 'down'}`, !restart);
  }

  update(time: number, dt: number) {
    this.setAlpha(time < this.invulnerableUntil && Math.floor(time / 80) % 2 ? 0.35 : 1);
    if (this.isDead) return;
    if (this.applyPush(time, dt)) return;

    const k = this.keys;
    const pressed = Phaser.Input.Keyboard.JustDown(k.attack) || Phaser.Input.Keyboard.JustDown(k.attack2);
    if (time < this.attackUntil) {               // mid-swing: remember the tap for later
      if (pressed) this.queuedAttack = true;
      return;
    }
    if ((pressed || this.queuedAttack) && time >= this.nextAttackAt) {
      this.queuedAttack = false;
      return this.attack(time);
    }
    this.queuedAttack = false;

    // Each axis becomes -1, 0 or 1.
    const dx = Number(k.right.isDown || k.d.isDown) - Number(k.left.isDown || k.a.isDown);
    const dy = Number(k.down.isDown || k.s.isDown) - Number(k.up.isDown || k.w.isDown);
    // Normalising stops diagonals from being ~41% faster.
    const v = new Phaser.Math.Vector2(dx, dy).normalize().scale(PLAYER.speed * dt);
    this.scene.world.move(this, v.x, v.y, true);

    if (dx < 0) this.facing = 'left';
    else if (dx > 0) this.facing = 'right';
    else if (dy < 0) this.facing = 'up';
    else if (dy > 0) this.facing = 'down';
    this.playAnim(dx || dy ? 'walk' : 'idle');
  }

  private attack(time: number) {
    // Continue the combo if we're inside its window, otherwise start again at hit 1.
    this.comboStep = time <= this.comboUntil && this.comboStep < COMBO.length ? this.comboStep + 1 : 1;
    const hit = COMBO[this.comboStep - 1];
    this.attackUntil = time + hit.swingMs;
    this.nextAttackAt = time + hit.swingMs + (hit.finisher ? FINISHER_REST_MS : 0);
    this.comboUntil = hit.finisher ? 0 : time + hit.swingMs + COMBO_WINDOW_MS;
    this.playAnim(hit.anim, true);

    // Later hits step forward a little, which keeps the combo connecting.
    const d = DIRS[this.facing];
    for (let i = 0; i < hit.lunge; i += 2) this.scene.world.move(this, d.x * 2, d.y * 2, true);

    let area: { rect: Phaser.Geom.Rectangle } | { radius: number };
    if (hit.finisher) {
      area = { radius: hit.radius! };
      spinSlash(this.scene, this, hit.radius!);
    } else {
      const cx = this.x + d.x * hit.reach!;
      const cy = this.y - 3 + d.y * hit.reach! - (d.x ? 4 : 0);
      const w = d.x ? hit.h! : hit.w!, h = d.x ? hit.w! : hit.h!;
      area = { rect: new Phaser.Geom.Rectangle(cx - w / 2, cy - h / 2, w, h) };
    }
    if (this.comboStep > 1) this.scene.hud.popText(this.x, this.y - 30, hit.finisher ? 'x3!' : 'x2', hit.finisher ? '#ffce48' : '#fff4e0');
    this.scene.time.delayedCall(hit.hitDelayMs, () => {
      if (!this.isDead) this.scene.onPlayerAttack({ ...area, damage: hit.damage, knock: hit.knock, finisher: !!hit.finisher });
    });
  }

  takeHit(fromX: number, fromY: number, time: number, damage = 1) {
    if (this.isDead || time < this.invulnerableUntil) return false;
    this.health = Math.max(0, this.health - damage);
    this.invulnerableUntil = time + PLAYER.invulnerableMs;
    this.attackUntil = 0;
    this.comboUntil = 0;
    this.push(fromX, fromY, PLAYER.knockbackSpeed, PLAYER.knockbackMs, time);
    this.playAnim('hurt', true);
    return true;
  }
}
