import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locating the built renderer.
 *
 * The main bundle sits at dist-electron/electron/main.js while the Vite build
 * lands at <repo>/dist. Hard-coding either depth breaks one of the three places
 * the app runs from, so the entry point is found by walking up instead. Getting
 * this wrong produces a window that opens and stays blank with no error logged,
 * which is the single most confusing failure this app has.
 */

/**
 * Resolves the renderer's index.html by searching upwards from the main bundle.
 *
 * @param startDir - Directory of the running main module (dist-electron/electron)
 * @returns Absolute path to the renderer entry point
 * @throws When no dist/index.html is found within eight levels
 */
export function resolveRendererEntry(startDir: string): string {
  const absoluteStart = isAbsolute(startDir) ? startDir : resolve(startDir);

  let dir = absoluteStart;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'dist', 'index.html');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    `Could not find dist/index.html walking up from ${absoluteStart}. ` +
      'Run `npm run build` before starting the app.',
  );
}

/** Convenience wrapper that starts from this module's own location. */
export function resolveRendererEntryFromHere(): string {
  return resolveRendererEntry(dirname(fileURLToPath(import.meta.url)));
}