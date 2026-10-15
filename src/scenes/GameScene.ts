// =====================================================================
// GAME SCENE — builds the world and runs the frame: walkers, combat,
// pickups and objectives. Drawing helpers live in effects.ts and ui/Hud.ts.
// =====================================================================
import Phaser from 'phaser';
import {
  BRAINS_TO_WIN, BRIDGE_DEPTH, depthFor, FEET, HUD_DEPTH, PLAYER, SHADOW_ALPHA, TILE_SIZE, typeForSpawn,
} from '../config';
import levelData from '../data/level.json';
import { spark, splat } from '../effects';
import { Enemy } from '../entities/Enemy';
import { Player, type PlayerHit } from '../entities/Player';
import { Ghosts } from '../net/Ghosts';
import type { LevelData } from '../types';
import { Hud } from '../ui/Hud';
import { canEnter, HEIGHT, isSolid, tileBase } from '../world/terrain';
import { World } from '../world/World';

const LEVEL = levelData as unknown as LevelData;

export interface Pickup {
  x: number; y: number; level: number;
  img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; bob: Phaser.Tweens.Tween;
  taken: boolean;
}

interface Spit {
  x: number; y: number; vx: number; vy: number; level: number; damage: number; life: number;
  img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; dead?: boolean;
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
  private spits: Spit[] = [];
  private ghosts!: Ghosts;
  private bossDone = false;
  private mainDone = false;
  private paused = false;
  private freezeUntil = 0;
  private debug!: Phaser.GameObjects.Graphics;
  private showDebug = false;

  constructor() { super('GameScene'); }

  create() {
    // create() runs again on restart, so reset all state here.
    Object.assign(this, {
      boss: null, brainsCollected: 0, dropsCollected: 0, gameOver: false, spits: [], drops: [],
      bossDone: false, mainDone: false, paused: false, freezeUntil: 0, showDebug: false,
    });
    this.world = new World(LEVEL);

    // The whole map is two pre-drawn pictures: the ground, and the bridges on top.
    this.add.image(0, 0, 'level_ground').setOrigin(0).setDepth(-10);
    this.add.image(0, 0, 'level_bridges').setOrigin(0).setDepth(BRIDGE_DEPTH);

    // Props and trees: depth = their base, so you're behind them when your feet are above it.
    for (const [type, x, y] of LEVEL.props) {
      const img = this.add.image(x, y, type).setOrigin(0.5, 1).setDepth(y);
      const tree = type.startsWith('tree');
      this.add.ellipse(x, y - 1, img.width * (tree ? 0.75 : 0.9), tree ? 6 : 4, 0x000000, SHADOW_ALPHA).setDepth(-1);
    }

    const s = tileBase(...LEVEL.start);
    this.player = new Player(this, s.x, s.y);
    this.enemies = LEVEL.zombies.map(([tx, ty, lv], i) => {
      const p = tileBase(tx, ty);
      return new Enemy(this, p.x, p.y, lv, typeForSpawn(i));
    });
    this.totalDrops = this.enemies.length;     // one brain per enemy
    this.brains = LEVEL.brains.map(([tx, ty, lv]) =>
      this.makePickup(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE - 3, lv, 'brain', 6));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.world.pixelW, this.world.pixelH);
    cam.startFollow(this.player, true);
    cam.setRoundPixels(true);

