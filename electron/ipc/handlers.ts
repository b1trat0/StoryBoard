import { z } from 'zod';
import { CHANNELS } from './channels.js';
import type { ChannelName } from './channels.js';
import { handleIpc } from '../controllers/ipc-handler.js';
import type { IpcResult } from '../controllers/ipc-handler.js';
import type { Logger } from '../lib/logger.js';
import { createCatboxHost } from '../interfaces/catbox.interface.js';
import { createChapterRepository } from '../repositories/chapter.repository.js';
import { createOutlineRepository } from '../repositories/outline.repository.js';
import { createEntityRepository } from '../repositories/entity.repository.js';
import { createFactRepository } from '../repositories/fact.repository.js';
import { createGlossaryRepository } from '../repositories/glossary.repository.js';
import { createIllustrationRepository } from '../repositories/illustration.repository.js';
import { createRelationRepository } from '../repositories/relation.repository.js';
import {
  createChapterService,
  createGlossaryService,
  createIllustrationService,
} from '../services/content.service.js';
import { createReleaseService } from '../services/release.service.js';
import { createOutlineService } from '../services/outline.service.js';
import {
  createEntityService,
  createFactService,
  createRelationService,
  RuleViolationError,
} from '../services/storyboard.service.js';
import {
  addEntityAliasRequestSchema,
  arcSchema,
  chapterReleaseSchema,
  createArcRequestSchema,
  createChapterRequestSchema,
  createEntityRequestSchema,
  createFactRequestSchema,
  createIllustrationSlotRequestSchema,
  createRelationRequestSchema,
  createVolumeRequestSchema,
  chapterSchema,
  deleteByIdRequestSchema,
  deleteEntityRequestSchema,
  deleteFactRequestSchema,
  deleteRelationRequestSchema,
  describeOutlineDeletionRequestSchema,
  entitySchema,
  factSchema,
  getChapterRequestSchema,
  glossaryTermSchema,
  illustrationSchema,
  listChaptersRequestSchema,
  listEntitiesRequestSchema,
  listFactsRequestSchema,
  listGlossaryRequestSchema,
  listIllustrationsRequestSchema,
  listOutlineRequestSchema,
  listRelationsRequestSchema,
  outlineDeletionImpactSchema,
  outlineTreeSchema,
  previewChapterRequestSchema,
  relationWithKnowledgeSchema,
  saveChapterProseRequestSchema,
  saveChapterOutlineRequestSchema,
  saveGlossaryTermRequestSchema,
  saveIllustrationRequestSchema,
  updateArcRequestSchema,
  updateEntityRequestSchema,
  updateFactStatusRequestSchema,
  updateVolumeRequestSchema,
  uploadIllustrationRequestSchema,
  volumeSchema,
} from './contract.js';

/**
 * Channel names and handler wiring.
 *
 * This module registers handlers and nothing else. Every handler is built by
 * handleIpc, which owns validation and error shaping, so no business rule can
 * appear here and no handler can be registered without both schemas.
 *
 * The names themselves live in channels.ts because preload loads in a sandbox
 * where this file's imports cannot resolve. They are re-exported here because
 * handlers.ts is the natural place for a reader to look for them.
 */

export { CHANNELS } from './channels.js';
export type { ChannelName } from './channels.js';

const entityListSchema = z.array(entitySchema);
const factListSchema = z.array(factSchema);
const relationListSchema = z.array(relationWithKnowledgeSchema);
const chapterListSchema = z.array(chapterSchema);
const glossaryListSchema = z.array(glossaryTermSchema);
const illustrationListSchema = z.array(illustrationSchema);

