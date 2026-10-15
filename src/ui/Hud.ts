// =====================================================================
// HUD — hearts, counters, boss bar, the objective arrow, toasts and panels.
// setScrollFactor(0) pins things to the screen instead of the world.
// =====================================================================
import Phaser from 'phaser';
import { BRAINS_TO_WIN, ENEMY_TYPES, HUD_DEPTH, PLAYER, SCREEN, UI } from '../config';
import type { GameScene } from '../scenes/GameScene';
import { HEIGHT_NAMES } from '../world/terrain';

const CX = SCREEN.w / 2, CY = SCREEN.h / 2;
const STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: UI.font, fontSize: '11px', color: '#f1e8dc', stroke: '#1a1d1c', strokeThickness: 3,
};

export class Hud {
  private hearts: Phaser.GameObjects.Image[] = [];
  private levelLabel: Phaser.GameObjects.Text;
  private brainText: Phaser.GameObjects.Text;
  private dropText: Phaser.GameObjects.Text;
  private enemyText: Phaser.GameObjects.Text;
  private bossBar: Phaser.GameObjects.Graphics;
  private bossLabel: Phaser.GameObjects.Text;
  private pointer: Phaser.GameObjects.Graphics;

  constructor(private scene: GameScene) {
    const add = scene.add;
    const pin = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T) =>
      o.setScrollFactor(0).setDepth(HUD_DEPTH);
    for (let i = 0; i < PLAYER.maxHealth; i++) this.hearts.push(pin(add.image(6 + i * 15, 6, 'heart').setOrigin(0)));
    this.levelLabel = pin(add.text(6, 20, '', { ...STYLE, fontSize: '9px', color: '#c9d2cc' }).setResolution(4));

    // right column: level brains, dropped brains, enemies left
    pin(add.image(292, 3, 'brain').setOrigin(1, 0));
    this.brainText = pin(add.text(316, 4, '', STYLE).setOrigin(1, 0).setResolution(4));
    pin(add.image(290, 23, 'brain_drop').setOrigin(1, 0));
    this.dropText = pin(add.text(316, 21, '', { ...STYLE, fontSize: '9px' }).setOrigin(1, 0).setResolution(4));
    pin(add.image(289, 37, 'skull').setOrigin(1, 0).setTint(0xd9d0c4));
    this.enemyText = pin(add.text(316, 35, '', { ...STYLE, fontSize: '9px' }).setOrigin(1, 0).setResolution(4));

    this.bossBar = pin(add.graphics());
    this.bossLabel = pin(add.text(CX, 157, 'BRAIN KING', { ...STYLE, fontSize: '9px', color: '#ffce48' }).setOrigin(0.5).setResolution(4));
    this.pointer = add.graphics().setDepth(HUD_DEPTH - 1);
    this.updateHearts();
    this.updateCounters();
  }

  // Called every frame.
  update() {
    const { player, boss } = this.scene;
    this.levelLabel.setText(player.onStairs ? 'STAIRS' : HEIGHT_NAMES[player.level]);
    const show = !!boss && !boss.dead;
    this.bossBar.setVisible(show); this.bossLabel.setVisible(show);
    if (show) {
      const f = Math.max(0, boss.health) / ENEMY_TYPES.boss.health;
      this.bossBar.clear()
        .fillStyle(0x1a1d1c, 0.85).fillRect(80, 166, 160, 7)
        .fillStyle(UI.gold, 1).fillRect(81, 167, 158 * f, 5);
    }
    this.drawPointer();
  }

  updateHearts() {
    this.hearts.forEach((h, i) => h.setTint(i < this.scene.player.health ? UI.heartFull : UI.heartEmpty));
  }

  updateCounters() {
    const s = this.scene;
    this.brainText.setText(`${s.brainsCollected}/${BRAINS_TO_WIN}`);
    this.dropText.setText(`${s.dropsCollected}/${s.totalDrops}`);
    this.enemyText.setText(`${s.enemies.filter(e => !e.dead).length}`);
  }

  // A small arrow around the hero pointing at the next thing to go for.
  private drawPointer() {
    const g = this.pointer.clear();
    const s = this.scene, p = s.player;
    if (s.gameOver) return;
    let best: { x: number; y: number } | null = null, bd = Infinity, color: number = UI.brain;
    const consider = (list: { x: number; y: number; taken?: boolean; dead?: boolean }[], c: number) => {
      for (const b of list) {
        if (b.taken || b.dead) continue;
        const d = Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y);
        if (d < bd) { bd = d; best = b; color = c; }
      }
    };
    consider(s.brains, UI.brain);
    if (!best) consider(s.drops, UI.brain);
    if (!best && s.boss && !s.boss.dead) consider([s.boss], UI.gold);
    if (!best || bd < 48) return;
    const target: { x: number; y: number } = best;
    const a = Phaser.Math.Angle.Between(p.x, p.y - 10, target.x, target.y);
    const cx = p.x + Math.cos(a) * 20, cy = p.y - 10 + Math.sin(a) * 20;
    const pt = (r: number, da: number) => ({ x: cx + Math.cos(a + da) * r, y: cy + Math.sin(a + da) * r });
    const tip = pt(5, 0), l = pt(4, 2.5), r = pt(4, -2.5);
    g.fillStyle(0x1a0e14, 0.9).fillTriangle(tip.x + 1, tip.y + 1, l.x + 1, l.y + 1, r.x + 1, r.y + 1);
    g.fillStyle(color, 1).fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  popText(x: number, y: number, str: string, color: string) {
    const t = this.scene.add.text(x, y, str, { ...STYLE, fontSize: '10px', color }).setOrigin(0.5).setResolution(4).setDepth(HUD_DEPTH - 3);
    this.scene.tweens.add({ targets: t, y: y - 10, alpha: 0, duration: 520, onComplete: () => t.destroy() });
  }

  toast(str: string) {
    const t = this.scene.add.text(CX, 52, str, { ...STYLE, fontSize: '10px', color: '#ffce48' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH).setResolution(4);
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 600, onComplete: () => t.destroy() });
  }

  // A cream panel. With onContinue, Enter closes it and calls it; R always restarts.
  showPanel(title: string, line: string, extra: string, onContinue?: () => void) {
    const scene = this.scene;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const top = <T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T) => {
      parts.push(o); return o.setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    };
    top(scene.add.rectangle(CX, CY, SCREEN.w, SCREEN.h, 0x14121a, 0.55));
    const h = extra ? 92 : 72;
    // nineslice stretches the panel's middle but keeps its 6px corners crisp.
    top(scene.add.nineslice(CX, CY, 'panel', undefined, 216, h, 6, 6, 6, 6));
    const text = (y: number, str: string, size: string, color = UI.ink) => top(scene.add.text(CX, y, str, {
      fontFamily: UI.font, fontSize: size, color, align: 'center', wordWrap: { width: 196 },
    }).setOrigin(0.5).setResolution(4));
    let y = CY - h / 2 + 16;
    text(y, title, '16px'); y += 20;
    text(y, line, '9px'); y += 14;
    if (extra) { text(y + 4, extra, '9px', '#7a3150'); y += 24; }
    text(y, onContinue ? 'Enter: keep playing   ·   R: restart' : 'Press R to play again', '9px');
    const keys = scene.input.keyboard!;
    keys.once('keydown-R', () => scene.scene.restart());
    if (onContinue) keys.once('keydown-ENTER', () => { parts.forEach(o => o.destroy()); onContinue(); });
  }
}
