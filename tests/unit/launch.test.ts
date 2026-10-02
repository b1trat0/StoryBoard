import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRendererEntry } from '../../electron/lib/paths.js';

/**
 * Regression tests for the two faults that made the window open blank.
 *
 * Both are silent. A wrong renderer path and a preload that cannot load its
 * imports produce no exception anywhere the author would look: the app starts,
 * the window appears, and the UI is either empty or apologises about a missing
 * bridge. Reading the source and asserting its shape is the only cheap way to
 * keep them fixed, which is the same approach contract.test.ts takes for channels.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PRELOAD_SOURCE = readFileSync(path.join(projectRoot, 'electron/preload.ts'), 'utf8');

const CHANNELS_SOURCE = readFileSync(
  path.join(projectRoot, 'electron/ipc/channels.ts'),
  'utf8',
);

describe('preload sandbox safety', () => {
  it('does not import the handler graph', () => {
    // handlers.ts transitively pulls in pg, Drizzle and every repository. In
    // Electron's sandbox a preload script has no Node module system, so that
    // import throws while loading and window.storyboard never gets defined.
    expect(PRELOAD_SOURCE).not.toMatch(/from\s+'\.\/ipc\/handlers\.js'/);
  });

  it('imports channel names from the inert channels module', () => {
    expect(PRELOAD_SOURCE).toMatch(/from\s+'\.\/ipc\/channels\.js'/);
  });

  it('keeps every preload import except electron and channels type-only', () => {
    // Type-only imports are erased at compile time, so they cost the sandbox
    // nothing. A value import of anything else is a module the sandbox would
    // have to load at runtime.
    const valueImportSources = [...PRELOAD_SOURCE.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm)]
      .map((match) => match[1]);

    expect(valueImportSources.sort()).toEqual(['./ipc/channels.js', 'electron']);
  });

  it('gives channels.ts no imports at all', () => {
    // channels.ts is what preload actually loads. One stray import here undoes
    // every guarantee above, and the failure mode is a blank window.
    expect(CHANNELS_SOURCE).not.toMatch(/^\s*import\s/m);
  });
});

describe('resolveRendererEntry', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'storyboard-paths-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** Builds a fake repo with a dist/index.html and returns both paths. */
  function layoutWithBuild(nested: boolean): { mainDir: string; entry: string } {
    const root = nested
      ? path.join(sandbox, 'app.asar')
      : sandbox;
    const mainDir = path.join(root, 'dist-electron', 'electron');
    const buildDir = path.join(root, 'dist');
    mkdirSync(mainDir, { recursive: true });
    mkdirSync(buildDir, { recursive: true });
    const entry = path.join(buildDir, 'index.html');
    writeFileSync(entry, '<!doctype html>');
    return { mainDir, entry };
  }

  it('finds the build from the compiled main directory', () => {
    // The real layout: main compiles to dist-electron/electron/main.js while Vite
    // builds to <repo>/dist. A fixed one-level-up path would miss this.
    const { mainDir, entry } = layoutWithBuild(false);
    expect(resolveRendererEntry(mainDir)).toBe(entry);
  });

  it('finds the build when the bundle is nested deeper, as in a packaged app', () => {
    const { mainDir, entry } = layoutWithBuild(true);
    expect(resolveRendererEntry(mainDir)).toBe(entry);
  });

  it('accepts a relative start directory', () => {
    const { mainDir, entry } = layoutWithBuild(false);
    const relative = path.relative(process.cwd(), mainDir);
    expect(resolveRendererEntry(relative)).toBe(entry);
  });

  it('throws a message that names the fix when the build is missing', () => {
    const mainDir = path.join(sandbox, 'dist-electron', 'electron');
    mkdirSync(mainDir, { recursive: true });
    expect(() => resolveRendererEntry(mainDir)).toThrow(/npm run build/);
  });

  it('ignores a dist directory that has no index.html', () => {
    // A half-finished or emptied build must not be mistaken for a valid one.
    const mainDir = path.join(sandbox, 'dist-electron', 'electron');
    mkdirSync(mainDir, { recursive: true });
    mkdirSync(path.join(sandbox, 'dist'), { recursive: true });
    expect(() => resolveRendererEntry(mainDir)).toThrow(/npm run build/);
  });
});