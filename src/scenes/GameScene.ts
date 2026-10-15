import Phaser from 'phaser';
import {
  SIMULATION, PICKUPS, SPIT_PROJECTILE, BRAINS_TO_WIN, BRIDGE_DEPTH, depthForHeight, COLLISION_FOOTPRINT, HUD_DEPTH, PLAYER, SHADOW_ALPHA, TILE_SIZE, enemyKindForSpawn,
} from '../config';
import levelData from '../data/level.json';
import { spark, splat } from '../effects';
import { Enemy } from '../entities/Enemy';
import { Player, type PlayerAttackHitbox } from '../entities/Player';
import { Ghosts } from '../net/Ghosts';
import type { LevelData } from '../types';
import { Hud } from '../ui/Hud';
import { canEnter, TILE_HEIGHT_LEVELS, isSolid, tileBase } from '../world/terrain';
import { World } from '../world/World';

const LEVEL = levelData as unknown as LevelData;

export interface Pickup {
  x: number; y: number; level: number;
  image: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; hoverTween: Phaser.Tweens.Tween;
  taken: boolean;
}

interface SpitProjectile {
  x: number; y: number; velocityX: number; velocityY: number; level: number; damage: number; remainingLifetimeSeconds: number;
  image: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; dead?: boolean;
}

export class GameScene extends Phaser.Scene {
  world!: World;
  player!: Player;
  enemies!: Enemy[];
  boss: Enemy | null = null;
  brains!: Pickup[];
  drops!: Pickup[];
  brainsCollected = 0;
  dropsCollected = 0;
  totalDrops = 0;
  gameOver = false;
  hud!: Hud;
  private spits: SpitProjectile[] = [];
  private ghosts!: Ghosts;
  private bossDone = false;
  private mainDone = false;
  private paused = false;
  private freezeUntil = 0;
  private debug!: Phaser.GameObjects.Graphics;
  private showDebug = false;

  constructor() { super('GameScene'); }

  create() {

    Object.assign(this, {
      boss: null, brainsCollected: 0, dropsCollected: 0, gameOver: false, spits: [], drops: [],
      bossDone: false, mainDone: false, paused: false, freezeUntil: 0, showDebug: false,
    });
    this.world = new World(LEVEL);

    this.add.image(0, 0, 'level_ground').setOrigin(0).setDepth(-10);
    this.add.image(0, 0, 'level_bridges').setOrigin(0).setDepth(BRIDGE_DEPTH);

    for (const [type, x, y] of LEVEL.props) {
      const image = this.add.image(x, y, type).setOrigin(0.5, 1).setDepth(y);
      const tree = type.startsWith('tree');
      this.add.ellipse(x, y - 1, image.width * (tree ? 0.75 : 0.9), tree ? 6 : 4, 0x000000, SHADOW_ALPHA).setDepth(-1);
    }

    const playerSpawn = tileBase(...LEVEL.start);
    this.player = new Player(this, playerSpawn.x, playerSpawn.y);
    this.enemies = LEVEL.zombies.map(([tileX, tileY, heightLevel], i) => {
      const enemySpawn = tileBase(tileX, tileY);
      return new Enemy(this, enemySpawn.x, enemySpawn.y, heightLevel, enemyKindForSpawn(i));
    });
    this.totalDrops = this.enemies.length;
    this.brains = LEVEL.brains.map(([tileX, tileY, heightLevel]) =>
      this.makePickup(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE - 3, heightLevel, 'brain', 6));

    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.world.pixelWidth, this.world.pixelHeight);
    camera.startFollow(this.player, true);
    camera.setRoundPixels(true);

