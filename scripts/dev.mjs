/**
 * One-command development launcher.
 *
 * The old two-terminal setup (`npm run dev` in one, `npm run dev:electron` in
 * another) is a trap: run the second without the first and Electron opens a blank
 * window with ERR_CONNECTION_REFUSED in a log nobody is watching. This script
 * owns both halves so the correct command and the working result are the same
 * thing.
 *
 * The main process and preload are compiled by `build:electron` before this script
 * runs, not here: Electron loads `dist-electron` from disk and has no watcher, so a
 * source edit to the main process would otherwise launch the previous build while
 * the renderer hot-reloaded, and the two would disagree.
 *
 * Vite is started through its Node API rather than as a child process, so there
 * is no extra dependency and the server's lifecycle is directly controllable:
 * it closes when Electron exits, and an early Electron exit cannot leave a
 * orphaned port holding 5173.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** Resolves the Electron binary from node_modules without a hard-coded path. */
function resolveElectronBinary() {
  const binary = require('electron');
  if (typeof binary !== 'string') {
    throw new Error('electron did not resolve to a binary path');
  }
  return binary;
}

async function main() {
  const server = await createServer({
    root: projectRoot,
    configFile: path.join(projectRoot, 'vite.config.ts'),
  });

  await server.listen();

  // resolvedUrls is what Vite actually bound. Reading the configured port back
  // would lie if 5173 was already taken and Vite had to shift.
  const localUrl = server.resolvedUrls?.local?.[0];
  if (localUrl === undefined) {
    await server.close();
    throw new Error('Vite started but reported no local URL');
  }

  process.stdout.write(`renderer ready at ${localUrl}\n`);
  process.stdout.write('starting Electron...\n');

  const electronBinary = resolveElectronBinary();
  const child = spawn(electronBinary, [projectRoot], {
    stdio: 'inherit',
    env: { ...process.env, STORYBOARD_DEV_SERVER: localUrl },
  });

  let isClosing = false;

  /** Closes the dev server exactly once, whichever side exits first. */
  const shutdown = async (exitCode) => {
    if (isClosing) {
      return;
    }
    isClosing = true;
    await server.close().catch(() => undefined);
    process.exit(exitCode);
  };

  child.on('close', (code) => {
    void shutdown(code ?? 0);
  });

  // Without this, Ctrl+C leaves the Vite server holding the port, and the next
  // `npm run dev` fails on a port it did not open.
  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
}

main().catch((err) => {
  process.stderr.write(`dev launcher failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});