import { z } from 'zod';
import path from 'node:path';
import { CHANNELS } from './channels.js';
import type { ChannelName } from './channels.js';
import { handleIpc } from '../controllers/ipc-handler.js';
import type { IpcResult } from '../controllers/ipc-handler.js';
import type { Logger } from '../lib/logger.js';
import { createCatboxHost } from '../interfaces/catbox.interface.js';
import type { SaveFilePicker } from '../interfaces/file-dialog.interface.js';
import { createChapterRepository } from '../repositories/chapter.repository.js';
import { createOutlineRepository } from '../repositories/outline.repository.js';
import { createEntityRepository } from '../repositories/entity.repository.js';
import { createFactRepository } from '../repositories/fact.repository.js';
import { createGlossaryRepository } from '../repositories/glossary.repository.js';
import { createIllustrationRepository } from '../repositories/illustration.repository.js';
import { createProjectRepository } from '../repositories/project.repository.js';
import { createRelationRepository } from '../repositories/relation.repository.js';
import {
  createChapterService,
  createGlossaryService,
  createIllustrationService,
} from '../services/content.service.js';
import { createReleaseService } from '../services/release.service.js';
import { createOutlineService } from '../services/outline.service.js';
import { createBackupService } from '../services/backup.service.js';
import { createDraftRecoveryService } from '../services/draft-recovery.service.js';
import { createProjectService } from '../services/project.service.js';
import { createSettingsService } from '../services/settings.service.js';
import { createDockerBackupSource } from '../lib/docker-backup.js';
import { getBackupMirrorDir, getBackupsDir } from '../config.js';
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
  exportVolumeDocxRequestSchema,
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
  runBackupRequestSchema,
  backupStatusRequestSchema,
  backupRunResultSchema,
  backupStatusSchema,
  editorSetDirtyRequestSchema,
  confirmQuitRequestSchema,
  saveCrashDraftRequestSchema,
  readCrashDraftRequestSchema,
  clearCrashDraftRequestSchema,
  crashDraftSchema,
  projectSchema,
  listProjectsRequestSchema,
  createProjectRequestSchema,
  updateProjectRequestSchema,
  archiveProjectRequestSchema,
  activeProjectSchema,
  setActiveProjectRequestSchema,
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
  volumeDocxExportResultSchema,
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
const projectListSchema = z.array(projectSchema);

/**
 * What the window needs from the shell when it is closing.
 *
 * Passed in rather than imported so the handlers stay free of Electron window state
 * and remain constructible in tests.
 */
export interface QuitControls {
  /** Records whether the draft buffer holds unsaved prose. */
  setDirty(isDirty: boolean): void;
  /** The renderer saved successfully; the window may close. */
  confirmQuit(): void;
}

