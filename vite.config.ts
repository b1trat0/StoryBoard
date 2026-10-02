import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Renderer build config.
 *
 * The renderer is a plain Vite app. It has no knowledge of Postgres or the
 * filesystem: everything it can do arrives through window.storyboard, the context
 * bridge exposed by electron/preload.ts.
 *
 * `base: './'` matters. A packaged app is loaded from disk with loadFile, and
 * absolute asset paths like /assets/index.js would resolve against the
 * filesystem root and fail to load.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Electron loads the dev server during startup; a silent port shift would
    // leave the window blank with nothing in the log explaining why.
    strictPort: true,
  },
});