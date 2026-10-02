import { defineConfig } from 'vite';

/**
 * Preload bundle.
 *
 * The preload cannot be emitted by tsc alongside the rest of the main process,
 * for two reasons that only show up at runtime:
 *
 * 1. Electron loads a preload as CommonJS. tsc emits ESM here, so the file dies
 *    with "Cannot use import statement outside a module" and window.storyboard
 *    is never defined.
 * 2. A sandboxed preload has no Node module system. It cannot require a relative
 *    file, so the channel names it needs must be inlined into one bundle.
 *
 * Both failures are silent: the window opens, the bridge is simply absent.
 *
 * `electron` stays external so the require resolves to Electron's sandbox
 * polyfill rather than to a copy of the module.
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist-electron/electron',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'electron/preload.ts',
      // One file, no code splitting: a preload that loads another file simply
      // fails to load at all under sandbox.
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});