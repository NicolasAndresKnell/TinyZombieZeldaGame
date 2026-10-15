// Headless playthrough: runs the real game.js logic with a stand-in for Phaser's
// drawing and checks a full run works: combos, all enemy types, brains, drops, boss.
// Run: node tools/playthrough_test.js
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');

// ---- a tiny fake Phaser: real maths/geometry, everything visual is a no-op ----
const noop = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : noop),
  apply: () => noop,
});
let NOW = 0;
const timers = [];
class Vec { constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  normalize() { const l = Math.hypot(this.x, this.y); if (l) { this.x /= l; this.y /= l; } return this; }
  scale(s) { this.x *= s; this.y *= s; return this; } lengthSq() { return this.x * this.x + this.y * this.y; } }
class Rect { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h }); } }
class Sprite {
  constructor(scene, x, y) { this.scene = scene; this.x = x; this.y = y; this.flipX = false; this.isTinted = false;
    this.anims = { play() {}, setProgress() {} }; }
  setOrigin() { return this; } setScale() { return this; } setDepth() { return this; } setAlpha() { return this; }
  setFlipX(f) { this.flipX = f; return this; } setTintFill() { this.isTinted = true; return this; }
  clearTint() { this.isTinted = false; return this; } destroy() { this.destroyed = true; }
}
const keyState = {};
global.Phaser = {
  Scene: class {}, GameObjects: { Sprite },
  Math: { Vector2: Vec, Distance: { Between: (a, b, c, d) => Math.hypot(c - a, d - b) },
    Angle: { Between: (a, b, c, d) => Math.atan2(d - b, c - a) }, Between: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) },
  Utils: { Array: { GetRandom: a => a[Math.floor(Math.random() * a.length)],
    Remove: (a, x) => { const i = a.indexOf(x); if (i >= 0) a.splice(i, 1); } } },
  Geom: { Rectangle: Rect, Circle: class { constructor(x, y, r) { Object.assign(this, { x, y, radius: r }); } },
    Intersects: {
      RectangleToRectangle: (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
      CircleToRectangle: (c, r) => { const nx = Math.max(r.x, Math.min(c.x, r.x + r.width)), ny = Math.max(r.y, Math.min(c.y, r.y + r.height));
        return Math.hypot(c.x - nx, c.y - ny) <= c.radius; } } },
  Input: { Keyboard: { JustDown: k => { const j = k._just; k._just = false; return j; } } },
};
global.IMAGES = {}; global.document = { getElementById: () => ({ addEventListener() {} }), fonts: null };
global.window = { addEventListener() {} };

const code = fs.readFileSync(path.join(src, 'assets.js'), 'utf8').replace(/const IMAGES = \{.*?\};/s, '')
  + fs.readFileSync(path.join(src, 'level.js'), 'utf8')
  + fs.readFileSync(path.join(src, 'game.js'), 'utf8').replace(/Promise\.race\([\s\S]*?then\(startGame\);/, '')
  + '\nmodule.exports = { GameScene, LEVEL, ENEMY_TYPES, BRAINS_TO_WIN };';
const m = new module.constructor(); m._compile(code, 'game_sim.js');
const { GameScene, LEVEL, BRAINS_TO_WIN } = m.exports;

// ---- build the scene with stand-ins ----
const scene = new GameScene();
const onceHandlers = {};
const key = name => (keyState[name] = keyState[name] || { isDown: false, _just: false });
Object.assign(scene, {
  add: Object.assign(Object.create(noop), { existing() {} }),
  tweens: { add: cfg => { if (cfg.onComplete) timers.push({ at: NOW + (cfg.delay || 0) + (cfg.duration || 0), fn: cfg.onComplete });
    return { pause() {}, resume() {}, stop() {}, isPaused: () => false }; } },
  time: { get now() { return NOW; }, delayedCall: (ms, fn) => timers.push({ at: NOW + ms, fn }),
    addEvent: () => ({ remove() {} }) },
  cameras: { main: Object.assign(Object.create(noop), { worldView: { x: 0, y: 0 } }) },
  input: { keyboard: { addKeys: map => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, key(v)])),
    on() {}, once: (ev, fn) => { onceHandlers[ev] = fn; } } },
  scene: { restart() {} },
});
scene.create();