    this.debug = this.add.graphics().setDepth(HUD_DEPTH - 2);
    this.hud = new Hud(this);
    this.ghosts = new Ghosts(this);
    this.input.keyboard!.on('keydown-BACKTICK', () => { this.showDebug = !this.showDebug; this.debug.clear(); });
  }

  update(time: number, delta: number) {
    if (this.paused) return;
    if (time < this.freezeUntil) return;
    const deltaSeconds = Math.min(delta, SIMULATION.maximumFrameDurationMs) / SIMULATION.millisecondsPerSecond;
    this.player.update(time, deltaSeconds);
    this.enemies.forEach(enemy => enemy.update(time, deltaSeconds, this.player));
    this.updateSpits(deltaSeconds);
    this.player.syncDepth();
    this.enemies.forEach(enemy => enemy.syncDepth());
    this.checkPickups();
    this.hud.update();
    if (this.showDebug) this.drawDebug();
    this.ghosts.update(time, deltaSeconds);
  }

  private makePickup(x: number, y: number, level: number, texture: 'brain' | 'brain_drop', hover: number): Pickup {
    const shadow = this.add.ellipse(x, y, texture === 'brain' ? 14 : 10, 4, 0x000000, SHADOW_ALPHA).setDepth(depthForHeight(level, y) - 1);
    const image = this.add.sprite(x, y - hover, texture, 0).setOrigin(0.5, 1).setDepth(depthForHeight(level, y));
    image.play(`${texture}_spin`);
    image.anims.setProgress(Math.random());
    const hoverTween = this.tweens.add({ targets: image, y: y - hover - 4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    return { x, y, level, image, shadow, hoverTween, taken: false };
  }

  private spawnDrop(enemy: Enemy) {
    const drop = this.makePickup(enemy.x, enemy.y, enemy.level, 'brain_drop', 3);
    drop.hoverTween.pause();

    drop.image.y = enemy.y - 18; drop.image.setScale(0.4);
    this.tweens.add({ targets: drop.image, y: enemy.y - 3, scale: 1, duration: 380, ease: 'Bounce.out', onComplete: () => { drop.hoverTween.resume(); } });
    this.drops.push(drop);
  }

  private checkPickups() {
    const player = this.player;
    if (player.isDead || this.gameOver) return;
    const reachable = (pickup: Pickup) => player.level === pickup.level || player.onStairs;

    for (const pickup of this.brains) {
      if (pickup.taken || !reachable(pickup) || Phaser.Math.Distance.Between(player.x, player.y, pickup.x, pickup.y) > PICKUPS.brainCollectionRadius) continue;
      this.collect(pickup);
      this.brainsCollected++;
      player.health = Math.min(PLAYER.maxHealth, player.health + PICKUPS.healthRestoredPerBrain);
      this.hud.updateHearts();
      this.hud.updateCounters();
      if (this.brainsCollected >= BRAINS_TO_WIN && !this.mainDone) {
        this.mainDone = true;
        this.showPanel('Level cleared!', `All ${BRAINS_TO_WIN} brains collected.`,
          'Bonus: every enemy drops a brain. Collect them all to wake the Brain King.', true);
      }
    }

    for (const drop of this.drops) {
      if (drop.taken || !reachable(drop)) continue;
      if (Phaser.Math.Distance.Between(player.x, player.y, drop.x, drop.y) > PICKUPS.dropCollectionRadius) continue;
      this.collect(drop);
      this.dropsCollected++;
      this.hud.updateCounters();
      if (this.dropsCollected >= this.totalDrops && !this.boss && !this.bossDone) this.spawnBoss();
    }
  }

  private collect(pickup: Pickup) {
    pickup.taken = true;
    pickup.hoverTween.stop();
    pickup.shadow.destroy();
    this.tweens.add({ targets: pickup.image, y: pickup.image.y - 16, alpha: 0, scale: 1.6, duration: 350, onComplete: () => pickup.image.destroy() });
  }

  private spawnBoss() {
    const bossSpawn = this.world.openGroundNear(LEVEL.start[0], LEVEL.start[1] - 4);
    this.boss = new Enemy(this, bossSpawn.x, bossSpawn.y, 0, 'boss');
    this.enemies.push(this.boss);
    this.cameras.main.shake(400, 0.006);
    this.hud.toast('The Brain King has risen in the plaza!');
    this.hud.updateCounters();
  }

  onPlayerAttack(hit: PlayerAttackHitbox) {
    let landed = false;
    for (const enemy of [...this.enemies]) {
      if (enemy.dead || !enemy.sameHeightAs(this.player)) continue;
      const box = enemy.hurtBox;
      const touched = hit.radius !== undefined
        ? Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(this.player.x, this.player.y - 6, hit.radius), box)
        : Phaser.Geom.Intersects.RectangleToRectangle(hit.rect, box);
      if (!touched) continue;
      landed = true;
      spark(this, enemy.x, enemy.y - 10 * enemy.stats.scale);
      if (enemy.takeHit(this.player.x, this.player.y, this.time.now, hit.damage, hit.knockbackSpeed)) this.onEnemyKilled(enemy);
    }
    if (landed) {
      this.cameras.main.shake(hit.isFinisher ? 120 : 60, hit.isFinisher ? 0.005 : 0.002);
      if (hit.isFinisher) this.freezeUntil = this.time.now + 70;
    }
  }

  private onEnemyKilled(enemy: Enemy) {
    Phaser.Utils.Array.Remove(this.enemies, enemy);
    if (enemy === this.boss) {
      this.bossDone = true;
      this.cameras.main.shake(500, 0.008);
      this.time.delayedCall(900, () => this.showPanel('Brain King defeated!', 'You are the legend of the zombie block.', '', false));
    } else {
      this.spawnDrop(enemy);
    }
    this.hud.updateCounters();
  }

  hurtPlayer(fromX: number, fromY: number, damage: number) {
    if (this.gameOver || !this.player.takeHit(fromX, fromY, this.time.now, damage)) return;
    this.cameras.main.shake(120, 0.005);
    this.hud.updateHearts();
    if (this.player.isDead) {
      this.showPanel('You were bitten', `Brains: ${this.brainsCollected}/${BRAINS_TO_WIN} · drops: ${this.dropsCollected}/${this.totalDrops}`, '', false);
    }
  }

  spawnSpit(enemy: Enemy, angle: number, speed: number, damage: number) {
    const x = enemy.x + Math.cos(angle) * SPIT_PROJECTILE.spawnOffset, y = enemy.y + Math.sin(angle) * SPIT_PROJECTILE.spawnOffset;
    const image = this.add.image(x, y - SPIT_PROJECTILE.imageOffsetY, 'spit').setDepth(depthForHeight(enemy.level, y));
    const shadow = this.add.ellipse(x, y, 5, 2, 0x000000, SHADOW_ALPHA).setDepth(depthForHeight(enemy.level, y) - 1);
    this.spits.push({ x, y, velocityX: Math.cos(angle) * speed, velocityY: Math.sin(angle) * speed, level: enemy.level, damage, image, shadow, remainingLifetimeSeconds: SPIT_PROJECTILE.lifetimeSeconds });
  }

  private updateSpits(deltaSeconds: number) {
    const player = this.player;
    for (const projectile of this.spits) {
      projectile.x += projectile.velocityX * deltaSeconds; projectile.y += projectile.velocityY * deltaSeconds; projectile.remainingLifetimeSeconds -= deltaSeconds;
      const tileKind = this.world.kindAtPixel(projectile.x, projectile.y);
      const blocked = isSolid(tileKind) || (TILE_HEIGHT_LEVELS[tileKind] ?? 0) > projectile.level;
      const hit = !player.isDead && Math.abs(player.x - projectile.x) < SPIT_PROJECTILE.collisionHalfExtent && Math.abs(player.y - projectile.y) < SPIT_PROJECTILE.collisionHalfExtent && (player.level === projectile.level || player.onStairs);
      if (hit) this.hurtPlayer(projectile.x - projectile.velocityX, projectile.y - projectile.velocityY, projectile.damage);
      if (hit || blocked || projectile.remainingLifetimeSeconds <= 0) {
        projectile.dead = true; projectile.image.destroy(); projectile.shadow.destroy();
        splat(this, projectile.x, projectile.y - 6, projectile.level);
        continue;
      }
      projectile.image.setPosition(projectile.x, projectile.y - SPIT_PROJECTILE.imageOffsetY).setDepth(depthForHeight(projectile.level, projectile.y)).rotation += deltaSeconds * SPIT_PROJECTILE.rotationSpeed;
      projectile.shadow.setPosition(projectile.x, projectile.y).setDepth(depthForHeight(projectile.level, projectile.y) - 1);
    }
    this.spits = this.spits.filter(projectile => !projectile.dead);
  }

  private showPanel(title: string, line: string, extra: string, canContinue: boolean) {
    if (!canContinue) this.gameOver = true;
    this.paused = true;
    this.hud.showPanel(title, line, extra, canContinue ? () => { this.paused = false; } : undefined);
  }

  private drawDebug() {
    const graphics = this.debug.clear();
    const camera = this.cameras.main, player = this.player;
    const from = this.world.kindAtPixel(player.x, player.y - 2);
    const firstVisibleTileX = Math.floor(camera.worldView.x / TILE_SIZE), firstVisibleTileY = Math.floor(camera.worldView.y / TILE_SIZE);
    for (let tileY = firstVisibleTileY; tileY <= firstVisibleTileY + 12; tileY++) for (let tileX = firstVisibleTileX; tileX <= firstVisibleTileX + 21; tileX++) {
      if (!canEnter(from, this.world.kindAt(tileX, tileY), player.level)) {
        graphics.fillStyle(0xff3b3b, 0.25).fillRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    for (const walker of [player, ...this.enemies]) {
      graphics.lineStyle(1, 0x40ff80, 1).strokeRect(walker.x - COLLISION_FOOTPRINT.width / 2, walker.y - COLLISION_FOOTPRINT.height, COLLISION_FOOTPRINT.width, COLLISION_FOOTPRINT.height);
    }
  }
}
