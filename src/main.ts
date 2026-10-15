// =====================================================================
// START — 320x180 virtual screen, scaled up with crisp pixels.
// We wait for the pixel font so in-game text doesn't flash a fallback.
// =====================================================================
import Phaser from 'phaser';
import { SCREEN } from './config';
import { connect } from './net/multiplayer';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

function startGame() {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: SCREEN.w, height: SCREEN.h,
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

connect();

// Keyboard only works once the page has focus; clicking the game gives it focus.
const gameEl = document.getElementById('game')!;
gameEl.addEventListener('pointerdown', () => gameEl.focus());
// Stop Space and arrow keys from scrolling the page while playing.
window.addEventListener('keydown', e => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) e.preventDefault();
});
