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

// The sword combo: tap attack again near the end of a swing to chain the next hit.
// Hit 3 is a spinning finisher that hits all around you.
const COMBO = [
  { anim: 'attack', swingMs: 240, hitDelayMs: 110, damage: 1, reach: 13, w: 20, h: 18, lunge: 0, knock: 150 },
  { anim: 'combo',  swingMs: 210, hitDelayMs: 90,  damage: 1, reach: 16, w: 22, h: 20, lunge: 6, knock: 170 },
  { anim: 'attack', swingMs: 340, hitDelayMs: 120, damage: 2, radius: 28,           lunge: 4, knock: 240, finisher: true },
];
const COMBO_WINDOW_MS = 380;      // time after a swing in which the next tap continues the combo
const FINISHER_REST_MS = 260;     // short pause after the finisher

// Three enemy types (plus the boss). Outline colour on the sprite tells them apart.
const ENEMY_TYPES = {
  walker: {   // grey outline: shambles up and swings
    sheet: 'zombie_walker', health: 3, scale: 1, wanderSpeed: 14, chaseSpeed: 31, chaseRange: 100,
    attack: 'melee', range: 17, reach: 22, damage: 1, windupMs: 220, attackMs: 420, cooldownMs: 1100,
    stunMs: 260, knockTaken: 1,
  },
  spitter: {  // green outline: keeps its distance and spits
    sheet: 'zombie_spitter', health: 2, scale: 1, wanderSpeed: 14, chaseSpeed: 26, chaseRange: 140,
    attack: 'spit', keepAway: [56, 110], damage: 1, windupMs: 240, attackMs: 380, cooldownMs: 1700,
    spitSpeed: 95, stunMs: 260, knockTaken: 1.1,
  },
  brute: {    // red outline: slow and tough, winds up a ground slam
    sheet: 'zombie_brute', health: 6, scale: 1.35, wanderSpeed: 10, chaseSpeed: 22, chaseRange: 110,
    attack: 'slam', range: 26, slamRadius: 34, damage: 2, windupMs: 650, attackMs: 1000, cooldownMs: 1800,
    stunMs: 180, knockTaken: 0.45,
  },
  boss: {     // gold outline: the Brain King, the bonus objective
    sheet: 'zombie_boss', health: 30, scale: 2, wanderSpeed: 0, chaseSpeed: 26, chaseRange: 600,
    attack: 'boss', range: 34, slamRadius: 52, damage: 2, windupMs: 700, attackMs: 1050, cooldownMs: 1500,
    spitSpeed: 105, stunMs: 120, knockTaken: 0.15,
  },
};
// Which type each spawn point gets: mostly walkers, some spitters, a few brutes.
const typeForSpawn = i => { const r = (i * 7) % 20; return r < 12 ? 'walker' : r < 17 ? 'spitter' : 'brute'; };
const SLEEP_RANGE = 420;   // enemies further than this from the player don't think (saves work)

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
const UI = {
  heartFull: 0xe0504f, heartEmpty: 0x3b3445, font: '"Pixelify Sans", monospace', ink: '#3a2c38',
  brain: 0xf08caa, gold: 0xffce48,
};
const SHADOW_ALPHA = 0.4;

// Bottom-centre of a tile, in pixels.
const tileBase = (tx, ty) => ({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: (ty + 1) * TILE_SIZE });
const depthFor = (level, y) => (level >= 1 ? RAISED_DEPTH : 0) + y;

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
      if (key === 'hero' || key.startsWith('zombie_')) {
        this.textures.addSpriteSheet(key, img, { frameWidth: CELL.w, frameHeight: CELL.h });
      } else {
        this.textures.addImage(key, img);
      }
    }
    this.makeAnims('hero', HERO_ANIMS);
    for (const t of Object.values(ENEMY_TYPES)) this.makeAnims(t.sheet, ZOMBIE_ANIMS);
    this.scene.start('GameScene');
  }

  // Turn {name: [firstFrame, count]} into animations called e.g. "hero_walk_side".
  makeAnims(texture, table) {
    const speed = { idle: 6, walk: 10, attack: 16, combo: 18, hurt: 12, dead: 6, shot: 12, windup: 8, cast: 10 };
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
// WALKER — anything that moves on the map: hero and enemies.
// It has a height `level` and moves with scene.moveWalker(), which
// checks tiles instead of using a physics engine.
// =====================================================================
class Walker extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y, texture, level, scale = 1) {
    super(scene, x, y, texture, 0);
    scene.add.existing(this);
    this.setOrigin(0.5, CELL.footY / CELL.h).setScale(scale);
    this.level = level;
    this.tileKind = 'P';
    // Knockback: a push that lasts a few frames.
    this.pushX = 0; this.pushY = 0; this.pushUntil = 0;
    this.shadow = scene.add.ellipse(x, y, 12 * scale, 4 * scale, 0x000000, SHADOW_ALPHA);
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
    this.setDepth(depthFor(this.level, this.y));
    this.shadow.setPosition(this.x, this.y - 1).setDepth(depthFor(this.level, this.y) - 0.5);
  }

  destroy(fromScene) {
    this.shadow?.destroy();
    super.destroy(fromScene);
  }
}

