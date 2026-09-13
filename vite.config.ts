import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ command }) => ({
  root: fromRoot('./demo'),
  base: './',
  resolve: {
    alias: {
      // The dev server uses the TypeScript sources for instant reloads; production builds consume
      // the compiled package output (`npm run build:lib`), exactly as an npm consumer would.
      'code39-scanner': fromRoot(command === 'serve' ? './src/index.ts' : './dist/index.js'),
    },
  },
  build: {
    outDir: fromRoot('./dist-demo'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
