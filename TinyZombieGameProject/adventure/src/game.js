// =====================================================================
// CONFIG — shared numbers. Change tuning here, not inside scenes.
// =====================================================================
const TILE_SIZE = 16;

// Every character frame is a 48x32 cell; the feet sit at (24, 30).
// That's why sprites use origin (0.5, 30/32): x/y = where the feet touch the ground.
const CELL = { w: 48, h: 32, footY: 30 };
const FEET = { w: 10, h: 5 };      // collision box under every walker

const PLAYER = {
  speed: 82,                       // pixels per second
  maxHealth: 5,                    // hearts (each brain heals one)
  invulnerableMs: 1000,
  knockbackSpeed: 170, knockbackMs: 180,
};

const SWORD = {
  reach: 13, width: 20, height: 18,
  hitDelayMs: 110,    // damage lands on the frame where the slash appears
  swingMs: 240, cooldownMs: 330,
};

const ZOMBIE = {
  health: 3,
  wanderSpeed: 14, chaseSpeed: 31,
  chaseRange: 100,     // starts chasing when the player is this close (same height only)
  attackRange: 17, attackReach: 22,
  attackHitDelayMs: 220, attackMs: 420, attackCooldownMs: 1100,
  knockbackSpeed: 150, stunMs: 260,
  sleepRange: 420,     // zombies further than this from the player don't think (saves work)
};

const BRAINS_TO_WIN = 10;

// =====================================================================
// LEVEL RULES — the map is a grid of one-letter tile kinds (see tools/level.py).
//   S street  P paving  A lot  G grass   → ground, height 0
//   1 2 3 roofs                          → heights 1, 2, 3
//   T stairs   R bridge (street underneath)
//   W water  B building wall  K block/tree → solid
// =====================================================================
const HEIGHT = { S: 0, P: 0, A: 0, G: 0, R: 0, 1: 1, 2: 2, 3: 3 };
const SOLID = 'WBK';
const HEIGHT_NAMES = ['STREET', 'ROOF L1', 'ROOF L2', 'ROOF L3'];

// Can a walker at `level`, standing on tile kind `from`, step onto tile kind `to`?
// Stairs and bridges can be entered from anywhere; leaving stairs puts you at the
// height of wherever you step; from a raised bridge you can only step onto a roof.
// Everywhere else you can only walk onto tiles of your own height.
// (tools/level.py uses the same rules to check every brain can be reached.)
function canEnter(from, to, level) {
  if (SOLID.includes(to)) return false;
  if (to === 'T' || to === 'R') return true;
  const h = HEIGHT[to];
  if (from === 'T') return true;
  if (from === 'R' && level >= 1) return h >= 1;
  return h === level;
}

// Drawing order: walkers above street level are drawn over bridges (depth 9999),
// walkers on the street are drawn under them.
const RAISED_DEPTH = 10000;
const BRIDGE_DEPTH = 9999;
const HUD_DEPTH = 100000;

const DIRS = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const UI = { heartFull: 0xe0504f, heartEmpty: 0x3b3445, font: '"Pixelify Sans", monospace', ink: '#3a2c38', brain: 0xe88ca0 };

// Bottom-centre of a tile, in pixels.
const tileBase = (tx, ty) => ({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: (ty + 1) * TILE_SIZE });

// =====================================================================
// BOOT SCENE — turns the embedded images into textures and animations.
// =====================================================================
class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  async create() {
    // Decode every embedded PNG first; Phaser needs finished <img> elements.
    const entries = await Promise.all(Object.entries(IMAGES).map(([key, src]) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve([key, img]);
      img.onerror = () => reject(new Error('Could not decode image ' + key));
      img.src = src;
    })));
    for (const [key, img] of entries) {
      if (key === 'hero' || key === 'zombie') {
        this.textures.addSpriteSheet(key, img, { frameWidth: CELL.w, frameHeight: CELL.h });
      } else {
        this.textures.addImage(key, img);
      }
    }
    this.makeAnims('hero', HERO_ANIMS);
    this.makeAnims('zombie', ZOMBIE_ANIMS);
    this.scene.start('GameScene');
  }

  // Turn {name: [firstFrame, count]} into Phaser animations called "hero_walk_side" etc.
  makeAnims(texture, table) {
    const speed = { idle: 6, walk: 10, attack: 16, hurt: 12, dead: 6 };
    for (const [name, [start, count]] of Object.entries(table)) {
      const kind = name.split('_')[0];
      this.anims.create({
        key: `${texture}_${name}`,
        frames: this.anims.generateFrameNumbers(texture, { start, end: start + count - 1 }),
        frameRate: speed[kind],
        repeat: kind === 'idle' || kind === 'walk' ? -1 : 0,
      });
    }
  }
}

