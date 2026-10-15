// =====================================================================
// EFFECTS — short-lived visuals. None of these change game state.
// =====================================================================
import Phaser from 'phaser';
import { depthFor, HUD_DEPTH } from './config';
import type { Walker } from './entities/Walker';

// A ring that expands from a slam.
export function shockwave(scene: Phaser.Scene, from: Walker, radius: number) {
  const g = scene.add.graphics().setDepth(depthFor(from.level, from.y) - 2);
  const ring = { r: 4 };
  scene.tweens.add({
    targets: ring, r: radius, duration: 260, ease: 'Cubic.out',
    onUpdate: () => g.clear().lineStyle(3, 0xffe2b0, 1 - ring.r / radius * 0.6).strokeEllipse(from.x, from.y - 2, ring.r * 2, ring.r * 1.2),
    onComplete: () => g.destroy(),
  });
  scene.cameras.main.shake(140, 0.004);
}

// The finisher's slash: a white ring around the hero.
export function spinSlash(scene: Phaser.Scene, player: Walker, radius: number) {
  const g = scene.add.graphics().setDepth(depthFor(player.level, player.y) + 1);
  const t = { a: 0 };
  scene.tweens.add({
    targets: t, a: 1, duration: 220,
    onUpdate: () => {
      g.clear().lineStyle(3, 0xffffff, 1 - t.a).strokeEllipse(player.x, player.y - 6, radius * 2 * (0.6 + t.a * 0.4), radius * 1.3 * (0.6 + t.a * 0.4));
      g.lineStyle(1, 0xffce48, 1 - t.a).strokeEllipse(player.x, player.y - 6, radius * 2.2 * t.a, radius * 1.4 * t.a);
    },
    onComplete: () => g.destroy(),
  });
}

export function spark(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(HUD_DEPTH - 5);
  g.fillStyle(0xffffff, 1);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; g.fillRect(x + Math.cos(a) * 5 - 1, y + Math.sin(a) * 5 - 1, 2, 2); }
  g.fillRect(x - 2, y - 2, 4, 4);
  scene.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
}

export function splat(scene: Phaser.Scene, x: number, y: number, level: number) {
  for (let i = 0; i < 5; i++) {
    const b = scene.add.rectangle(x, y, 2, 2, 0xc6ec46).setDepth(depthFor(level, y + 6));
    scene.tweens.add({ targets: b, x: x + Phaser.Math.Between(-7, 7), y: y + Phaser.Math.Between(-6, 3), alpha: 0, duration: 260, onComplete: () => b.destroy() });
  }
}