export function createHandlers(logger: Logger) {
  const entityService = createEntityService(createEntityRepository());
  const relationService = createRelationService(createRelationRepository());
  const factService = createFactService(createFactRepository());

  // The chapter repository is shared: an illustration slot is validated against
  // its chapter's real paragraph count, so the two must read the same data.
  const chapterRepository = createChapterRepository();
  const chapterService = createChapterService(chapterRepository);
  const illustrationService = createIllustrationService(
    createIllustrationRepository(),
    chapterRepository,
    createCatboxHost(),
  );
  const glossaryService = createGlossaryService(createGlossaryRepository());
  const outlineService = createOutlineService(createOutlineRepository());
  // The release preview reads committed chapter and illustration data, so it takes
  // the same shared chapter repository rather than a second one that could see a
  // different state.
  const releaseService = createReleaseService(
    chapterRepository,
    createIllustrationRepository(),
  );

  return {
    [CHANNELS.entitiesList]: handleIpc(
      logger,
      CHANNELS.entitiesList,
      listEntitiesRequestSchema,
      entityListSchema,
      (input) => entityService.list(input),
    ),

    [CHANNELS.entitiesCreate]: handleIpc(
      logger,
      CHANNELS.entitiesCreate,
      createEntityRequestSchema,
      entitySchema,
      (input) => entityService.create(input),
    ),

    [CHANNELS.entitiesUpdate]: handleIpc(
      logger,
      CHANNELS.entitiesUpdate,
      updateEntityRequestSchema,
      entitySchema,
      (input) => entityService.update(input),
    ),

    [CHANNELS.entitiesAddAlias]: handleIpc(
      logger,
      CHANNELS.entitiesAddAlias,
      addEntityAliasRequestSchema,
      entitySchema,
      (input) => entityService.addAlias(input),
    ),

    [CHANNELS.entitiesRemove]: handleIpc(
      logger,
      CHANNELS.entitiesRemove,
      deleteEntityRequestSchema,
      null,
      async (input) => {
        await entityService.remove(input);
      },
    ),

    [CHANNELS.relationsList]: handleIpc(
      logger,
      CHANNELS.relationsList,
      listRelationsRequestSchema,
      relationListSchema,
      (input) => relationService.list(input),
    ),

    [CHANNELS.relationsCreate]: handleIpc(
      logger,
      CHANNELS.relationsCreate,
      createRelationRequestSchema,
      relationWithKnowledgeSchema,
      (input) => relationService.create(input),
    ),

    [CHANNELS.relationsRemove]: handleIpc(
      logger,
      CHANNELS.relationsRemove,
      deleteRelationRequestSchema,
      null,
      async (input) => {
        await relationService.remove(input);
      },
    ),

    [CHANNELS.factsList]: handleIpc(
      logger,
      CHANNELS.factsList,
      listFactsRequestSchema,
      factListSchema,
      (input) => factService.list(input),
    ),

    [CHANNELS.factsCreate]: handleIpc(
      logger,
      CHANNELS.factsCreate,
      createFactRequestSchema,
      factSchema,
      (input) => factService.create(input),
    ),

    [CHANNELS.factsSetStatus]: handleIpc(
      logger,
      CHANNELS.factsSetStatus,
      updateFactStatusRequestSchema,
      factSchema,
      (input) => factService.setStatus(input),
    ),

    [CHANNELS.factsRemove]: handleIpc(
      logger,
      CHANNELS.factsRemove,
      deleteFactRequestSchema,
      null,
      async (input) => {
        await factService.remove(input);
      },
    ),

    [CHANNELS.chaptersListByArc]: handleIpc(
      logger,
      CHANNELS.chaptersListByArc,
      listChaptersRequestSchema,
      chapterListSchema,
      (input) => chapterService.listByArc(input),
    ),

    [CHANNELS.outlineList]: handleIpc(
      logger,
      CHANNELS.outlineList,
      listOutlineRequestSchema,
      outlineTreeSchema,
      (input) => outlineService.list(input),
    ),

    [CHANNELS.outlineDescribeDeletion]: handleIpc(
      logger,
      CHANNELS.outlineDescribeDeletion,
      describeOutlineDeletionRequestSchema,
      outlineDeletionImpactSchema,
      (input) => outlineService.describeDeletion(input),
    ),

    [CHANNELS.outlineCreateVolume]: handleIpc(
      logger,
      CHANNELS.outlineCreateVolume,
      createVolumeRequestSchema,
      volumeSchema,
      (input) => outlineService.createVolume(input),
    ),

    [CHANNELS.outlineUpdateVolume]: handleIpc(
      logger,
      CHANNELS.outlineUpdateVolume,
      updateVolumeRequestSchema,
      volumeSchema,
      (input) => outlineService.updateVolume(input),
    ),

    [CHANNELS.outlineRemoveVolume]: handleIpc(
      logger,
      CHANNELS.outlineRemoveVolume,
      deleteByIdRequestSchema,
      null,
      async (input) => {
        await outlineService.removeVolume(input);
      },
    ),

    [CHANNELS.outlineCreateArc]: handleIpc(
      logger,
      CHANNELS.outlineCreateArc,
      createArcRequestSchema,
      arcSchema,
      (input) => outlineService.createArc(input),
    ),

    [CHANNELS.outlineUpdateArc]: handleIpc(
      logger,
      CHANNELS.outlineUpdateArc,
      updateArcRequestSchema,
      arcSchema,
      (input) => outlineService.updateArc(input),
    ),

    [CHANNELS.outlineRemoveArc]: handleIpc(
      logger,
      CHANNELS.outlineRemoveArc,
      deleteByIdRequestSchema,
      null,
      async (input) => {
        await outlineService.removeArc(input);
      },
    ),

    [CHANNELS.chaptersGet]: handleIpc(
      logger,
      CHANNELS.chaptersGet,
      getChapterRequestSchema,
      chapterSchema,
      async (input) => {
        const chapter = await chapterRepository.findById(input.id);
        if (chapter === null) {
          throw new RuleViolationError('That chapter no longer exists.');
        }
        return chapter;
      },
    ),

    [CHANNELS.chaptersCreate]: handleIpc(
      logger,
      CHANNELS.chaptersCreate,
      createChapterRequestSchema,
      chapterSchema,
      (input) => chapterService.create(input),
    ),

    [CHANNELS.chaptersRemove]: handleIpc(
      logger,
      CHANNELS.chaptersRemove,
      deleteByIdRequestSchema,
      null,
      async (input) => {
        await chapterService.remove(input);
      },
    ),

    [CHANNELS.chaptersSaveProse]: handleIpc(
      logger,
      CHANNELS.chaptersSaveProse,
      saveChapterProseRequestSchema,
      chapterSchema,
      (input) => chapterService.saveProse(input),
    ),

    [CHANNELS.chaptersSaveOutline]: handleIpc(
      logger,
      CHANNELS.chaptersSaveOutline,
      saveChapterOutlineRequestSchema,
      chapterSchema,
      (input) => chapterService.saveOutline(input),
    ),

    [CHANNELS.glossaryList]: handleIpc(
      logger,
      CHANNELS.glossaryList,
      listGlossaryRequestSchema,
      glossaryListSchema,
      (input) => glossaryService.list(input),
    ),

    [CHANNELS.glossarySave]: handleIpc(
      logger,
      CHANNELS.glossarySave,
      saveGlossaryTermRequestSchema,
      glossaryTermSchema,
      (input) => glossaryService.save(input),
    ),

    [CHANNELS.illustrationsListByChapter]: handleIpc(
      logger,
      CHANNELS.illustrationsListByChapter,
      listIllustrationsRequestSchema,
      illustrationListSchema,
      (input) => illustrationService.listByChapter(input),
    ),

    [CHANNELS.illustrationsCreateSlot]: handleIpc(
      logger,
      CHANNELS.illustrationsCreateSlot,
      createIllustrationSlotRequestSchema,
      illustrationSchema,
      (input) => illustrationService.createSlot(input),
    ),

    [CHANNELS.illustrationsUpdateSlot]: handleIpc(
      logger,
      CHANNELS.illustrationsUpdateSlot,
      saveIllustrationRequestSchema,
      illustrationSchema,
      (input) => illustrationService.updateSlot(input),
    ),

    [CHANNELS.illustrationsUploadToHost]: handleIpc(
      logger,
      CHANNELS.illustrationsUploadToHost,
      uploadIllustrationRequestSchema,
      illustrationSchema,
      (input) => illustrationService.uploadToHost(input),
    ),

    [CHANNELS.releasePreviewChapter]: handleIpc(
      logger,
      CHANNELS.releasePreviewChapter,
      previewChapterRequestSchema,
      chapterReleaseSchema,
      (input) => releaseService.previewChapter(input),
    ),
  } satisfies Record<ChannelName, (raw: unknown) => Promise<IpcResult<unknown>>>;
}

export type Handlers = ReturnType<typeof createHandlers>;