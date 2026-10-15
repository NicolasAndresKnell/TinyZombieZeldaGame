// =====================================================================
// START — 320x180 virtual screen, scaled up with crisp pixels.
// We wait for the pixel font so in-game text doesn't flash a fallback.
// =====================================================================
import Phaser from 'phaser';
import { SCREEN } from './config';
import { cleanName, connect } from './net/multiplayer';
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

// Ask for a name (remembered in this browser), then join the others.
const NAME_KEY = 'tiny-zombie-name';
const joinForm = document.getElementById('join') as HTMLFormElement;
const nameInput = document.getElementById('join-name') as HTMLInputElement;
try { nameInput.value = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* storage blocked: start empty */ }
nameInput.focus();
joinForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = cleanName(nameInput.value);
  if (!name) return nameInput.focus();
  try { localStorage.setItem(NAME_KEY, name); } catch { /* not remembered, that's fine */ }
  joinForm.hidden = true;
  gameEl.focus();
  connect(name);
});

// Keyboard only works once the page has focus; clicking the game gives it focus.
const gameEl = document.getElementById('game')!;
gameEl.addEventListener('pointerdown', () => gameEl.focus());
// Stop Space and arrow keys from scrolling the page while playing.
window.addEventListener('keydown', e => {
  if (!joinForm.hidden) return;   // let the name box take every key
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) e.preventDefault();
});
