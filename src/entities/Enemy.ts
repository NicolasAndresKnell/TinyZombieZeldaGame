import Phaser from 'phaser';
import { DIRECTION_VECTORS, ENEMY_TYPES, ENEMY_ACTIVATION_DISTANCE } from '../config';
import { shockwave } from '../effects';
import type { GameScene } from '../scenes/GameScene';
import type { EnemyStats, EnemyKind, Position } from '../types';
import type { Player } from './Player';
import { Walker } from './Walker';

export class Enemy extends Walker {
  readonly stats: EnemyStats;
  health: number;
  dead = false;
  private stunnedUntil = 0;
  private attackUntil = 0;
  private nextAttackAt = 0;
  private nextTurnAt = 0;
  private wander: Position = { x: 0, y: 0 };
  private bossMove = 0;

  constructor(scene: GameScene, x: number, y: number, level: number, readonly typeName: EnemyKind) {
    const type = ENEMY_TYPES[typeName];
    super(scene, x, y, type.textureKey, level, type.scale);
    this.stats = type;
    this.health = type.health;
    this.playAnimation('idle');
    this.anims.setProgress(Math.random());
  }

  playAnimation(animation: string, restart = false) { return this.anims.play(`${this.stats.textureKey}_${animation}`, !restart); }

  get hurtBox() {
    const scale = this.stats.scale;
    return new Phaser.Geom.Rectangle(this.x - 6 * scale, this.y - 16 * scale, 12 * scale, 16 * scale);
  }

  update(time: number, deltaSeconds: number, player: Player) {
    if (this.dead) return;
    if (this.applyPush(time, deltaSeconds)) return;
    if (time < this.stunnedUntil || time < this.attackUntil) return;

    const stats = this.stats;
    const distanceToPlayer = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (distanceToPlayer > Math.max(ENEMY_ACTIVATION_DISTANCE, stats.chaseRange)) return;
    const canSee = !player.isDead && distanceToPlayer < stats.chaseRange && this.sameHeightAs(player);

    if (canSee && time >= this.nextAttackAt && this.inAttackRange(distanceToPlayer)) return this.startAttack(time, player, distanceToPlayer);

    let velocityX = 0, velocityY = 0;
    const toward = (speed: number, sign = 1) => {
      velocityX = sign * (player.x - this.x) / distanceToPlayer * speed;
      velocityY = sign * (player.y - this.y) / distanceToPlayer * speed;
    };
    if (canSee) {
      if (stats.preferredDistanceRange) {
        if (distanceToPlayer < stats.preferredDistanceRange[0]) toward(stats.chaseSpeed, -1);
        else if (distanceToPlayer > stats.preferredDistanceRange[1]) toward(stats.chaseSpeed);
        this.setFlipX(player.x < this.x);
      } else toward(stats.chaseSpeed);
    } else if (stats.wanderSpeed) {
      if (time >= this.nextTurnAt) {

        this.wander = Phaser.Utils.Array.GetRandom([...Object.values(DIRECTION_VECTORS), { x: 0, y: 0 }, { x: 0, y: 0 }]);
        this.nextTurnAt = time + Phaser.Math.Between(900, 2200);
      }
      velocityX = this.wander.x * stats.wanderSpeed;
      velocityY = this.wander.y * stats.wanderSpeed;
    }
    const moved = this.scene.world.move(this, velocityX * deltaSeconds, velocityY * deltaSeconds);
    if (!moved && !canSee) this.nextTurnAt = 0;

    if (Math.abs(velocityX) > 1 && !stats.preferredDistanceRange) this.setFlipX(velocityX < 0);
    if (Math.abs(velocityX) > 1 && stats.preferredDistanceRange && !canSee) this.setFlipX(velocityX < 0);
    this.playAnimation(velocityX || velocityY ? 'walk' : 'idle');
  }

  private inAttackRange(distanceToPlayer: number) {
    const stats = this.stats;
    if (stats.attackKind === 'spit') return distanceToPlayer < stats.preferredDistanceRange![1] + 30;
    if (stats.attackKind === 'boss') return distanceToPlayer < 170;
    return distanceToPlayer < stats.attackRange!;
  }

  private startAttack(time: number, player: Player, distanceToPlayer: number) {
    const stats = this.stats;
    const scene = this.scene;
    this.setFlipX(player.x < this.x);
    this.attackUntil = time + stats.attackMs;
    this.nextAttackAt = time + stats.cooldownMs;
    const swingStart = this.stunnedUntil;

    const cancelled = () => this.dead || (stats.knockbackMultiplier >= 1 && this.stunnedUntil !== swingStart);
    let kind: string = stats.attackKind;
    if (kind === 'boss') kind = distanceToPlayer < stats.attackRange! ? 'slam' : (this.bossMove++ % 2 ? 'fan' : 'slam');

    if (kind === 'melee') {
      this.playAnimation('attack', true);
      scene.time.delayedCall(stats.windupMs, () => {
        if (cancelled()) return;
        const inFront = this.flipX ? player.x <= this.x + 4 : player.x >= this.x - 4;
        const close = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) < stats.meleeReach!;
        if (inFront && close && this.sameHeightAs(player)) scene.hurtPlayer(this.x, this.y, stats.damage);
      });
    } else if (kind === 'spit' || kind === 'fan') {
      this.playAnimation('shot', true);
      scene.time.delayedCall(stats.windupMs, () => {
        if (cancelled()) return;
        const aimAngle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
        const spread = kind === 'fan' ? [-0.5, -0.25, 0, 0.25, 0.5] : [0];
        spread.forEach(angleOffset => scene.spawnSpit(this, aimAngle + angleOffset, stats.spitSpeed!, stats.damage > 1 ? 1 : stats.damage));
      });
    } else {
      this.playAnimation('windup', true);
      const flash = scene.time.addEvent({ delay: 90, repeat: Math.floor(stats.windupMs / 90), callback: () => {
        if (this.dead) return;
        if (this.isTinted) this.clearTint(); else this.setTintFill(0xffffff);
      } });
      scene.time.delayedCall(stats.windupMs, () => {
        flash.remove(); if (!this.dead) this.clearTint();
        if (this.dead) return;
        this.playAnimation('cast', true);
        shockwave(scene, this, stats.slamRadius!);
        const player = scene.player;
        const deltaX = player.x - this.x, deltaY = (player.y - this.y) / 0.6;
        if (Math.hypot(deltaX, deltaY) < stats.slamRadius! && this.sameHeightAs(player)) scene.hurtPlayer(this.x, this.y, stats.damage);
      });
    }
  }

  takeHit(fromX: number, fromY: number, time: number, damage: number, knockbackSpeed: number) {
    if (this.dead) return false;
    this.health -= damage;
    if (this.health <= 0) { this.die(); return true; }
    const heavyBusy = this.stats.knockbackMultiplier < 1 && time < this.attackUntil;
    if (!heavyBusy) {
      this.attackUntil = 0;
      this.stunnedUntil = time + this.stats.stunMs;
      this.playAnimation('hurt', true);
    }
    this.push(fromX, fromY, knockbackSpeed * this.stats.knockbackMultiplier, this.stats.stunMs, time);
    return false;
  }

  private die() {
    this.dead = true;
    this.clearTint();
    this.playAnimation('dead', true);
    this.scene.tweens.add({
      targets: [this, this.shadow], alpha: 0, delay: 1400, duration: 600,
      onComplete: () => this.destroy(),
    });
  }
}
