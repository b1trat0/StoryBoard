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
  factsList: 'facts:list',
  factsCreate: 'facts:create',
  factsSetStatus: 'facts:setStatus',
  factsRemove: 'facts:remove',
  chaptersListByArc: 'chapters:listByArc',
  chaptersSaveBody: 'chapters:saveBody',
  chaptersSaveOutline: 'chapters:saveOutline',
  glossaryList: 'glossary:list',
  glossarySave: 'glossary:save',
  illustrationsListByChapter: 'illustrations:listByChapter',
  illustrationsCreateSlot: 'illustrations:createSlot',
  illustrationsUpdateSlot: 'illustrations:updateSlot',
  illustrationsUploadToHost: 'illustrations:uploadToHost',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];