// =====================================================================
// PLAYER — knocked back (no control) → swinging (frozen) → walking.
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
    this.comboStep = 0;          // which hit of the combo we're on (1-3)
    this.comboUntil = 0;         // the next tap continues the combo until this time
    this.queuedAttack = false;   // a tap during a swing waits for the swing to finish
    this.keys = scene.input.keyboard.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
      attack: 'SPACE', attack2: 'J',
    });
    this.playAnim('idle');
  }

  get isDead() { return this.health <= 0; }

  playAnim(kind, restart = false) {
    const side = this.facing === 'left' || this.facing === 'right';
    this.setFlipX(this.facing === 'left');
    this.anims.play(`hero_${kind}_${side ? 'side' : 'down'}`, !restart);
  }

  update(time, dt) {
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
    // Continue the combo if we're inside its window, otherwise start again at hit 1.
    this.comboStep = time <= this.comboUntil && this.comboStep < COMBO.length ? this.comboStep + 1 : 1;
    const hit = COMBO[this.comboStep - 1];
    this.attackUntil = time + hit.swingMs;
    this.nextAttackAt = time + hit.swingMs + (hit.finisher ? FINISHER_REST_MS : 0);
    this.comboUntil = hit.finisher ? 0 : time + hit.swingMs + COMBO_WINDOW_MS;
    this.playAnim(hit.anim, true);

    // Later hits step forward a little, which keeps the combo connecting.
    const d = DIRS[this.facing];
    for (let i = 0; i < hit.lunge; i += 2) this.scene.moveWalker(this, d.x * 2, d.y * 2, true);

    let area;
    if (hit.finisher) {
      area = { radius: hit.radius };
      this.scene.spinSlash(this, hit);
    } else {
      const cx = this.x + d.x * hit.reach;
      const cy = this.y - 3 + d.y * hit.reach - (d.x ? 4 : 0);
      const w = d.x ? hit.h : hit.w, h = d.x ? hit.w : hit.h;
      area = { rect: new Phaser.Geom.Rectangle(cx - w / 2, cy - h / 2, w, h) };
    }
    if (this.comboStep > 1) this.scene.popText(this.x, this.y - 30, hit.finisher ? 'x3!' : 'x2', hit.finisher ? '#ffce48' : '#fff4e0');
    this.scene.time.delayedCall(hit.hitDelayMs, () => {
      if (!this.isDead) this.scene.onPlayerAttack({ ...area, damage: hit.damage, knock: hit.knock, finisher: hit.finisher });
    });
  }

  takeHit(fromX, fromY, time, damage = 1) {
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

// =====================================================================
// ENEMY — one class for every type; ENEMY_TYPES says how each one fights.
// The art faces right, so we mirror it (flipX) to face left.
// =====================================================================
class Enemy extends Walker {
  constructor(scene, x, y, level, typeName) {
    const type = ENEMY_TYPES[typeName];
    super(scene, x, y, type.sheet, level, type.scale);
    this.type = type;
    this.typeName = typeName;
    this.health = type.health;
    this.dead = false;
    this.stunnedUntil = 0;
    this.attackUntil = 0;
    this.nextAttackAt = 0;
    this.nextTurnAt = 0;
    this.wander = { x: 0, y: 0 };
    this.bossMove = 0;           // the boss alternates between slam and spit
    this.play('idle');
    this.anims.setProgress(Math.random());   // don't all bob in sync
  }

  play(anim, restart = false) { return this.anims.play(`${this.type.sheet}_${anim}`, !restart); }

  // The part of the body the sword can hit.
  get hurtBox() {
    const s = this.type.scale;
    return new Phaser.Geom.Rectangle(this.x - 6 * s, this.y - 16 * s, 12 * s, 16 * s);
  }

  update(time, dt, player) {
    if (this.dead) return;
    if (this.applyPush(time, dt)) return;
    if (time < this.stunnedUntil || time < this.attackUntil) return;

    const T = this.type;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (dist > Math.max(SLEEP_RANGE, T.chaseRange)) return;            // too far away to care
    const canSee = !player.isDead && dist < T.chaseRange && this.sameHeightAs(player);

    if (canSee && time >= this.nextAttackAt && this.inAttackRange(dist)) return this.startAttack(time, player, dist);

    let vx = 0, vy = 0;
    const toward = (speed, sign = 1) => {
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
    const moved = this.scene.moveWalker(this, vx * dt, vy * dt);
    if (!moved && !canSee) this.nextTurnAt = 0;                 // bumped into something: turn

    if (Math.abs(vx) > 1 && !T.keepAway) this.setFlipX(vx < 0);
    if (Math.abs(vx) > 1 && T.keepAway && !canSee) this.setFlipX(vx < 0);
    this.play(vx || vy ? 'walk' : 'idle');
  }

  inAttackRange(dist) {
    const T = this.type;
    if (T.attack === 'spit') return dist < T.keepAway[1] + 30;
    if (T.attack === 'boss') return dist < 170;
    return dist < T.range;
  }

  startAttack(time, player, dist) {
    const T = this.type;
    this.setFlipX(player.x < this.x);
    this.attackUntil = time + T.attackMs;
    this.nextAttackAt = time + T.cooldownMs;
    const swingStart = this.stunnedUntil;
    // A hit from the player during the wind-up cancels the attack (except for heavies).
    const cancelled = () => this.dead || (T.knockTaken >= 1 && this.stunnedUntil !== swingStart);
    let kind = T.attack;
    if (kind === 'boss') kind = dist < T.range ? 'slam' : (this.bossMove++ % 2 ? 'fan' : 'slam');

    if (kind === 'melee') {
      this.play('attack', true);
      this.scene.time.delayedCall(T.windupMs, () => {
        if (cancelled()) return;
        const inFront = this.flipX ? player.x <= this.x + 4 : player.x >= this.x - 4;
        const close = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) < T.reach;
        if (inFront && close && this.sameHeightAs(player)) this.scene.hurtPlayer(this.x, this.y, T.damage);
      });
    } else if (kind === 'spit' || kind === 'fan') {
      this.play('shot', true);
      this.scene.time.delayedCall(T.windupMs, () => {
        if (cancelled()) return;
        const base = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
        const spread = kind === 'fan' ? [-0.5, -0.25, 0, 0.25, 0.5] : [0];
        spread.forEach(da => this.scene.spawnSpit(this, base + da, T.spitSpeed, T.damage > 1 ? 1 : T.damage));
      });
    } else {                                   // slam: wind up (flashing), then a shockwave
      this.play('windup', true);
      const flash = this.scene.time.addEvent({ delay: 90, repeat: Math.floor(T.windupMs / 90), callback: () => {
        if (this.dead) return;
        if (this.isTinted) this.clearTint(); else this.setTintFill(0xffffff);
      } });
      this.scene.time.delayedCall(T.windupMs, () => {
        flash.remove(); if (!this.dead) this.clearTint();
        if (this.dead) return;
        this.play('cast', true);
        this.scene.shockwave(this, T.slamRadius, T.damage);
      });
    }
  }

  // Returns true if this hit killed the enemy.
  takeHit(fromX, fromY, time, damage, knock) {
    if (this.dead) return false;
    this.health -= damage;
    if (this.health <= 0) { this.die(); return true; }
    const heavyBusy = this.type.knockTaken < 1 && time < this.attackUntil;   // brutes shrug off hits mid-slam
    if (!heavyBusy) {
      this.attackUntil = 0;
      this.stunnedUntil = time + this.type.stunMs;
      this.play('hurt', true);
    }
    this.push(fromX, fromY, knock * this.type.knockTaken, this.type.stunMs, time);
    return false;
  }

  die() {
    this.dead = true;
    this.clearTint();
    this.play('dead', true);
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
      const w = type.startsWith('tree') ? img.width * 0.75 : img.width * 0.9;
      this.add.ellipse(x, y - 1, w, type.startsWith('tree') ? 6 : 4, 0x000000, SHADOW_ALPHA).setDepth(-1);
    }

    const s = tileBase(...L.start);
    this.player = new Player(this, s.x, s.y);
    this.enemies = L.zombies.map(([tx, ty, lv], i) => {
      const p = tileBase(tx, ty);
      return new Enemy(this, p.x, p.y, lv, typeForSpawn(i));
    });
    this.totalDrops = this.enemies.length;     // one brain per enemy
    this.brains = L.brains.map(([tx, ty, lv]) => this.makeBrain(tx, ty, lv));
    this.brainsCollected = 0;
    this.drops = [];
    this.dropsCollected = 0;
    this.spits = [];
    this.boss = null;
    this.bossDone = false;
    this.mainDone = false;

    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setRoundPixels(true);

    this.pointer = this.add.graphics().setDepth(HUD_DEPTH - 1);
    this.debug = this.add.graphics().setDepth(HUD_DEPTH - 2);
    this.showDebug = false;
    this.paused = false;
    this.freezeUntil = 0;
    this.createHud();
    this.gameOver = false;
    this.input.keyboard.on('keydown-BACKTICK', () => { this.showDebug = !this.showDebug; this.debug.clear(); });
  }

  update(time, delta) {
    if (this.paused) return;
    if (time < this.freezeUntil) return;          // hit-stop: a tiny freeze on big hits
    const dt = Math.min(delta, 50) / 1000;        // seconds; capped so a hiccup can't tunnel through walls
    this.player.update(time, dt);
    this.enemies.forEach(e => e.update(time, dt, this.player));
    this.updateSpits(dt);
    this.player.syncDepth();
    this.enemies.forEach(e => e.syncDepth());
    this.checkPickups();
    this.drawPointer();
    this.levelLabel.setText(this.player.onStairs ? 'STAIRS' : HEIGHT_NAMES[this.player.level]);
    this.updateBossBar();
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

  // ---- Pickups: the 10 level brains and the brains enemies drop ---------

  makeBrain(tx, ty, level) {
    const x = tx * TILE_SIZE + TILE_SIZE / 2, y = ty * TILE_SIZE + TILE_SIZE - 3;
    return this.makePickup(x, y, level, 'brain', 6);
  }

  makePickup(x, y, level, texture, hover) {
    const shadow = this.add.ellipse(x, y, texture === 'brain' ? 14 : 10, 4, 0x000000, SHADOW_ALPHA).setDepth(depthFor(level, y) - 1);
    const img = this.add.image(x, y - hover, texture).setOrigin(0.5, 1).setDepth(depthFor(level, y));
    const bob = this.tweens.add({ targets: img, y: y - hover - 4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    return { x, y, level, img, shadow, bob, taken: false };
  }

  spawnDrop(enemy) {
    const d = this.makePickup(enemy.x, enemy.y, enemy.level, 'brain_drop', 3);
    d.bob.pause();
    // Pop out of the body in a little arc, then start bobbing.
    d.img.y = enemy.y - 18; d.img.setScale(0.4);
    this.tweens.add({ targets: d.img, y: enemy.y - 3, scale: 1, duration: 380, ease: 'Bounce.out', onComplete: () => d.bob.resume() });
    this.drops.push(d);
  }

  checkPickups() {
    const p = this.player;
    if (p.isDead || this.gameOver) return;
    const reachable = b => p.level === b.level || p.onStairs;

    for (const b of this.brains) {
      if (b.taken || !reachable(b) || Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) > 13) continue;
      this.collect(b);
      this.brainsCollected++;
      p.health = Math.min(PLAYER.maxHealth, p.health + 1);       // a level brain heals one heart
      this.updateHearts();
      this.updateCounters();
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
      this.updateCounters();
      if (this.dropsCollected >= this.totalDrops && !this.boss && !this.bossDone) this.spawnBoss();
    }
  }

  collect(b) {
    b.taken = true;
    b.bob.stop();
    b.shadow.destroy();
    this.tweens.add({ targets: b.img, y: b.img.y - 16, alpha: 0, scale: 1.6, duration: 350, onComplete: () => b.img.destroy() });
  }

  // ---- Extra objective: the Brain King ------------------------------------

  spawnBoss() {
    const s = this.openGroundNear(LEVEL.start[0], LEVEL.start[1] - 4);
    this.boss = new Enemy(this, s.x, s.y, 0, 'boss');
    this.enemies.push(this.boss);
    this.cameras.main.shake(400, 0.006);
    this.toast('The Brain King has risen in the plaza!');
    this.updateCounters();
  }

  // The nearest street-level tile with open ground around it (searches outward in rings).
  openGroundNear(tx, ty) {
    const open = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, -1]].every(([dx, dy]) => HEIGHT[this.kindAt(x + dx, y + dy)] === 0
      && !'TR'.includes(this.kindAt(x + dx, y + dy)));
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && open(tx + dx, ty + dy)) return tileBase(tx + dx, ty + dy);
      }
    }
    return tileBase(...LEVEL.start);
  }

  updateBossBar() {
    const show = this.boss && !this.boss.dead;
    this.bossBar.setVisible(!!show); this.bossLabel.setVisible(!!show);
    if (!show) return;
    const f = Math.max(0, this.boss.health) / ENEMY_TYPES.boss.health;
    this.bossBar.clear()
      .fillStyle(0x1a1d1c, 0.85).fillRect(80, 166, 160, 7)
      .fillStyle(UI.gold, 1).fillRect(81, 167, 158 * f, 5);
  }

  // ---- Combat -------------------------------------------------------------

  onPlayerAttack(hit) {
    let landed = false;
    for (const e of [...this.enemies]) {
      if (e.dead || !e.sameHeightAs(this.player)) continue;
      const box = e.hurtBox;
      const touched = hit.radius
        ? Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(this.player.x, this.player.y - 6, hit.radius), box)
        : Phaser.Geom.Intersects.RectangleToRectangle(hit.rect, box);
      if (!touched) continue;
      landed = true;
      this.spark(e.x, e.y - 10 * e.type.scale);
      if (e.takeHit(this.player.x, this.player.y, this.time.now, hit.damage, hit.knock)) this.onEnemyKilled(e);
    }
    if (landed) {
      this.cameras.main.shake(hit.finisher ? 120 : 60, hit.finisher ? 0.005 : 0.002);
      if (hit.finisher) this.freezeUntil = this.time.now + 70;
    }
  }

  onEnemyKilled(e) {
    Phaser.Utils.Array.Remove(this.enemies, e);
    if (e === this.boss) {
      this.bossDone = true;
      this.cameras.main.shake(500, 0.008);
      this.time.delayedCall(900, () => this.showPanel('Brain King defeated!', 'You are the legend of the zombie block.', '', false));
    } else {
      this.spawnDrop(e);
    }
    this.updateCounters();
  }

  hurtPlayer(fromX, fromY, damage) {
    if (this.gameOver || !this.player.takeHit(fromX, fromY, this.time.now, damage)) return;
    this.cameras.main.shake(120, 0.005);
    this.updateHearts();
    if (this.player.isDead) {
      this.showPanel('You were bitten', `Brains: ${this.brainsCollected}/${BRAINS_TO_WIN} · drops: ${this.dropsCollected}/${this.totalDrops}`, '', false);
    }
  }

  // Spitter projectiles fly in a straight line at the shooter's height.
  spawnSpit(enemy, angle, speed, damage) {
    const x = enemy.x + Math.cos(angle) * 8, y = enemy.y + Math.sin(angle) * 8;
    const img = this.add.image(x, y - 9, 'spit').setDepth(depthFor(enemy.level, y));
    const shadow = this.add.ellipse(x, y, 5, 2, 0x000000, SHADOW_ALPHA).setDepth(depthFor(enemy.level, y) - 1);
    this.spits.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, level: enemy.level, damage, img, shadow, life: 2.2 });
  }

  updateSpits(dt) {
    const p = this.player;
    for (const s of this.spits) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      const k = this.kindAtPixel(s.x, s.y);
      const blocked = SOLID.includes(k) || (HEIGHT[k] ?? 0) > s.level;     // walls and higher roofs stop it
      const hit = !p.isDead && Math.abs(p.x - s.x) < 6 && Math.abs(p.y - s.y) < 6 && (p.level === s.level || p.onStairs);
      if (hit) this.hurtPlayer(s.x - s.vx, s.y - s.vy, s.damage);
      if (hit || blocked || s.life <= 0) {
        s.dead = true; s.img.destroy(); s.shadow.destroy();
        this.splat(s.x, s.y - 6, s.level);
        continue;
      }
      s.img.setPosition(s.x, s.y - 9).setDepth(depthFor(s.level, s.y)).rotation += dt * 10;
      s.shadow.setPosition(s.x, s.y).setDepth(depthFor(s.level, s.y) - 1);
    }
    this.spits = this.spits.filter(s => !s.dead);
  }

  // A ring that expands from a slam; it hurts if you're inside when it lands.
  shockwave(enemy, radius, damage) {
    const g = this.add.graphics().setDepth(depthFor(enemy.level, enemy.y) - 2);
    const ring = { r: 4 };
    this.tweens.add({
      targets: ring, r: radius, duration: 260, ease: 'Cubic.out',
      onUpdate: () => g.clear().lineStyle(3, 0xffe2b0, 1 - ring.r / radius * 0.6).strokeEllipse(enemy.x, enemy.y - 2, ring.r * 2, ring.r * 1.2),
      onComplete: () => g.destroy(),
    });
    this.cameras.main.shake(140, 0.004);
    const p = this.player;
    const dx = p.x - enemy.x, dy = (p.y - enemy.y) / 0.6;     // the ring is squashed: ground perspective
    if (Math.hypot(dx, dy) < radius && enemy.sameHeightAs(p)) this.hurtPlayer(enemy.x, enemy.y, damage);
  }

  // The finisher's slash: a white ring around the hero.
  spinSlash(player, hit) {
    const g = this.add.graphics().setDepth(depthFor(player.level, player.y) + 1);
    const t = { a: 0 };
    this.tweens.add({
      targets: t, a: 1, duration: 220,
      onUpdate: () => {
        g.clear().lineStyle(3, 0xffffff, 1 - t.a).strokeEllipse(player.x, player.y - 6, hit.radius * 2 * (0.6 + t.a * 0.4), hit.radius * 1.3 * (0.6 + t.a * 0.4));
        g.lineStyle(1, 0xffce48, 1 - t.a).strokeEllipse(player.x, player.y - 6, hit.radius * 2.2 * t.a, hit.radius * 1.4 * t.a);
      },
      onComplete: () => g.destroy(),
    });
  }

  spark(x, y) {
    const g = this.add.graphics().setDepth(HUD_DEPTH - 5);
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; g.fillRect(x + Math.cos(a) * 5 - 1, y + Math.sin(a) * 5 - 1, 2, 2); }
    g.fillRect(x - 2, y - 2, 4, 4);
    this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
  }

  splat(x, y, level) {
    for (let i = 0; i < 5; i++) {
      const b = this.add.rectangle(x, y, 2, 2, 0xc6ec46).setDepth(depthFor(level, y + 6));
      this.tweens.add({ targets: b, x: x + Phaser.Math.Between(-7, 7), y: y + Phaser.Math.Between(-6, 3), alpha: 0, duration: 260, onComplete: () => b.destroy() });
    }
  }

  // A small arrow around the hero pointing at the next thing to go for.
  drawPointer() {
    const g = this.pointer.clear();
    const p = this.player;
    if (this.gameOver) return;
    let best = null, bd = Infinity, color = UI.brain;
    const consider = (list, c) => {
      for (const b of list) {
        if (b.taken || b.dead) continue;
        const d = Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y);
        if (d < bd) { bd = d; best = b; color = c; }
      }
    };
    consider(this.brains, UI.brain);
    if (!best) consider(this.drops, UI.brain);
    if (!best && this.boss && !this.boss.dead) consider([this.boss], UI.gold);
    if (!best || bd < 48) return;
    const a = Phaser.Math.Angle.Between(p.x, p.y - 10, best.x, best.y);
    const cx = p.x + Math.cos(a) * 20, cy = p.y - 10 + Math.sin(a) * 20;
    const pt = (r, da) => ({ x: cx + Math.cos(a + da) * r, y: cy + Math.sin(a + da) * r });
    const tip = pt(5, 0), l = pt(4, 2.5), r = pt(4, -2.5);
    g.fillStyle(0x1a0e14, 0.9).fillTriangle(tip.x + 1, tip.y + 1, l.x + 1, l.y + 1, r.x + 1, r.y + 1);
    g.fillStyle(color, 1).fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  // ---- HUD ----------------------------------------------------------------
  // setScrollFactor(0) pins things to the screen instead of the world.

  createHud() {
    const hud = o => o.setScrollFactor(0).setDepth(HUD_DEPTH);
    this.hudStyle = { fontFamily: UI.font, fontSize: '11px', color: '#f1e8dc', stroke: '#1a1d1c', strokeThickness: 3 };
    this.hearts = [];
    for (let i = 0; i < PLAYER.maxHealth; i++) this.hearts.push(hud(this.add.image(6 + i * 15, 6, 'heart').setOrigin(0)));
    this.updateHearts();
    this.levelLabel = hud(this.add.text(6, 20, '', { ...this.hudStyle, fontSize: '9px', color: '#c9d2cc' }).setResolution(4));

    // right column: level brains, dropped brains, enemies left
    hud(this.add.image(292, 3, 'brain').setOrigin(1, 0));
    this.brainText = hud(this.add.text(316, 4, '', this.hudStyle).setOrigin(1, 0).setResolution(4));
    hud(this.add.image(290, 23, 'brain_drop').setOrigin(1, 0));
    this.dropText = hud(this.add.text(316, 21, '', { ...this.hudStyle, fontSize: '9px' }).setOrigin(1, 0).setResolution(4));
    hud(this.add.image(289, 37, 'skull').setOrigin(1, 0).setTint(0xd9d0c4));
    this.enemyText = hud(this.add.text(316, 35, '', { ...this.hudStyle, fontSize: '9px' }).setOrigin(1, 0).setResolution(4));

    this.bossBar = hud(this.add.graphics());
    this.bossLabel = hud(this.add.text(160, 157, 'BRAIN KING', { ...this.hudStyle, fontSize: '9px', color: '#ffce48' }).setOrigin(0.5).setResolution(4));
    this.updateCounters();
  }

  updateHearts() {
    this.hearts.forEach((h, i) => h.setTint(i < this.player.health ? UI.heartFull : UI.heartEmpty));
  }
  updateCounters() {
    this.brainText.setText(`${this.brainsCollected}/${BRAINS_TO_WIN}`);
    this.dropText.setText(`${this.dropsCollected}/${this.totalDrops}`);
    this.enemyText.setText(`${this.enemies.filter(e => !e.dead).length}`);
  }

  popText(x, y, str, color) {
    const t = this.add.text(x, y, str, { ...this.hudStyle, fontSize: '10px', color }).setOrigin(0.5).setResolution(4).setDepth(HUD_DEPTH - 3);
    this.tweens.add({ targets: t, y: y - 10, alpha: 0, duration: 520, onComplete: () => t.destroy() });
  }

  toast(str) {
    const t = this.add.text(160, 52, str, { ...this.hudStyle, fontSize: '10px', color: '#ffce48' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH).setResolution(4);
    this.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 600, onComplete: () => t.destroy() });
  }

  // A cream panel. With canContinue, Enter closes it and play resumes; R always restarts.
  showPanel(title, line, extra, canContinue) {
    if (!canContinue) this.gameOver = true;
    this.paused = true;
    const parts = [];
    const top = o => { parts.push(o); return o.setScrollFactor(0).setDepth(HUD_DEPTH + 1); };
    top(this.add.rectangle(160, 90, 320, 180, 0x14121a, 0.55));
    const h = extra ? 92 : 72;
    // nineslice stretches the panel's middle but keeps its 6px corners crisp.
    top(this.add.nineslice(160, 90, 'panel', undefined, 216, h, 6, 6, 6, 6));
    const text = (y, str, size, color = UI.ink) => top(this.add.text(160, y, str, {
      fontFamily: UI.font, fontSize: size, color, align: 'center', wordWrap: { width: 196 },
    }).setOrigin(0.5).setResolution(4));
    let y = 90 - h / 2 + 16;
    text(y, title, '16px'); y += 20;
    text(y, line, '9px'); y += 14;
    if (extra) { text(y + 4, extra, '9px', '#7a3150'); y += 24; }
    text(y, canContinue ? 'Enter: keep playing   ·   R: restart' : 'Press R to play again', '9px');
    this.input.keyboard.once('keydown-R', () => this.scene.restart());
    if (canContinue) {
      this.input.keyboard.once('keydown-ENTER', () => { parts.forEach(o => o.destroy()); this.paused = false; });
    }
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
    for (const w of [p, ...this.enemies]) {
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
    backgroundColor: '#2a2935',
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
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) e.preventDefault();
});
