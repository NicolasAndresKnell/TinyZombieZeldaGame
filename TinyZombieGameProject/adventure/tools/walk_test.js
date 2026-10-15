// Runs game.js's real movement code (no browser) and walks the hero to every brain.
const fs = require('fs');
const root = require('path').join(__dirname, '..', 'src') + '/';
global.IMAGES = {};
global.Phaser = { Scene: class {}, GameObjects: { Sprite: class {} } };
global.document = { getElementById: () => ({ addEventListener() {} }), fonts: null };
global.window = { addEventListener() {} };
global.setTimeout = () => 0;
const code = fs.readFileSync(root + 'level.js', 'utf8') + fs.readFileSync(root + 'game.js', 'utf8')
  .replace(/Promise\.race\([\s\S]*?then\(startGame\);/, '')
  + '\nmodule.exports = { LEVEL, GameScene, canEnter, HEIGHT, TILE_SIZE };';
const m = new module.constructor(); m._compile(code, 'game_sim.js');
const { LEVEL, GameScene, canEnter, HEIGHT, TILE_SIZE } = m.exports;

const scene = Object.create(GameScene.prototype);
scene.mapW = LEVEL.w; scene.mapH = LEVEL.h;
const W = LEVEL.w, kind = (x, y) => scene.kindAt(x, y);

function bfs(sx, sy, gx, gy, glv) {
  const key = (x, y, l) => (y * W + x) * 4 + l;
  const prev = new Map([[key(sx, sy, 0), null]]);
  const q = [[sx, sy, 0]];
  while (q.length) {
    const [x, y, l] = q.shift();
    if (x === gx && y === gy && l === glv) {
      const path = []; let k = key(x, y, l), c = [x, y, l];
      while (c) { path.push(c); c = prev.get(key(...c)); }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, to = kind(nx, ny), from = kind(x, y);
      if (!canEnter(from, to, l)) continue;
      const nl = (to === 'T' || to === 'R') ? l : HEIGHT[to];
      const k = key(nx, ny, nl);
      if (prev.has(k)) continue;
      prev.set(k, [x, y, l]); q.push([nx, ny, nl]);
    }
  }
  return null;
}

let ok = 0;
for (const [bx, by, blv] of LEVEL.brains) {
  const w = { x: LEVEL.start[0] * 16 + 8, y: LEVEL.start[1] * 16 + 16 - 3, level: 0, tileKind: 'P' };
  const path = bfs(LEVEL.start[0], LEVEL.start[1], bx, by, blv);
  if (!path) { console.log('NO PATH to brain', bx, by, blv); continue; }
  let stuck = false;
  for (const [tx, ty] of path.slice(1)) {
    const gx = tx * 16 + 8, gy = ty * 16 + 11;     // aim for the tile's middle (feet box inside it)
    let steps = 0;
    while ((Math.abs(w.x - gx) > 0.6 || Math.abs(w.y - gy) > 0.6) && steps++ < 400) {
      const dx = Math.max(-1.3, Math.min(1.3, gx - w.x)), dy = Math.max(-1.3, Math.min(1.3, gy - w.y));
      scene.moveWalker(w, dx, dy, true);
    }
    if (steps >= 400) { stuck = [tx, ty, kind(tx, ty), 'at', Math.round(w.x), Math.round(w.y), 'lv', w.level]; break; }
  }
  const got = !stuck && Math.hypot(w.x - (bx * 16 + 8), w.y - (by * 16 + 13)) < 12 && w.level === blv;
  console.log(`brain ${bx},${by} height ${blv}: path ${path.length} tiles →`, got ? 'COLLECTED' : 'FAILED', stuck || '');
  if (got) ok++;
}
console.log(`${ok}/${LEVEL.brains.length} brains reachable with the real movement code`);
