import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, EVENTS } from './ipc/channels.js';
import type { IpcResult } from './controllers/ipc-handler.js';
import type { StoryBoardApi } from './ipc/contract.js';

/**
 * The only bridge between the renderer and the main process.
 *
 * No ipcRenderer, no channel name and no Node module ever reaches renderer code.
 * The renderer can call these methods and nothing else, and each call returns
 * either validated data or an author-readable error. contextIsolation stays on,
 * nodeIntegration stays off, and the renderer runs in the sandbox.
 *
 * The channel names are imported from ipc/channels.ts rather than ipc/handlers.ts
 * on purpose. A sandboxed preload cannot load pg or any other Node dependency, so
 * this module must not transitively import the handler graph. Everything else
 * below is a type-only import, which compiles away.
 */

/**
 * Unwraps a main-process result.
 *
 * An IpcError becomes a thrown Error carrying the author-facing message, so the
 * renderer uses ordinary try/catch and never branches on an `ok` flag.
 */
async function invoke<T>(channel: string, payload: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>;
  if (!result.ok) {
    const error = new Error(result.message) as Error & { code: string };
    error.code = result.code;
    throw error;
  }
  return result.data;
}

/** For void handlers: the payload still has to be sent, but nothing comes back. */
async function invokeVoid(channel: string, payload: unknown): Promise<void> {
  await invoke<void>(channel, payload);
}

export function createBridgeApi(): StoryBoardApi {
  return {
    entities: {
      list: (input) => invoke(CHANNELS.entitiesList, input),
      create: (input) => invoke(CHANNELS.entitiesCreate, input),
      update: (input) => invoke(CHANNELS.entitiesUpdate, input),
      addAlias: (input) => invoke(CHANNELS.entitiesAddAlias, input),
      remove: (input) => invokeVoid(CHANNELS.entitiesRemove, input),
    },
    relations: {
      list: (input) => invoke(CHANNELS.relationsList, input),
      create: (input) => invoke(CHANNELS.relationsCreate, input),
      remove: (input) => invokeVoid(CHANNELS.relationsRemove, input),
    },
    facts: {
      list: (input) => invoke(CHANNELS.factsList, input),
      create: (input) => invoke(CHANNELS.factsCreate, input),
      setStatus: (input) => invoke(CHANNELS.factsSetStatus, input),
      remove: (input) => invokeVoid(CHANNELS.factsRemove, input),
    },
    outline: {
      list: (input) => invoke(CHANNELS.outlineList, input),
      describeDeletion: (input) => invoke(CHANNELS.outlineDescribeDeletion, input),
      createVolume: (input) => invoke(CHANNELS.outlineCreateVolume, input),
      updateVolume: (input) => invoke(CHANNELS.outlineUpdateVolume, input),
      removeVolume: (input) => invokeVoid(CHANNELS.outlineRemoveVolume, input),
      createArc: (input) => invoke(CHANNELS.outlineCreateArc, input),
      updateArc: (input) => invoke(CHANNELS.outlineUpdateArc, input),
      removeArc: (input) => invokeVoid(CHANNELS.outlineRemoveArc, input),
    },
    chapters: {
      listByArc: (input) => invoke(CHANNELS.chaptersListByArc, input),
      get: (input) => invoke(CHANNELS.chaptersGet, input),
      create: (input) => invoke(CHANNELS.chaptersCreate, input),
      remove: (input) => invokeVoid(CHANNELS.chaptersRemove, input),
      saveProse: (input) => invoke(CHANNELS.chaptersSaveProse, input),
      saveOutline: (input) => invoke(CHANNELS.chaptersSaveOutline, input),
      move: (input) => invokeVoid(CHANNELS.chaptersMove, input),
    },
    glossary: {
      list: (input) => invoke(CHANNELS.glossaryList, input),
      save: (input) => invoke(CHANNELS.glossarySave, input),
    },
    illustrations: {
      listByChapter: (input) => invoke(CHANNELS.illustrationsListByChapter, input),
      createSlot: (input) => invoke(CHANNELS.illustrationsCreateSlot, input),
      updateSlot: (input) => invoke(CHANNELS.illustrationsUpdateSlot, input),
      uploadToHost: (input) => invoke(CHANNELS.illustrationsUploadToHost, input),
      pickImage: (input) => invoke(CHANNELS.illustrationsPickImage, input),
    },
    release: {
      previewChapter: (input) => invoke(CHANNELS.releasePreviewChapter, input),
      exportVolumeDocx: (input) => invoke(CHANNELS.releaseExportVolumeDocx, input),
      exportChapterHtml: (input) => invoke(CHANNELS.releaseExportChapterHtml, input),
    },
    archive: {
      exportProject: (input) => invoke(CHANNELS.archiveExportProject, input),
    },
    backup: {
      status: (input) => invoke(CHANNELS.backupStatus, input),
      run: (input) => invoke(CHANNELS.backupRun, input),
    },
    editorSafety: {
      setDirty: (input) => invokeVoid(CHANNELS.editorSetDirty, input),
      confirmQuit: (input) => invokeVoid(CHANNELS.appConfirmQuit, input),
      onSaveAndQuit: (handler) => {
        const listener = (): void => handler();
        ipcRenderer.on(EVENTS.editorSaveAndQuit, listener);
        return () => {
          ipcRenderer.removeListener(EVENTS.editorSaveAndQuit, listener);
        };
      },
    },
    drafts: {
      save: (input) => invokeVoid(CHANNELS.draftsSave, input),
      read: (input) => invoke(CHANNELS.draftsRead, input),
      clear: (input) => invokeVoid(CHANNELS.draftsClear, input),
    },
    projects: {
      list: (input) => invoke(CHANNELS.projectsList, input),
      create: (input) => invoke(CHANNELS.projectsCreate, input),
      update: (input) => invoke(CHANNELS.projectsUpdate, input),
      archive: (input) => invoke(CHANNELS.projectsArchive, input),
      getActive: (input) => invoke(CHANNELS.projectsGetActive, input),
      setActive: (input) => invokeVoid(CHANNELS.projectsSetActive, input),
    },
  };
}

contextBridge.exposeInMainWorld('storyboard', createBridgeApi());