// =====================================================================
// WALKER — anything that moves on the map: hero and zombies.
// It has a height `level` and moves with scene.moveWalker(), which
// checks tiles instead of using a physics engine.
// =====================================================================
class Walker extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y, texture, level) {
    super(scene, x, y, texture, 0);
    scene.add.existing(this);
    this.setOrigin(0.5, CELL.footY / CELL.h);
    this.level = level;
    this.tileKind = 'P';
    // Knockback: a push that fades out over a few frames.
    this.pushX = 0; this.pushY = 0; this.pushUntil = 0;
    this.shadow = scene.add.ellipse(x, y, 12, 4, 0x000000, 0.28);
  }

  get onStairs() { return this.tileKind === 'T'; }

  // Same height, or one of us on stairs (stairs are between heights).
  sameHeightAs(other) {
    return this.level === other.level || this.onStairs || other.onStairs;
  }

  push(fromX, fromY, speed, ms, time) {
    const v = new Phaser.Math.Vector2(this.x - fromX, this.y - fromY).normalize().scale(speed);
    this.pushX = v.x; this.pushY = v.y; this.pushUntil = time + ms;
  }

  // Apply a running knockback. Returns true while being pushed.
  applyPush(time, dt) {
    if (time >= this.pushUntil) return false;
    this.scene.moveWalker(this, this.pushX * dt, this.pushY * dt);
    return true;
  }

  // Sort by feet; raised walkers go above bridges. Keep the shadow under the feet.
  syncDepth() {
    const base = this.level >= 1 ? RAISED_DEPTH : 0;
    this.setDepth(base + this.y);
    this.shadow.setPosition(this.x, this.y - 1).setDepth(base + this.y - 0.5);
  }

  destroy(fromScene) {
    this.shadow?.destroy();
    super.destroy(fromScene);
  }
}

// =====================================================================
// PLAYER — knocked back (no control) → attacking (frozen) → walking.
// The art has a front view and a side view; walking up reuses the front view.
// =====================================================================
class Player extends Walker {
  constructor(scene, x, y) {
    super(scene, x, y, 'hero', 0);
    this.health = PLAYER.maxHealth;
    this.facing = 'down';
    this.attackUntil = 0;
    this.nextAttackAt = 0;
    this.invulnerableUntil = 0;
    this.keys = scene.input.keyboard.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
      attack: 'SPACE', attack2: 'J',
    });
    this.playAnim('idle');
  }

  get isDead() { return this.health <= 0; }

  playAnim(kind) {
    const side = this.facing === 'left' || this.facing === 'right';
    this.setFlipX(this.facing === 'left');
    this.anims.play(`hero_${kind}_${side ? 'side' : 'down'}`, true);
  }

  update(time, dt) {
    this.setAlpha(time < this.invulnerableUntil && Math.floor(time / 80) % 2 ? 0.35 : 1);
    if (this.isDead) return;
    if (this.applyPush(time, dt)) return;
    if (time < this.attackUntil) return;

    const k = this.keys;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if ((JustDown(k.attack) || JustDown(k.attack2)) && time >= this.nextAttackAt) return this.attack(time);

    // Each axis becomes -1, 0 or 1 (true/false count as 1/0 when subtracted).
    const dx = (k.right.isDown || k.d.isDown) - (k.left.isDown || k.a.isDown);
    const dy = (k.down.isDown || k.s.isDown) - (k.up.isDown || k.w.isDown);
    // Normalising stops diagonals from being ~41% faster.
    const v = new Phaser.Math.Vector2(dx, dy).normalize().scale(PLAYER.speed * dt);
    this.scene.moveWalker(this, v.x, v.y, true);

    if (dx < 0) this.facing = 'left';
    else if (dx > 0) this.facing = 'right';
    else if (dy < 0) this.facing = 'up';
    else if (dy > 0) this.facing = 'down';
    this.playAnim(dx || dy ? 'walk' : 'idle');
  }

  attack(time) {
    this.attackUntil = time + SWORD.swingMs;
    this.nextAttackAt = time + SWORD.cooldownMs;
    this.playAnim('attack');
    const d = DIRS[this.facing];
    const cx = this.x + d.x * SWORD.reach;
    const cy = this.y - 3 + d.y * SWORD.reach - (d.x ? 4 : 0);
    const w = d.x ? SWORD.height : SWORD.width;
    const h = d.x ? SWORD.width : SWORD.height;
    const hitBox = new Phaser.Geom.Rectangle(cx - w / 2, cy - h / 2, w, h);
    this.scene.time.delayedCall(SWORD.hitDelayMs, () => {
      if (!this.isDead) this.scene.onPlayerAttack(hitBox);
    });
  }

  takeHit(fromX, fromY, time) {
    if (this.isDead || time < this.invulnerableUntil) return false;
    this.health -= 1;
    this.invulnerableUntil = time + PLAYER.invulnerableMs;
    this.attackUntil = 0;
    this.push(fromX, fromY, PLAYER.knockbackSpeed, PLAYER.knockbackMs, time);
    this.playAnim('hurt');
    return true;
  }
}

