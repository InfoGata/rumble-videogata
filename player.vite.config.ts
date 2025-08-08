// player.vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    viteSingleFile()
  ],
  root: path.resolve(__dirname, './src'),
  define: {
    'process.env': {}
  },
  build: {
    outDir: '../dist',
    minify: true,
    target: 'esnext',
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/player.html'),
      output: {
        entryFileNames: 'player.js',
      }
    }
  }
});