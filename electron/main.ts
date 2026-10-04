import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './lib/logger.js';
import { resolveRendererEntryFromHere } from './lib/paths.js';
import { closeDb, initDb } from './db/client.js';
import { createHandlers } from './ipc/handlers.js';
import type { Handlers } from './ipc/handlers.js';
import { createSaveFilePicker } from './interfaces/file-dialog.interface.js';

/**
 * Electron main process.
 *
 * This process owns the database and the filesystem. The renderer owns neither,
 * which is why every write in the app arrives here through a validated IPC
 * handler rather than through a SQL string built in the UI.
 *
 * There is no backend server and no network listener. The app talks to
 * PostgreSQL and to nothing else until an image is explicitly uploaded.
 */

const logger = createLogger();
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Vite serves the renderer in development; the build is read from disk otherwise. */
const DEV_SERVER_URL = process.env.STORYBOARD_DEV_SERVER;

let mainWindow: BrowserWindow | null = null;

function registerIpcHandlers(): Handlers {
  // The window is read lazily through a getter: the handlers are wired before the
  // window exists, and the export dialog should open in front of it rather than
  // behind, or nowhere at all.
  const handlers = createHandlers(logger, createSaveFilePicker(() => mainWindow));
  for (const [channel, handler] of Object.entries(handlers)) {
    // Every handler has the same shape: untrusted payload in, IpcResult out.
    // Nothing is reachable on this channel that did not pass through handleIpc,
    // so validation cannot be forgotten at a call site.
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  }
  return handlers;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#12100e',
    title: 'StoryBoard',
    webPreferences: {
      // Built by vite.preload.config.ts, not tsc: a sandboxed preload must be a
      // single CommonJS file, and main.js here is the bundled one.
      preload: path.join(currentDir, 'preload.cjs'),
      // The renderer is untrusted by construction: it cannot reach Node, and
      // the only capability it holds is the bridge object from preload.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Painting only after load avoids the white flash before the app's own styles
  // are applied, which is jarring when the shell is dark.
  window.once('ready-to-show', () => {
    window.show();
  });

  if (DEV_SERVER_URL !== undefined) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    // Resolved by searching upwards rather than hard-coded depth: main compiles to
    // dist-electron/electron/ while Vite builds to <repo>/dist.
    void window.loadFile(resolveRendererEntryFromHere());
  }

  // A dev server that is not running produces a blank window and a single line in
  // a log the author is not looking at. A dialog names the command to run, which
  // is the difference between a two-second fix and a confused bug report.
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) {
      // -3 is ERR_ABORTED, which fires for ordinary in-page navigation and
      // in-window reloads. Treating it as a failure would pop a dialog on every
      // hot reload.
      return;
    }

    logger.error('renderer failed to load', {
      errorCode,
      errorDescription,
      validatedURL,
    });

    if (DEV_SERVER_URL === undefined) {
      return;
    }

    const choice = dialog.showMessageBoxSync(window, {
      type: 'error',
      title: 'StoryBoard could not start',
      message: 'The renderer development server is not running.',
      detail: `${DEV_SERVER_URL} refused the connection.\n\nStart everything with:\n\n  npm run dev\n\nOr run the built app instead:\n\n  npm start`,
      buttons: ['Close'],
      defaultId: 0,
    });

    if (choice === 0) {
      app.quit();
    }
  });

  return window;
}

async function bootstrap(): Promise<void> {
  try {
    initDb(logger);
    logger.info('database ready');
  } catch (err) {
    // Without the database the app cannot function, and pretending otherwise
    // would mean every screen failing in a more confusing way later.
    logger.error('database unavailable, refusing to start', { err: String(err) });
    app.quit();
    return;
  }

  const handlers = registerIpcHandlers();
  logger.info('ipc handlers registered', { count: Object.keys(handlers).length });

  app.on('browser-window-created', (_event, window) => {
    // No navigation away from the app and no new windows: this is a single
    // window local tool, and neither behaviour is wanted.
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  mainWindow = createWindow();

  app.on('activate', () => {
    // macOS re-activates a closed app. mainWindow is nulled on window-all-closed,
    // so this is the single place a replacement window gets created.
    if (mainWindow === null) {
      mainWindow = createWindow();
    }
  });
}

app.whenReady().then(bootstrap).catch((err: unknown) => {
  logger.error('bootstrap failed', { err: String(err) });
  app.quit();
});

app.on('window-all-closed', () => {
  // Dropping the reference matters: Electron collects a window that nothing in JS
  // points at, and a collected window on macOS would strand the app with no way to
  // reopen one.
  mainWindow = null;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // The pool holds open sockets into Postgres; letting them dangle on quit
  // delays shutdown and, on Windows, leaves the container running a client.
  closeDb();
});