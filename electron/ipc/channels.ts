/**
 * IPC channel names.
 *
 * This module exists on its own because preload.ts loads in Electron's sandbox,
 * where Node's module system is not available. preload needs the channel names
 * and nothing else, so importing them from handlers.ts would drag pg, Drizzle and
 * every repository into a context that cannot load them, and the bridge would
 * silently fail to attach.
 *
 * Rule for this file: no imports. If a value belongs here it is a channel name,
 * and it must be inert data.
 */

export const CHANNELS = {
  entitiesList: 'entities:list',
  entitiesCreate: 'entities:create',
  entitiesUpdate: 'entities:update',
  entitiesAddAlias: 'entities:addAlias',
  entitiesRemove: 'entities:remove',
  relationsList: 'relations:list',
  relationsCreate: 'relations:create',
  relationsRemove: 'relations:remove',
  outlineList: 'outline:list',
  outlineDescribeDeletion: 'outline:describeDeletion',
  outlineCreateVolume: 'outline:createVolume',
  outlineUpdateVolume: 'outline:updateVolume',
  outlineRemoveVolume: 'outline:removeVolume',
  outlineCreateArc: 'outline:createArc',
  outlineUpdateArc: 'outline:updateArc',
  outlineRemoveArc: 'outline:removeArc',
  factsList: 'facts:list',
  factsCreate: 'facts:create',
  factsSetStatus: 'facts:setStatus',
  factsRemove: 'facts:remove',
  chaptersListByArc: 'chapters:listByArc',
  chaptersGet: 'chapters:get',
  chaptersCreate: 'chapters:create',
  chaptersRemove: 'chapters:remove',
  chaptersSaveProse: 'chapters:saveProse',
  chaptersSaveOutline: 'chapters:saveOutline',
  glossaryList: 'glossary:list',
  glossarySave: 'glossary:save',
  illustrationsListByChapter: 'illustrations:listByChapter',
  illustrationsCreateSlot: 'illustrations:createSlot',
  illustrationsUpdateSlot: 'illustrations:updateSlot',
  illustrationsUploadToHost: 'illustrations:uploadToHost',
  releasePreviewChapter: 'release:previewChapter',
  releaseExportVolumeDocx: 'release:exportVolumeDocx',
  backupStatus: 'backup:status',
  backupRun: 'backup:run',
  editorSetDirty: 'editor:setDirty',
  appConfirmQuit: 'app:confirmQuit',
  draftsSave: 'drafts:save',
  draftsRead: 'drafts:read',
  draftsClear: 'drafts:clear',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * Main-to-renderer events.
 *
 * Kept out of CHANNELS because that object is compared against the registered
 * handlers in a test: every channel there must be invokable. An event has no handler,
 * so listing it in the same object would make that guard lie.
 */
export const EVENTS = {
  editorSaveAndQuit: 'editor:saveAndQuit',
} as const;