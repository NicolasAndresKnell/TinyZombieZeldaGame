import Phaser from 'phaser';
import { BRAINS_TO_WIN, ENEMY_TYPES, HUD_DEPTH, PLAYER, VIEWPORT, UI } from '../config';
import type { GameScene } from '../scenes/GameScene';
import { HEIGHT_LEVEL_LABELS } from '../world/terrain';

const SCREEN_CENTER_X = VIEWPORT.width / 2, SCREEN_CENTER_Y = VIEWPORT.height / 2;
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
    const pin = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(gameObject: T) =>
      gameObject.setScrollFactor(0).setDepth(HUD_DEPTH);
    for (let i = 0; i < PLAYER.maxHealth; i++) this.hearts.push(pin(add.image(6 + i * 15, 6, 'heart').setOrigin(0)));
    this.levelLabel = pin(add.text(6, 20, '', { ...STYLE, fontSize: '9px', color: '#c9d2cc' }).setResolution(4));

    pin(add.image(292, 3, 'brain').setOrigin(1, 0));
    this.brainText = pin(add.text(316, 4, '', STYLE).setOrigin(1, 0).setResolution(4));
    pin(add.image(290, 23, 'brain_drop').setOrigin(1, 0));
    this.dropText = pin(add.text(316, 21, '', { ...STYLE, fontSize: '9px' }).setOrigin(1, 0).setResolution(4));
    pin(add.image(289, 37, 'skull').setOrigin(1, 0).setTint(0xd9d0c4));
    this.enemyText = pin(add.text(316, 35, '', { ...STYLE, fontSize: '9px' }).setOrigin(1, 0).setResolution(4));

    this.bossBar = pin(add.graphics());
    this.bossLabel = pin(add.text(SCREEN_CENTER_X, 157, 'BRAIN KING', { ...STYLE, fontSize: '9px', color: '#ffce48' }).setOrigin(0.5).setResolution(4));
    this.pointer = add.graphics().setDepth(HUD_DEPTH - 1);
    this.updateHearts();
    this.updateCounters();
  }

  update() {
    const { player, boss } = this.scene;
    this.levelLabel.setText(player.onStairs ? 'STAIRS' : HEIGHT_LEVEL_LABELS[player.level]);
    const show = !!boss && !boss.dead;
    this.bossBar.setVisible(show); this.bossLabel.setVisible(show);
    if (show) {
      const healthFraction = Math.max(0, boss.health) / ENEMY_TYPES.boss.health;
      this.bossBar.clear()
        .fillStyle(0x1a1d1c, 0.85).fillRect(80, 166, 160, 7)
        .fillStyle(UI.gold, 1).fillRect(81, 167, 158 * healthFraction, 5);
    }
    this.drawPointer();
  }

  updateHearts() {
    this.hearts.forEach((heart, heartIndex) => heart.setTint(heartIndex < this.scene.player.health ? UI.heartFull : UI.heartEmpty));
  }

  updateCounters() {
    const scene = this.scene;
    this.brainText.setText(`${scene.brainsCollected}/${BRAINS_TO_WIN}`);
    this.dropText.setText(`${scene.dropsCollected}/${scene.totalDrops}`);
    this.enemyText.setText(`${scene.enemies.filter(enemy => !enemy.dead).length}`);
  }

  private drawPointer() {
    const graphics = this.pointer.clear();
    const scene = this.scene, player = scene.player;
    if (scene.gameOver) return;
    let best: { x: number; y: number } | null = null, nearestDistance = Infinity, color: number = UI.brain;
    const consider = (list: { x: number; y: number; taken?: boolean; dead?: boolean }[], candidateColor: number) => {
      for (const candidate of list) {
        if (candidate.taken || candidate.dead) continue;
        const distance = Phaser.Math.Distance.Between(player.x, player.y, candidate.x, candidate.y);
        if (distance < nearestDistance) { nearestDistance = distance; best = candidate; color = candidateColor; }
      }
    };
    consider(scene.brains, UI.brain);
    if (!best) consider(scene.drops, UI.brain);
    if (!best && scene.boss && !scene.boss.dead) consider([scene.boss], UI.gold);
    if (!best || nearestDistance < 48) return;
    const target: { x: number; y: number } = best;
    const angle = Phaser.Math.Angle.Between(player.x, player.y - 10, target.x, target.y);
    const centerX = player.x + Math.cos(angle) * 20, centerY = player.y - 10 + Math.sin(angle) * 20;
    const pointAtAngle = (radius: number, angleOffset: number) => ({ x: centerX + Math.cos(angle + angleOffset) * radius, y: centerY + Math.sin(angle + angleOffset) * radius });
    const tip = pointAtAngle(5, 0), leftCorner = pointAtAngle(4, 2.5), rightCorner = pointAtAngle(4, -2.5);
    graphics.fillStyle(0x1a0e14, 0.9).fillTriangle(tip.x + 1, tip.y + 1, leftCorner.x + 1, leftCorner.y + 1, rightCorner.x + 1, rightCorner.y + 1);
    graphics.fillStyle(color, 1).fillTriangle(tip.x, tip.y, leftCorner.x, leftCorner.y, rightCorner.x, rightCorner.y);
  }

  popText(x: number, y: number, message: string, color: string) {
    const text = this.scene.add.text(x, y, message, { ...STYLE, fontSize: '10px', color }).setOrigin(0.5).setResolution(4).setDepth(HUD_DEPTH - 3);
    this.scene.tweens.add({ targets: text, y: y - 10, alpha: 0, duration: 520, onComplete: () => text.destroy() });
  }

  toast(message: string) {
    const text = this.scene.add.text(SCREEN_CENTER_X, 52, message, { ...STYLE, fontSize: '10px', color: '#ffce48' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH).setResolution(4);
    this.scene.tweens.add({ targets: text, alpha: 0, delay: 2600, duration: 600, onComplete: () => text.destroy() });
  }

  showPanel(title: string, line: string, extra: string, onContinue?: () => void) {
    const scene = this.scene;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const top = <T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(gameObject: T) => {
      parts.push(gameObject); return gameObject.setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    };
    top(scene.add.rectangle(SCREEN_CENTER_X, SCREEN_CENTER_Y, VIEWPORT.width, VIEWPORT.height, 0x14121a, 0.55));
    const panelHeight = extra ? 92 : 72;

    top(scene.add.nineslice(SCREEN_CENTER_X, SCREEN_CENTER_Y, 'panel', undefined, 216, panelHeight, 6, 6, 6, 6));
    const text = (y: number, message: string, size: string, color = UI.ink) => top(scene.add.text(SCREEN_CENTER_X, y, message, {
      fontFamily: UI.font, fontSize: size, color, align: 'center', wordWrap: { width: 196 },
    }).setOrigin(0.5).setResolution(4));
    let y = SCREEN_CENTER_Y - panelHeight / 2 + 16;
    text(y, title, '16px'); y += 20;
    text(y, line, '9px'); y += 14;
    if (extra) { text(y + 4, extra, '9px', '#7a3150'); y += 24; }
    text(y, onContinue ? 'Enter: keep playing   ·   R: restart' : 'Press R to play again', '9px');
    const keys = scene.input.keyboard!;
    keys.once('keydown-R', () => scene.scene.restart());
    if (onContinue) keys.once('keydown-ENTER', () => { parts.forEach(gameObject => gameObject.destroy()); onContinue(); });
  }
}
