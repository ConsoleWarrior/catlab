import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // относительные пути — нужно для запаковки под Яндекс Игры
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