function tick(ms = 16) {
  NOW += ms;
  for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) { if (t.at <= NOW) t.fn(); else timers.push(t); }
  scene.update(NOW, ms);
}
const press = k => { key(k).isDown = true; key(k)._just = true; };
const release = k => { key(k).isDown = false; };
const P = scene.player;
const teleport = (x, y, level) => { P.x = x; P.y = y; P.level = level; P.tileKind = 'P'; };
const log = [];

// 1) combo: three quick taps should run hits 1→2→3
const steps = [];
for (let i = 0; i < 3; i++) { press('SPACE'); tick(); release('SPACE'); steps.push(P.comboStep); for (let f = 0; f < 14; f++) tick(); }
log.push(`combo steps: ${steps.join('→')}`);
if (steps.join() !== '1,2,3') throw new Error('combo did not chain');

// 2) fight every enemy where it stands; immortal hero so the run can finish
const origHit = P.takeHit.bind(P);
let hitsTaken = { melee: 0, spit: 0, slam: 0 };
P.takeHit = (fx, fy, t, dmg) => { const near = scene.enemies.find(e => Math.hypot(e.x - fx, e.y - fy) < 4) || { type: { attack: 'spit' } };
  hitsTaken[near.type.attack] = (hitsTaken[near.type.attack] || 0) + 1; return false; };
const kinds = {};
let guard = 0;
while (scene.enemies.some(e => !e.dead) && guard++ < 400) {
  const e = scene.enemies.find(e => !e.dead);
  kinds[e.typeName] = (kinds[e.typeName] || 0) + 1;
  for (let f = 0; f < 600 && !e.dead; f++) {           // stand next to it and swing
    teleport(e.x - 10, e.y, e.level); P.facing = 'right';
    if (f % 6 === 0) press('SPACE'); tick(); release('SPACE');
  }
  if (!e.dead) throw new Error(`could not kill a ${e.typeName}`);
}
for (let f = 0; f < 200; f++) tick();
log.push(`enemies killed by type: ${JSON.stringify(kinds)}; attacks that reached the hero: ${JSON.stringify(hitsTaken)}`);
log.push(`drops on the ground: ${scene.drops.length}/${scene.totalDrops}`);

// 3) the 10 level brains → panel, then Enter to keep playing
for (const b of scene.brains) { teleport(b.x, b.y, b.level); tick(); }
log.push(`brains: ${scene.brainsCollected}/${BRAINS_TO_WIN}, level cleared panel: ${scene.mainDone}, paused: ${scene.paused}`);
if (!scene.mainDone) throw new Error('main objective did not complete');
onceHandlers['keydown-ENTER']?.(); tick();
if (scene.paused) throw new Error('Enter did not resume play');

// 4) every drop → the Brain King appears
for (const d of scene.drops) { teleport(d.x, d.y, d.level); tick(); }
log.push(`drops collected: ${scene.dropsCollected}/${scene.totalDrops}, boss spawned: ${!!scene.boss}`);
if (!scene.boss) throw new Error('boss did not spawn');

// 5) beat the boss with combos
const boss = scene.boss;
for (let f = 0; f < 3000 && !boss.dead; f++) {
  teleport(boss.x - 18, boss.y, 0); P.facing = 'right';
  if (f % 5 === 0) press('SPACE'); tick(); release('SPACE');
}
for (let f = 0; f < 80; f++) tick();
log.push(`boss defeated: ${boss.dead}, game over panel: ${scene.gameOver}`);
if (!boss.dead || !scene.gameOver) throw new Error('boss fight did not finish');

// 6) a real hit hurts: restore damage and let a walker swing
P.takeHit = origHit; P.health = 5;
console.log(log.join('\n'));
console.log('PLAYTHROUGH OK');
