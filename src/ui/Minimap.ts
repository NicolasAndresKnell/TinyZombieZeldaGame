// =====================================================================
// MINIMAP — bottom-right corner, all in greens. The map is drawn once into
// a small texture (1 pixel = 3x3 tiles, buildings outlined); the hero (dot)
// and enemies (triangles) are redrawn a few times a second on top.
// =====================================================================
import Phaser from 'phaser';
import { HUD_DEPTH, MINIMAP, TILE_SIZE, VIEWPORT } from '../config';
import type { GameScene } from '../scenes/GameScene';

const SCALE = MINIMAP.tilesPerPixel;
const C = MINIMAP.colors;

export class Minimap {
  private dots: Phaser.GameObjects.Graphics;
  private nextDrawAt = 0;
  private readonly x: number;
  private readonly y: number;

  constructor(private scene: GameScene) {
    const world = scene.world;
    const w = Math.ceil(world.width / SCALE), h = Math.ceil(world.height / SCALE);
    this.x = VIEWPORT.width - w - 5; this.y = VIEWPORT.height - h - 5;

    // Build the map picture once; restarting the scene reuses it.
    if (!scene.textures.exists('minimap')) {
      const tex = scene.textures.createCanvas('minimap', w, h)!;
      const ctx = tex.getContext();
      const kind = (mx: number, my: number) => {
        // what most of this 3x3 block of tiles is, buildings first
        const counts: Record<string, number> = {};
        for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
          const k = world.kindAt(mx * SCALE + dx, my * SCALE + dy);
          const c = 'B123'.includes(k) ? 'building' : k === 'W' ? 'water' : 'SRM'.includes(k) ? 'street' : 'ground';
          counts[c] = (counts[c] ?? 0) + 1;
        }
        if ((counts.building ?? 0) >= 4) return 'building';
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      };
      const grid: string[][] = [];
      for (let my = 0; my < h; my++) { grid.push([]); for (let mx = 0; mx < w; mx++) grid[my].push(kind(mx, my)); }
      for (let my = 0; my < h; my++) for (let mx = 0; mx < w; mx++) {
        const k = grid[my][mx];
        let col: string = C[k as keyof typeof C];
        if (k === 'building') {
          // the outline: building pixels next to anything that isn't building
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[my + dy]?.[mx + dx] !== 'building');
          if (edge) col = C.outline;
        }
        ctx.fillStyle = col;
        ctx.fillRect(mx, my, 1, 1);
      }
      tex.refresh();
    }
    const pin = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T) =>
      o.setScrollFactor(0).setDepth(HUD_DEPTH);
    pin(scene.add.rectangle(this.x - 2, this.y - 2, w + 4, h + 4, Phaser.Display.Color.HexStringToColor(C.frame).color).setOrigin(0));
    pin(scene.add.image(this.x, this.y, 'minimap').setOrigin(0));
    this.dots = pin(scene.add.graphics());
  }

  update(time: number) {
    if (time < this.nextDrawAt) return;
    this.nextDrawAt = time + MINIMAP.refreshMs;
    const g = this.dots.clear();
    const toMap = (px: number, py: number) => ({
      x: this.x + px / TILE_SIZE / SCALE, y: this.y + py / TILE_SIZE / SCALE,
    });
    g.fillStyle(MINIMAP.enemy, 1);
    for (const e of this.scene.enemies) {
      if (e.dead) continue;
      const p = toMap(e.x, e.y);
      const s = e.stats.scale > 1.5 ? 2.5 : 1.5;   // the boss gets a bigger triangle
      g.fillTriangle(p.x, p.y - s, p.x - s, p.y + s, p.x + s, p.y + s);
    }
    const hero = toMap(this.scene.player.x, this.scene.player.y);
    g.fillStyle(MINIMAP.heroRing, 1).fillCircle(hero.x, hero.y, 2.5);
    g.fillStyle(MINIMAP.hero, 1).fillCircle(hero.x, hero.y, 1.5);
  }
}
