import { defineConfig } from 'vite';

// GitHub Pages serves the game from /minisouls/; the dev server serves from root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/minisouls/' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
}));
