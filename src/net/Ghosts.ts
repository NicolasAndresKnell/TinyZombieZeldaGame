import Phaser from 'phaser';
import { HUD_DEPTH, MULTIPLAYER, UI } from '../config';
import { Walker } from '../entities/Walker';
import type { GameScene } from '../scenes/GameScene';
import type { NetworkPlayerState } from '../types';
import { HEIGHT_LEVEL_LABELS } from '../world/terrain';
import { cleanName, getConnection, getPlayerName } from './multiplayer';

interface RemotePlayerView { hero: Walker; label: Phaser.GameObjects.Text }

export class Ghosts {
  private ghosts = new Map<string, RemotePlayerView>();
  private nextSendAt = 0;
  private heartbeatAt = 0;
  private lastSent = '';
  private ownLabel?: Phaser.GameObjects.Text;

  constructor(private scene: GameScene) {}

  private makeLabel(x: number, y: number, tint: number) {
    return this.scene.add.text(x, y, '', { fontFamily: UI.font, fontSize: '8px', color: '#ffffff' })
      .setOrigin(0.5, 1).setResolution(4).setStroke('#1a1d1c', 3).setTint(tint).setDepth(HUD_DEPTH - 3);
  }

  update(time: number, deltaSeconds: number) {
    this.updateOwnLabel();
    const connection = getConnection();
    if (!connection) return;
    const player = this.scene.player;
    if (time >= this.nextSendAt) {
      this.nextSendAt = time + MULTIPLAYER.sendMs;
      const hero: NetworkPlayerState = { x: Math.round(player.x), y: Math.round(player.y), heightLevel: player.level, facing: player.facing, animationKey: player.anims.currentAnim?.key ?? '', isDead: player.isDead, playerName: connection.name };
      const key = JSON.stringify(hero);

      if (key !== this.lastSent || time >= this.heartbeatAt) {
        this.lastSent = key; this.heartbeatAt = time + MULTIPLAYER.heartbeatMs; connection.send(hero);
      }
    }
    const seen = new Set<string>();
    for (const { id, hero: remoteState } of connection.peers) {
      if (!Number.isFinite(remoteState?.x) || !Number.isFinite(remoteState?.y)) continue;
      seen.add(id);
      let ghost = this.ghosts.get(id);
      if (!ghost) {
        const tint = MULTIPLAYER.tints[this.ghosts.size % MULTIPLAYER.tints.length];
        ghost = {
          hero: new Walker(this.scene, remoteState.x, remoteState.y, 'hero', 0).setTint(tint),
          label: this.makeLabel(remoteState.x, remoteState.y, tint),
        };
        this.ghosts.set(id, ghost);
      }
      const remoteHero = ghost.hero;
      const interpolationFactor = Math.min(1, MULTIPLAYER.smoothing * deltaSeconds);
      remoteHero.x += (remoteState.x - remoteHero.x) * interpolationFactor; remoteHero.y += (remoteState.y - remoteHero.y) * interpolationFactor;
      remoteHero.level = Phaser.Math.Clamp(remoteState.heightLevel | 0, 0, HEIGHT_LEVEL_LABELS.length - 1);
      remoteHero.setFlipX(remoteState.facing === 'left').setAlpha(remoteState.isDead ? 0.4 : 1);
      if (typeof remoteState.animationKey === 'string' && remoteState.animationKey.startsWith('hero_') && this.scene.anims.exists(remoteState.animationKey)) remoteHero.anims.play(remoteState.animationKey, true);
      remoteHero.syncDepth();
      ghost.label.setText(cleanName(remoteState.playerName) || 'Player').setPosition(Math.round(remoteHero.x), Math.round(remoteHero.y) - MULTIPLAYER.nameAboveFeet).setAlpha(remoteHero.alpha);
    }
    for (const [id, ghost] of this.ghosts) {
      if (seen.has(id)) continue;
      ghost.hero.destroy(); ghost.label.destroy(); this.ghosts.delete(id);
    }
  }

  // Our own name, in white, once we've picked one.
  private updateOwnLabel() {
    const name = getPlayerName();
    if (!name) return;
    const player = this.scene.player;
    this.ownLabel ??= this.makeLabel(player.x, player.y, 0xffffff);
    this.ownLabel.setText(name).setPosition(Math.round(player.x), Math.round(player.y) - MULTIPLAYER.nameAboveFeet);
  }
}