export function createHandlers(
  logger: Logger,
  saveFile: SaveFilePicker,
  appRoot: string = process.cwd(),
  quit?: QuitControls,
  draftsDir: string = path.join(process.cwd(), 'drafts'),
  settingsPath: string = path.join(process.cwd(), 'settings.json'),
) {
  const entityService = createEntityService(createEntityRepository());
  const relationService = createRelationService(createRelationRepository());
  const factService = createFactService(createFactRepository());

  // The chapter repository is shared: an illustration slot is validated against
  // its chapter's real paragraph count, so the two must read the same data.
  const chapterRepository = createChapterRepository();
  const chapterService = createChapterService(chapterRepository);
  const illustrationRepository = createIllustrationRepository();
  const illustrationService = createIllustrationService(
    illustrationRepository,
    chapterRepository,
    createCatboxHost(),
  );
  const glossaryService = createGlossaryService(createGlossaryRepository());
  const outlineRepository = createOutlineRepository();
  const outlineService = createOutlineService(outlineRepository);
  // The release pipeline reads committed chapter and illustration data, so it takes
  // the same shared repositories rather than second ones that could see a different
  // state. The outline is needed as well: a volume export needs to know which
  // chapters belong to the volume and in what order.
  const releaseService = createReleaseService(
    chapterRepository,
    illustrationRepository,
    outlineRepository,
    saveFile,
  );
  // The backup service needs the application directory only for its guard against
  // writing dumps inside the repo; it reaches the database through its own source so
  // the same code path runs in the app and from `npm run db:dump`.
  const backupService = createBackupService(createDockerBackupSource(), {
    backupsDir: getBackupsDir(),
    repoRoot: appRoot,
    mirrorDir: getBackupMirrorDir(),
  });
  // Crash drafts live in the user data directory, not the repository: they are
  // transient copies of unsaved prose, not content the app publishes or exports.
  const draftService = createDraftRecoveryService(draftsDir);
  // Which work was last open is a preference, not manuscript data, so it lives in a
  // settings file rather than the database.
  const settingsService = createSettingsService(settingsPath);
  const projectService = createProjectService(
    createProjectRepository(),
    settingsService,
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

    [CHANNELS.releaseExportVolumeDocx]: handleIpc(
      logger,
      CHANNELS.releaseExportVolumeDocx,
      exportVolumeDocxRequestSchema,
      volumeDocxExportResultSchema,
      (input) => releaseService.exportVolumeDocx(input),
    ),

    [CHANNELS.backupStatus]: handleIpc(
      logger,
      CHANNELS.backupStatus,
      backupStatusRequestSchema,
      backupStatusSchema,
      () => backupService.status(),
    ),

    [CHANNELS.backupRun]: handleIpc(
      logger,
      CHANNELS.backupRun,
      runBackupRequestSchema,
      backupRunResultSchema,
      () => backupService.run(),
    ),

    [CHANNELS.editorSetDirty]: handleIpc(
      logger,
      CHANNELS.editorSetDirty,
      editorSetDirtyRequestSchema,
      null,
      async (input) => {
        quit?.setDirty(input.isDirty);
      },
    ),

    [CHANNELS.appConfirmQuit]: handleIpc(
      logger,
      CHANNELS.appConfirmQuit,
      confirmQuitRequestSchema,
      null,
      async () => {
        quit?.confirmQuit();
      },
    ),

    [CHANNELS.draftsSave]: handleIpc(
      logger,
      CHANNELS.draftsSave,
      saveCrashDraftRequestSchema,
      null,
      async (input) => {
        await draftService.save(input);
      },
    ),

    [CHANNELS.draftsRead]: handleIpc(
      logger,
      CHANNELS.draftsRead,
      readCrashDraftRequestSchema,
      crashDraftSchema.nullable(),
      (input) => draftService.read(input.chapterId),
    ),

    [CHANNELS.draftsClear]: handleIpc(
      logger,
      CHANNELS.draftsClear,
      clearCrashDraftRequestSchema,
      null,
      async (input) => {
        await draftService.clear(input.chapterId);
      },
    ),

    [CHANNELS.projectsList]: handleIpc(
      logger,
      CHANNELS.projectsList,
      listProjectsRequestSchema,
      projectListSchema,
      (input) => projectService.list(input),
    ),

    [CHANNELS.projectsCreate]: handleIpc(
      logger,
      CHANNELS.projectsCreate,
      createProjectRequestSchema,
      projectSchema,
      (input) => projectService.create(input),
    ),

    [CHANNELS.projectsUpdate]: handleIpc(
      logger,
      CHANNELS.projectsUpdate,
      updateProjectRequestSchema,
      projectSchema,
      (input) => projectService.update(input),
    ),

    [CHANNELS.projectsArchive]: handleIpc(
      logger,
      CHANNELS.projectsArchive,
      archiveProjectRequestSchema,
      projectSchema,
      (input) => projectService.archive(input),
    ),

    [CHANNELS.projectsGetActive]: handleIpc(
      logger,
      CHANNELS.projectsGetActive,
      runBackupRequestSchema,
      activeProjectSchema,
      () => projectService.getActive(),
    ),

    [CHANNELS.projectsSetActive]: handleIpc(
      logger,
      CHANNELS.projectsSetActive,
      setActiveProjectRequestSchema,
      null,
      async (input) => {
        await projectService.setActive(input);
      },
    ),
  } satisfies Record<ChannelName, (raw: unknown) => Promise<IpcResult<unknown>>>;
}

export type Handlers = ReturnType<typeof createHandlers>;