    this.debug = this.add.graphics().setDepth(HUD_DEPTH - 2);
    this.hud = new Hud(this);
    this.ghosts = new Ghosts(this);
    this.input.keyboard!.on('keydown-BACKTICK', () => { this.showDebug = !this.showDebug; this.debug.clear(); });
  }

  update(time: number, delta: number) {
    if (this.paused) return;
    if (time < this.freezeUntil) return;          // hit-stop: a tiny freeze on big hits
    const dt = Math.min(delta, 50) / 1000;        // seconds; capped so a hiccup can't tunnel through walls
    this.player.update(time, dt);
    this.enemies.forEach(e => e.update(time, dt, this.player));
    this.updateSpits(dt);
    this.player.syncDepth();
    this.enemies.forEach(e => e.syncDepth());
    this.checkPickups();
    this.hud.update();
    if (this.showDebug) this.drawDebug();
    this.ghosts.update(time, dt);
  }

  // ---- Pickups: the 10 level brains and the brains enemies drop ---------

  private makePickup(x: number, y: number, level: number, texture: 'brain' | 'brain_drop', hover: number): Pickup {
    const shadow = this.add.ellipse(x, y, texture === 'brain' ? 14 : 10, 4, 0x000000, SHADOW_ALPHA).setDepth(depthFor(level, y) - 1);
    const img = this.add.image(x, y - hover, texture).setOrigin(0.5, 1).setDepth(depthFor(level, y));
    const bob = this.tweens.add({ targets: img, y: y - hover - 4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    return { x, y, level, img, shadow, bob, taken: false };
  }

  private spawnDrop(enemy: Enemy) {
    const d = this.makePickup(enemy.x, enemy.y, enemy.level, 'brain_drop', 3);
    d.bob.pause();
    // Pop out of the body in a little arc, then start bobbing.
    d.img.y = enemy.y - 18; d.img.setScale(0.4);
    this.tweens.add({ targets: d.img, y: enemy.y - 3, scale: 1, duration: 380, ease: 'Bounce.out', onComplete: () => { d.bob.resume(); } });
    this.drops.push(d);
  }

  private checkPickups() {
    const p = this.player;
    if (p.isDead || this.gameOver) return;
    const reachable = (b: Pickup) => p.level === b.level || p.onStairs;

    for (const b of this.brains) {
      if (b.taken || !reachable(b) || Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) > 13) continue;
      this.collect(b);
      this.brainsCollected++;
      p.health = Math.min(PLAYER.maxHealth, p.health + 1);       // a level brain heals one heart
      this.hud.updateHearts();
      this.hud.updateCounters();
      if (this.brainsCollected >= BRAINS_TO_WIN && !this.mainDone) {
        this.mainDone = true;
        this.showPanel('Level cleared!', `All ${BRAINS_TO_WIN} brains collected.`,
          'Bonus: every enemy drops a brain. Collect them all to wake the Brain King.', true);
      }
    }

    for (const d of this.drops) {
      if (d.taken || !reachable(d)) continue;
      if (Phaser.Math.Distance.Between(p.x, p.y, d.x, d.y) > 16) continue;   // drops are easier to grab
      this.collect(d);
      this.dropsCollected++;
      this.hud.updateCounters();
      if (this.dropsCollected >= this.totalDrops && !this.boss && !this.bossDone) this.spawnBoss();
    }
  }

  private collect(b: Pickup) {
    b.taken = true;
    b.bob.stop();
    b.shadow.destroy();
    this.tweens.add({ targets: b.img, y: b.img.y - 16, alpha: 0, scale: 1.6, duration: 350, onComplete: () => b.img.destroy() });
  }

  // ---- Extra objective: the Brain King ------------------------------------

  private spawnBoss() {
    const s = this.world.openGroundNear(LEVEL.start[0], LEVEL.start[1] - 4);
    this.boss = new Enemy(this, s.x, s.y, 0, 'boss');
    this.enemies.push(this.boss);
    this.cameras.main.shake(400, 0.006);
    this.hud.toast('The Brain King has risen in the plaza!');
    this.hud.updateCounters();
  }

  // ---- Combat -------------------------------------------------------------

  onPlayerAttack(hit: PlayerHit) {
    let landed = false;
    for (const e of [...this.enemies]) {
      if (e.dead || !e.sameHeightAs(this.player)) continue;
      const box = e.hurtBox;
      const touched = hit.radius !== undefined
        ? Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(this.player.x, this.player.y - 6, hit.radius), box)
        : Phaser.Geom.Intersects.RectangleToRectangle(hit.rect, box);
      if (!touched) continue;
      landed = true;
      spark(this, e.x, e.y - 10 * e.stats.scale);
      if (e.takeHit(this.player.x, this.player.y, this.time.now, hit.damage, hit.knock)) this.onEnemyKilled(e);
    }
    if (landed) {
      this.cameras.main.shake(hit.finisher ? 120 : 60, hit.finisher ? 0.005 : 0.002);
      if (hit.finisher) this.freezeUntil = this.time.now + 70;
    }
  }

  private onEnemyKilled(e: Enemy) {
    Phaser.Utils.Array.Remove(this.enemies, e);
    if (e === this.boss) {
      this.bossDone = true;
      this.cameras.main.shake(500, 0.008);
      this.time.delayedCall(900, () => this.showPanel('Brain King defeated!', 'You are the legend of the zombie block.', '', false));
    } else {
      this.spawnDrop(e);
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

  // Spitter projectiles fly in a straight line at the shooter's height.
  spawnSpit(enemy: Enemy, angle: number, speed: number, damage: number) {
    const x = enemy.x + Math.cos(angle) * 8, y = enemy.y + Math.sin(angle) * 8;
    const img = this.add.image(x, y - 9, 'spit').setDepth(depthFor(enemy.level, y));
    const shadow = this.add.ellipse(x, y, 5, 2, 0x000000, SHADOW_ALPHA).setDepth(depthFor(enemy.level, y) - 1);
    this.spits.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, level: enemy.level, damage, img, shadow, life: 2.2 });
  }

  private updateSpits(dt: number) {
    const p = this.player;
    for (const s of this.spits) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      const k = this.world.kindAtPixel(s.x, s.y);
      const blocked = isSolid(k) || (HEIGHT[k] ?? 0) > s.level;     // walls and higher roofs stop it
      const hit = !p.isDead && Math.abs(p.x - s.x) < 6 && Math.abs(p.y - s.y) < 6 && (p.level === s.level || p.onStairs);
      if (hit) this.hurtPlayer(s.x - s.vx, s.y - s.vy, s.damage);
      if (hit || blocked || s.life <= 0) {
        s.dead = true; s.img.destroy(); s.shadow.destroy();
        splat(this, s.x, s.y - 6, s.level);
        continue;
      }
      s.img.setPosition(s.x, s.y - 9).setDepth(depthFor(s.level, s.y)).rotation += dt * 10;
      s.shadow.setPosition(s.x, s.y).setDepth(depthFor(s.level, s.y) - 1);
    }
    this.spits = this.spits.filter(s => !s.dead);
  }

  // Pauses play behind a panel. canContinue: Enter resumes; otherwise the run is over.
  private showPanel(title: string, line: string, extra: string, canContinue: boolean) {
    if (!canContinue) this.gameOver = true;
    this.paused = true;
    this.hud.showPanel(title, line, extra, canContinue ? () => { this.paused = false; } : undefined);
  }

  // Backtick: red = tiles you can't step onto from where you stand, green = feet boxes.
  private drawDebug() {
    const g = this.debug.clear();
    const cam = this.cameras.main, p = this.player;
    const from = this.world.kindAtPixel(p.x, p.y - 2);
    const tx0 = Math.floor(cam.worldView.x / TILE_SIZE), ty0 = Math.floor(cam.worldView.y / TILE_SIZE);
    for (let ty = ty0; ty <= ty0 + 12; ty++) for (let tx = tx0; tx <= tx0 + 21; tx++) {
      if (!canEnter(from, this.world.kindAt(tx, ty), p.level)) {
        g.fillStyle(0xff3b3b, 0.25).fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    for (const w of [p, ...this.enemies]) {
      g.lineStyle(1, 0x40ff80, 1).strokeRect(w.x - FEET.w / 2, w.y - FEET.h, FEET.w, FEET.h);
    }
  }
}