// =====================================================================
// ZOMBIE — shambles around; chases you when you're close and on its height.
// The art faces right, so we mirror it (flipX) to face left.
// =====================================================================
class Zombie extends Walker {
  constructor(scene, x, y, level) {
    super(scene, x, y, 'zombie', level);
    this.health = ZOMBIE.health;
    this.dead = false;
    this.stunnedUntil = 0;
    this.attackUntil = 0;
    this.nextAttackAt = 0;
    this.nextTurnAt = 0;
    this.wander = { x: 0, y: 0 };
    this.anims.play('zombie_idle');
    this.anims.setProgress(Math.random());   // don't all bob in sync
  }

  update(time, dt, player) {
    if (this.dead) return;
    if (this.applyPush(time, dt)) return;
    if (time < this.stunnedUntil || time < this.attackUntil) return;

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (dist > ZOMBIE.sleepRange) return;                       // too far away to care
    const canSee = !player.isDead && dist < ZOMBIE.chaseRange && this.sameHeightAs(player);

    if (canSee && dist < ZOMBIE.attackRange && time >= this.nextAttackAt) return this.startAttack(time, player);

    let vx = 0, vy = 0;
    if (canSee) {
      vx = (player.x - this.x) / dist * ZOMBIE.chaseSpeed;
      vy = (player.y - this.y) / dist * ZOMBIE.chaseSpeed;
    } else {
      if (time >= this.nextTurnAt) {
        // Wander: a new random direction now and then (sometimes standing still).
        this.wander = Phaser.Utils.Array.GetRandom([...Object.values(DIRS), { x: 0, y: 0 }, { x: 0, y: 0 }]);
        this.nextTurnAt = time + Phaser.Math.Between(900, 2200);
      }
      vx = this.wander.x * ZOMBIE.wanderSpeed;
      vy = this.wander.y * ZOMBIE.wanderSpeed;
    }
    const moved = this.scene.moveWalker(this, vx * dt, vy * dt);
    if (!moved && !canSee) this.nextTurnAt = 0;                 // bumped into something: turn

    if (Math.abs(vx) > 1) this.setFlipX(vx < 0);
    this.anims.play(vx || vy ? 'zombie_walk' : 'zombie_idle', true);
  }

  startAttack(time, player) {
    this.setFlipX(player.x < this.x);
    this.anims.play('zombie_attack');
    this.attackUntil = time + ZOMBIE.attackMs;
    this.nextAttackAt = time + ZOMBIE.attackCooldownMs;
    const swingStart = this.stunnedUntil;
    this.scene.time.delayedCall(ZOMBIE.attackHitDelayMs, () => {
      // A hit from the player during the wind-up cancels the swing.
      if (this.dead || this.stunnedUntil !== swingStart) return;
      const inFront = this.flipX ? player.x <= this.x + 4 : player.x >= this.x - 4;
      const close = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) < ZOMBIE.attackReach;
      if (inFront && close && this.sameHeightAs(player)) this.scene.onZombieHit(this);
    });
  }

  // Returns true if this hit killed the zombie.
  takeHit(fromX, fromY, time) {
    if (this.dead) return false;
    this.health -= 1;
    this.attackUntil = 0;
    if (this.health <= 0) { this.die(); return true; }
    this.stunnedUntil = time + ZOMBIE.stunMs;
    this.anims.play('zombie_hurt');
    this.push(fromX, fromY, ZOMBIE.knockbackSpeed, ZOMBIE.stunMs, time);
    return false;
  }

  die() {
    this.dead = true;
    this.anims.play('zombie_dead');
    this.scene.tweens.add({
      targets: [this, this.shadow], alpha: 0, delay: 1400, duration: 600,
      onComplete: () => this.destroy(),
    });
  }
}

