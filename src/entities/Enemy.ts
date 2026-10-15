// =====================================================================
// ENEMY — one class for every type; ENEMY_TYPES says how each one fights.
// The art faces right, so we mirror it (flipX) to face left.
// =====================================================================
import Phaser from 'phaser';
import { DIRS, ENEMY_TYPES, SLEEP_RANGE } from '../config';
import { shockwave } from '../effects';
import type { GameScene } from '../scenes/GameScene';
import type { EnemyType, EnemyTypeName, Vec } from '../types';
import type { Player } from './Player';
import { Walker } from './Walker';

export class Enemy extends Walker {
  readonly stats: EnemyType;
  health: number;
  dead = false;
  private stunnedUntil = 0;
  private attackUntil = 0;
  private nextAttackAt = 0;
  private nextTurnAt = 0;
  private wander: Vec = { x: 0, y: 0 };
  private bossMove = 0;           // the boss alternates between slam and spit

  constructor(scene: GameScene, x: number, y: number, level: number, readonly typeName: EnemyTypeName) {
    const type = ENEMY_TYPES[typeName];
    super(scene, x, y, type.sheet, level, type.scale);
    this.stats = type;
    this.health = type.health;
    this.playAnim('idle');
    this.anims.setProgress(Math.random());   // don't all bob in sync
  }

  playAnim(anim: string, restart = false) { return this.anims.play(`${this.stats.sheet}_${anim}`, !restart); }

  // The part of the body the sword can hit.
  get hurtBox() {
    const s = this.stats.scale;
    return new Phaser.Geom.Rectangle(this.x - 6 * s, this.y - 16 * s, 12 * s, 16 * s);
  }

  update(time: number, dt: number, player: Player) {
    if (this.dead) return;
    if (this.applyPush(time, dt)) return;
    if (time < this.stunnedUntil || time < this.attackUntil) return;

    const T = this.stats;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (dist > Math.max(SLEEP_RANGE, T.chaseRange)) return;            // too far away to care
    const canSee = !player.isDead && dist < T.chaseRange && this.sameHeightAs(player);

    if (canSee && time >= this.nextAttackAt && this.inAttackRange(dist)) return this.startAttack(time, player, dist);

    let vx = 0, vy = 0;
    const toward = (speed: number, sign = 1) => {
      vx = sign * (player.x - this.x) / dist * speed;
      vy = sign * (player.y - this.y) / dist * speed;
    };
    if (canSee) {
      if (T.keepAway) {                       // spitters hold the middle distance
        if (dist < T.keepAway[0]) toward(T.chaseSpeed, -1);
        else if (dist > T.keepAway[1]) toward(T.chaseSpeed);
        this.setFlipX(player.x < this.x);
      } else toward(T.chaseSpeed);
    } else if (T.wanderSpeed) {
      if (time >= this.nextTurnAt) {
        // Wander: a new random direction now and then (sometimes standing still).
        this.wander = Phaser.Utils.Array.GetRandom([...Object.values(DIRS), { x: 0, y: 0 }, { x: 0, y: 0 }]);
        this.nextTurnAt = time + Phaser.Math.Between(900, 2200);
      }
      vx = this.wander.x * T.wanderSpeed;
      vy = this.wander.y * T.wanderSpeed;
    }
    const moved = this.scene.world.move(this, vx * dt, vy * dt);
    if (!moved && !canSee) this.nextTurnAt = 0;                 // bumped into something: turn

    if (Math.abs(vx) > 1 && !T.keepAway) this.setFlipX(vx < 0);
    if (Math.abs(vx) > 1 && T.keepAway && !canSee) this.setFlipX(vx < 0);
    this.playAnim(vx || vy ? 'walk' : 'idle');
  }

  private inAttackRange(dist: number) {
    const T = this.stats;
    if (T.attack === 'spit') return dist < T.keepAway![1] + 30;
    if (T.attack === 'boss') return dist < 170;
    return dist < T.range!;
  }

  private startAttack(time: number, player: Player, dist: number) {
    const T = this.stats;
    const scene = this.scene;
    this.setFlipX(player.x < this.x);
    this.attackUntil = time + T.attackMs;
    this.nextAttackAt = time + T.cooldownMs;
    const swingStart = this.stunnedUntil;
    // A hit from the player during the wind-up cancels the attack (except for heavies).
    const cancelled = () => this.dead || (T.knockTaken >= 1 && this.stunnedUntil !== swingStart);
    let kind: string = T.attack;
    if (kind === 'boss') kind = dist < T.range! ? 'slam' : (this.bossMove++ % 2 ? 'fan' : 'slam');

    if (kind === 'melee') {
      this.playAnim('attack', true);
      scene.time.delayedCall(T.windupMs, () => {
        if (cancelled()) return;
        const inFront = this.flipX ? player.x <= this.x + 4 : player.x >= this.x - 4;
        const close = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) < T.reach!;
        if (inFront && close && this.sameHeightAs(player)) scene.hurtPlayer(this.x, this.y, T.damage);
      });
    } else if (kind === 'spit' || kind === 'fan') {
      this.playAnim('shot', true);
      scene.time.delayedCall(T.windupMs, () => {
        if (cancelled()) return;
        const base = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
        const spread = kind === 'fan' ? [-0.5, -0.25, 0, 0.25, 0.5] : [0];
        spread.forEach(da => scene.spawnSpit(this, base + da, T.spitSpeed!, T.damage > 1 ? 1 : T.damage));
      });
    } else {                                   // slam: wind up (flashing), then a shockwave
      this.playAnim('windup', true);
      const flash = scene.time.addEvent({ delay: 90, repeat: Math.floor(T.windupMs / 90), callback: () => {
        if (this.dead) return;
        if (this.isTinted) this.clearTint(); else this.setTintFill(0xffffff);
      } });
      scene.time.delayedCall(T.windupMs, () => {
        flash.remove(); if (!this.dead) this.clearTint();
        if (this.dead) return;
        this.playAnim('cast', true);
        shockwave(scene, this, T.slamRadius!);
        const p = scene.player;
        const dx = p.x - this.x, dy = (p.y - this.y) / 0.6;     // the ring is squashed: ground perspective
        if (Math.hypot(dx, dy) < T.slamRadius! && this.sameHeightAs(p)) scene.hurtPlayer(this.x, this.y, T.damage);
      });
    }
  }

  // Returns true if this hit killed the enemy.
  takeHit(fromX: number, fromY: number, time: number, damage: number, knock: number) {
    if (this.dead) return false;
    this.health -= damage;
    if (this.health <= 0) { this.die(); return true; }
    const heavyBusy = this.stats.knockTaken < 1 && time < this.attackUntil;   // brutes shrug off hits mid-slam
    if (!heavyBusy) {
      this.attackUntil = 0;
      this.stunnedUntil = time + this.stats.stunMs;
      this.playAnim('hurt', true);
    }
    this.push(fromX, fromY, knock * this.stats.knockTaken, this.stats.stunMs, time);
    return false;
  }

  private die() {
    this.dead = true;
    this.clearTint();
    this.playAnim('dead', true);
    this.scene.tweens.add({
      targets: [this, this.shadow], alpha: 0, delay: 1400, duration: 600,
      onComplete: () => this.destroy(),
    });
  }
}
