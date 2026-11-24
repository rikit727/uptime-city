import './ui/styles.css';
import { Game } from './app/game';
import { registerServiceWorker } from './platform/pwa';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app element');

const game = new Game(container);
game.start();
registerServiceWorker();

// Handy for debugging in the browser console and for smoke tests.
(window as unknown as { uptimeCity: Game }).uptimeCity = game;