// =====================================================================
// GAME SCENE — builds the world, moves walkers, runs combat and the HUD.
// =====================================================================
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create() {
    const L = LEVEL;
    this.mapW = L.w; this.mapH = L.h;
    this.worldW = L.w * TILE_SIZE; this.worldH = L.h * TILE_SIZE;

    // The whole map is two pre-drawn pictures: the ground, and the bridges on top.
    this.add.image(0, 0, 'level_ground').setOrigin(0).setDepth(-10);
    this.add.image(0, 0, 'level_bridges').setOrigin(0).setDepth(BRIDGE_DEPTH);

    // Props and trees: depth = their base, so you're behind them when your feet are above it.
    for (const [type, x, y] of L.props) {
      const img = this.add.image(x, y, type).setOrigin(0.5, 1).setDepth(y);
      if (type.startsWith('tree')) this.add.ellipse(x, y - 1, img.width * 0.75, 5, 0x000000, 0.25).setDepth(-1);
    }

    const s = tileBase(...L.start);
    this.player = new Player(this, s.x, s.y);
    this.zombies = L.zombies.map(([tx, ty, lv]) => { const p = tileBase(tx, ty); return new Zombie(this, p.x, p.y, lv); });
    this.totalZombies = this.zombies.length;
    this.brains = L.brains.map(([tx, ty, lv]) => this.makeBrain(tx, ty, lv));
    this.brainsCollected = 0;

    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setRoundPixels(true);

    this.pointer = this.add.graphics().setDepth(HUD_DEPTH - 1);
    this.debug = this.add.graphics().setDepth(HUD_DEPTH - 2);
    this.showDebug = false;
    this.createHud();
    this.gameOver = false;
    this.input.keyboard.on('keydown-BACKTICK', () => { this.showDebug = !this.showDebug; this.debug.clear(); });
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000;   // seconds; capped so a hiccup can't tunnel through walls
    this.player.update(time, dt);
    this.zombies.forEach(z => z.update(time, dt, this.player));
    this.player.syncDepth();
    this.zombies.forEach(z => z.syncDepth());
    this.checkBrains();
    this.drawPointer();
    this.levelLabel.setText(this.player.onStairs ? 'STAIRS' : HEIGHT_NAMES[this.player.level]);
    if (this.showDebug) this.drawDebug();
  }

  // ---- Tiles & movement -------------------------------------------------

  kindAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return 'W';   // outside = solid
    return LEVEL.tiles[ty * this.mapW + tx];
  }
  kindAtPixel(x, y) { return this.kindAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)); }

  // Tile indexes covered by a feet box standing at (x, y).
  tilesUnder(x, y) {
    const out = [];
    const x0 = Math.floor((x - FEET.w / 2) / TILE_SIZE), x1 = Math.floor((x + FEET.w / 2 - 0.01) / TILE_SIZE);
    const y0 = Math.floor((y - FEET.h) / TILE_SIZE), y1 = Math.floor((y - 0.01) / TILE_SIZE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push([tx, ty]);
    return out;
  }

  // Could walker w stand at (x, y)? Only tiles it isn't already touching are checked,
  // so standing half on stairs and half on a roof never traps you.
  canStand(w, x, y) {
    const from = this.kindAtPixel(w.x, w.y - 2);
    const before = new Set(this.tilesUnder(w.x, w.y).map(([tx, ty]) => ty * this.mapW + tx));
    for (const [tx, ty] of this.tilesUnder(x, y)) {
      if (before.has(ty * this.mapW + tx)) continue;
      if (!canEnter(from, this.kindAt(tx, ty), w.level)) return false;
    }
    return true;
  }

  // Move one axis at a time, so you slide along walls instead of sticking.
  // With `assist`, a blocked move nudges you around corners (up to 6px).
  moveWalker(w, dx, dy, assist = false) {
    let moved = false;
    for (const [mx, my] of [[dx, 0], [0, dy]]) {
      if (!mx && !my) continue;
      if (this.canStand(w, w.x + mx, w.y + my)) { w.x += mx; w.y += my; moved = true; continue; }
      if (!assist) continue;
      for (let off = 1; off <= 6; off++) {
        const s = [-1, 1].find(sign => my === 0
          ? this.canStand(w, w.x + mx, w.y + sign * off) && this.canStand(w, w.x, w.y + sign)
          : this.canStand(w, w.x + sign * off, w.y + my) && this.canStand(w, w.x + sign, w.y));
        if (s) { if (my === 0) w.y += s; else w.x += s; moved = true; break; }
      }
    }
    // Your height changes when your feet settle on a roof or ground tile.
    const k = this.kindAtPixel(w.x, w.y - 2);
    w.tileKind = k;
    if (k !== 'T' && k !== 'R') w.level = HEIGHT[k];
    return moved;
  }

  // ---- Brains -----------------------------------------------------------

  makeBrain(tx, ty, level) {
    const x = tx * TILE_SIZE + TILE_SIZE / 2, y = ty * TILE_SIZE + TILE_SIZE - 3;
    const base = level >= 1 ? RAISED_DEPTH : 0;
    const shadow = this.add.ellipse(x, y, 10, 3, 0x000000, 0.3).setDepth(base + y - 1);
    const img = this.add.image(x, y - 4, 'brain').setOrigin(0.5, 1).setDepth(base + y);
    this.tweens.add({ targets: img, y: y - 8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    return { x, y, level, img, shadow, taken: false };
  }

  checkBrains() {
    const p = this.player;
    if (p.isDead || this.gameOver) return;
    for (const b of this.brains) {
      if (b.taken) continue;
      const close = Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) < 12;
      if (!close || !(p.level === b.level || p.onStairs)) continue;
      b.taken = true;
      this.brainsCollected++;
      p.health = Math.min(PLAYER.maxHealth, p.health + 1);       // a brain heals one heart
      this.updateHearts();
      this.updateBrainCounter();
      b.shadow.destroy();
      this.tweens.add({ targets: b.img, y: b.img.y - 16, alpha: 0, scale: 1.6, duration: 350, onComplete: () => b.img.destroy() });
      if (this.brainsCollected >= BRAINS_TO_WIN) this.endGame('Level cleared!', `All ${BRAINS_TO_WIN} brains collected.`);
    }
  }

  // A small arrow around the hero pointing at the nearest brain still out there.
  drawPointer() {
    const g = this.pointer.clear();
    const p = this.player;
    if (this.gameOver) return;
    let best = null, bd = Infinity;
    for (const b of this.brains) {
      if (b.taken) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best || bd < 48) return;
    const a = Phaser.Math.Angle.Between(p.x, p.y - 10, best.x, best.y);
    const cx = p.x + Math.cos(a) * 20, cy = p.y - 10 + Math.sin(a) * 20;
    const pt = (r, da) => ({ x: cx + Math.cos(a + da) * r, y: cy + Math.sin(a + da) * r });
    const tip = pt(5, 0), l = pt(4, 2.5), r = pt(4, -2.5);
    g.fillStyle(0x2a1a24, 0.8).fillTriangle(tip.x + 1, tip.y + 1, l.x + 1, l.y + 1, r.x + 1, r.y + 1);
    g.fillStyle(UI.brain, 1).fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  // ---- Combat -----------------------------------------------------------

  onPlayerAttack(hitBox) {
    for (const z of [...this.zombies]) {
      if (z.dead || !z.sameHeightAs(this.player)) continue;
      const zBox = new Phaser.Geom.Rectangle(z.x - 6, z.y - 16, 12, 16);   // the zombie's body
      if (!Phaser.Geom.Intersects.RectangleToRectangle(hitBox, zBox)) continue;
      this.cameras.main.shake(60, 0.002);
      if (z.takeHit(this.player.x, this.player.y, this.time.now)) {
        Phaser.Utils.Array.Remove(this.zombies, z);
        this.updateZombieCounter();
      }
    }
  }

  onZombieHit(zombie) {
    if (this.gameOver || !this.player.takeHit(zombie.x, zombie.y, this.time.now)) return;
    this.cameras.main.shake(120, 0.005);
    this.updateHearts();
    if (this.player.isDead) this.endGame('You were bitten', `Brains collected: ${this.brainsCollected}/${BRAINS_TO_WIN}`);
  }

  // ---- HUD --------------------------------------------------------------
  // setScrollFactor(0) pins things to the screen instead of the world.

  createHud() {
    const hud = o => o.setScrollFactor(0).setDepth(HUD_DEPTH);
    const style = { fontFamily: UI.font, fontSize: '11px', color: '#f1e8dc', stroke: '#1a1d1c', strokeThickness: 3 };
    this.hearts = [];
    for (let i = 0; i < PLAYER.maxHealth; i++) this.hearts.push(hud(this.add.image(6 + i * 15, 6, 'heart').setOrigin(0)));
    this.updateHearts();

    hud(this.add.image(296, 5, 'brain').setOrigin(1, 0));
    this.brainText = hud(this.add.text(314, 3, '', style).setOrigin(1, 0).setResolution(4));
    hud(this.add.image(296, 20, 'skull').setOrigin(1, 0).setTint(0xd9d0c4));
    this.zombieText = hud(this.add.text(314, 18, '', style).setOrigin(1, 0).setResolution(4));
    this.levelLabel = hud(this.add.text(6, 20, '', { ...style, fontSize: '9px', color: '#c9d2cc' }).setResolution(4));
    this.updateBrainCounter();
    this.updateZombieCounter();
  }

  updateHearts() {
    this.hearts.forEach((h, i) => h.setTint(i < this.player.health ? UI.heartFull : UI.heartEmpty));
  }
  updateBrainCounter() { this.brainText.setText(`${this.brainsCollected}/${BRAINS_TO_WIN}`); }
  updateZombieCounter() { this.zombieText.setText(`${this.zombies.length}`); }

  endGame(title, line) {
    if (this.gameOver) return;
    this.gameOver = true;
    const top = o => o.setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    top(this.add.rectangle(160, 90, 320, 180, 0x14121a, 0.5));
    // nineslice stretches the panel's middle but keeps its 6px corners crisp.
    top(this.add.nineslice(160, 90, 'panel', undefined, 176, 70, 6, 6, 6, 6));
    const text = (y, str, size) => top(this.add.text(160, y, str, {
      fontFamily: UI.font, fontSize: size, color: UI.ink, align: 'center',
    }).setOrigin(0.5).setResolution(4));
    text(74, title, '16px');
    text(94, line, '9px');
    text(108, 'Press R to play again', '9px');
    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }

  // Backtick: red = tiles you can't step onto from where you stand, green = feet boxes.
  drawDebug() {
    const g = this.debug.clear();
    const cam = this.cameras.main, p = this.player;
    const from = this.kindAtPixel(p.x, p.y - 2);
    const tx0 = Math.floor(cam.worldView.x / TILE_SIZE), ty0 = Math.floor(cam.worldView.y / TILE_SIZE);
    for (let ty = ty0; ty <= ty0 + 12; ty++) for (let tx = tx0; tx <= tx0 + 21; tx++) {
      if (!canEnter(from, this.kindAt(tx, ty), p.level)) {
        g.fillStyle(0xff3b3b, 0.25).fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    for (const w of [p, ...this.zombies]) {
      g.lineStyle(1, 0x40ff80, 1).strokeRect(w.x - FEET.w / 2, w.y - FEET.h, FEET.w, FEET.h);
    }
  }
}

// =====================================================================
// START — 320x180 virtual screen, scaled up with crisp pixels.
// We wait for the pixel font so in-game text doesn't flash a fallback.
// =====================================================================
function startGame() {
  window.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 320, height: 180,
    pixelArt: true,
    backgroundColor: '#3d3b4a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, GameScene],
  });
}
Promise.race([
  document.fonts?.load('16px "Pixelify Sans"') ?? Promise.resolve(),
  new Promise(r => setTimeout(r, 1500)),
]).catch(() => {}).then(startGame);

// Keyboard only works once the page has focus; clicking the game gives it focus.
document.getElementById('game').addEventListener('pointerdown', e => e.currentTarget.focus());
// Stop Space and arrow keys from scrolling the page while playing.
window.addEventListener('keydown', e => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
});
