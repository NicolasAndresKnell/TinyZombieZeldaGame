// =====================================================================
// GHOSTS — sends our hero a few times a second and draws everyone else's
// as tinted heroes that ease toward their last known spot.
// =====================================================================
import Phaser from 'phaser';
import { NET } from '../config';
import { Walker } from '../entities/Walker';
import type { GameScene } from '../scenes/GameScene';
import type { HeroState } from '../types';
import { HEIGHT_NAMES } from '../world/terrain';
import { getConnection } from './multiplayer';

export class Ghosts {
  private ghosts = new Map<string, Walker>();
  private nextSendAt = 0;
  private heartbeatAt = 0;
  private lastSent = '';

  constructor(private scene: GameScene) {}

  update(time: number, dt: number) {
    const net = getConnection();
    if (!net) return;
    const p = this.scene.player;
    if (time >= this.nextSendAt) {
      this.nextSendAt = time + NET.sendMs;
      const hero: HeroState = { x: Math.round(p.x), y: Math.round(p.y), lv: p.level, f: p.facing, a: p.anims.currentAnim?.key ?? '', d: p.isDead };
      const key = JSON.stringify(hero);
      // Resend now and then even when standing still, so others know we're here.
      if (key !== this.lastSent || time >= this.heartbeatAt) {
        this.lastSent = key; this.heartbeatAt = time + NET.heartbeatMs; net.send(hero);
      }
    }
    const seen = new Set<string>();
    for (const { id, hero: h } of net.peers) {
      if (!Number.isFinite(h?.x) || !Number.isFinite(h?.y)) continue;
      seen.add(id);
      let g = this.ghosts.get(id);
      if (!g) {
        g = new Walker(this.scene, h.x, h.y, 'hero', 0).setTint(NET.tints[this.ghosts.size % NET.tints.length]);
        this.ghosts.set(id, g);
      }
      const t = Math.min(1, NET.smoothing * dt);
      g.x += (h.x - g.x) * t; g.y += (h.y - g.y) * t;
      g.level = Phaser.Math.Clamp(h.lv | 0, 0, HEIGHT_NAMES.length - 1);
      g.setFlipX(h.f === 'left').setAlpha(h.d ? 0.4 : 1);
      if (typeof h.a === 'string' && h.a.startsWith('hero_') && this.scene.anims.exists(h.a)) g.anims.play(h.a, true);
      g.syncDepth();
    }
    for (const [id, g] of this.ghosts) if (!seen.has(id)) { g.destroy(); this.ghosts.delete(id); }
  }
}
