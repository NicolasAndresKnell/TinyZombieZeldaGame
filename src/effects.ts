import Phaser from 'phaser';
import { depthForHeight, HUD_DEPTH } from './config';
import type { Walker } from './entities/Walker';

export function shockwave(scene: Phaser.Scene, from: Walker, radius: number) {
  const graphics = scene.add.graphics().setDepth(depthForHeight(from.level, from.y) - 2);
  const ring = { radius: 4 };
  scene.tweens.add({
    targets: ring, radius, duration: 260, ease: 'Cubic.out',
    onUpdate: () => graphics.clear().lineStyle(3, 0xffe2b0, 1 - ring.radius / radius * 0.6).strokeEllipse(from.x, from.y - 2, ring.radius * 2, ring.radius * 1.2),
    onComplete: () => graphics.destroy(),
  });
  scene.cameras.main.shake(140, 0.004);
}

export function spinSlash(scene: Phaser.Scene, player: Walker, radius: number) {
  const graphics = scene.add.graphics().setDepth(depthForHeight(player.level, player.y) + 1);
  const animationProgress = { progress: 0 };
  scene.tweens.add({
    targets: animationProgress, progress: 1, duration: 220,
    onUpdate: () => {
      graphics.clear().lineStyle(3, 0xffffff, 1 - animationProgress.progress).strokeEllipse(player.x, player.y - 6, radius * 2 * (0.6 + animationProgress.progress * 0.4), radius * 1.3 * (0.6 + animationProgress.progress * 0.4));
      graphics.lineStyle(1, 0xffce48, 1 - animationProgress.progress).strokeEllipse(player.x, player.y - 6, radius * 2.2 * animationProgress.progress, radius * 1.4 * animationProgress.progress);
    },
    onComplete: () => graphics.destroy(),
  });
}

export function spark(scene: Phaser.Scene, x: number, y: number) {
  const graphics = scene.add.graphics().setDepth(HUD_DEPTH - 5);
  graphics.fillStyle(0xffffff, 1);
  for (let i = 0; i < 4; i++) { const angle = i * Math.PI / 2 + 0.4; graphics.fillRect(x + Math.cos(angle) * 5 - 1, y + Math.sin(angle) * 5 - 1, 2, 2); }
  graphics.fillRect(x - 2, y - 2, 4, 4);
  scene.tweens.add({ targets: graphics, alpha: 0, duration: 160, onComplete: () => graphics.destroy() });
}

export function splat(scene: Phaser.Scene, x: number, y: number, level: number) {
  for (let i = 0; i < 5; i++) {
    const particle = scene.add.rectangle(x, y, 2, 2, 0xc6ec46).setDepth(depthForHeight(level, y + 6));
    scene.tweens.add({ targets: particle, x: x + Phaser.Math.Between(-7, 7), y: y + Phaser.Math.Between(-6, 3), alpha: 0, duration: 260, onComplete: () => particle.destroy() });
  }
}
