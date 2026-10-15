import Phaser from 'phaser';
import { VIEWPORT } from './config';
import { cleanName, connect } from './net/multiplayer';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

function startGame() {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: VIEWPORT.width, height: VIEWPORT.height,
    pixelArt: true,
    backgroundColor: '#2a2935',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },

    input: { keyboard: { target: document.getElementById('game')! } },
    scene: [BootScene, GameScene],
  });
}

Promise.race([
  document.fonts?.load('16px "Pixelify Sans"') ?? Promise.resolve(),
  new Promise(resolve => setTimeout(resolve, 1500)),
]).catch(() => {}).then(startGame);

const NAME_KEY = 'tiny-zombie-name';
const joinForm = document.getElementById('join') as HTMLFormElement;
const nameInput = document.getElementById('join-name') as HTMLInputElement;
try { nameInput.value = localStorage.getItem(NAME_KEY) ?? ''; } catch {  }
nameInput.focus();
joinForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = cleanName(nameInput.value);
  if (!name) return nameInput.focus();
  try { localStorage.setItem(NAME_KEY, name); } catch {  }
  joinForm.hidden = true;
  gameElement.focus();
  connect(name);
});

const gameElement = document.getElementById('game')!;
gameElement.addEventListener('pointerdown', () => gameElement.focus());

window.addEventListener('keydown', event => {
  if (!joinForm.hidden) return;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) event.preventDefault();
});
