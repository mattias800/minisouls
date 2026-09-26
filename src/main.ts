import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/400-italic.css';
import './styles.css';
import { Game } from './game/Game';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const game = new Game(container);
game.start();

// Handy for poking at the game from the console during development.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
