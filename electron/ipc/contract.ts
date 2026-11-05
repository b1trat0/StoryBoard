import { z } from 'zod';

/**
 * The contract between the renderer and the main process.
 *
 * This file is the only place an IPC payload shape is declared. Main validates
 * inbound payloads against the request schemas and validates outbound payloads
 * against the response schemas. The renderer is not trusted on the way in, and
 * the database is not trusted on the way out.
 *
 * Nothing in this file may import Node built-ins. It is bundled into the
 * renderer, so it must stay platform-neutral.
 */

// --- shared primitives ---------------------------------------------------

export const uuidSchema = z.string().uuid();

/** A database timestamp arrives over IPC as an ISO string, never as a Date. */
export const isoTimestampSchema = z.string().datetime();

const nonEmptyText = z.string().trim().min(1);

// --- enums ---------------------------------------------------------------
// These mirror the Postgres enum types in db/migrations/0001_init.sql.
// A value that exists here but not there would be caught at insert time.

export const entityTypeSchema = z.enum([
  'character',
  'place',
  'faction',
  'item',
  'rule',
]);

export const abilityKindSchema = z.enum(['power', 'technique']);

export const relationCategorySchema = z.enum([
  'social',
  'possession',
  'membership',
]);

export const chapterTypeSchema = z.enum([
  'chapter',
  'prologue',
  'epilogue',
  'interlude',
]);

export const chapterStatusSchema = z.enum(['outline', 'draft', 'done']);

export const factScopeTypeSchema = z.enum([
  'chapter',
  'entity',
  'relation',
  'global',
]);

export const factKindSchema = z.enum([
  'event',
  'character_fact',
  'new_entity',
  'relation_shift',
  'open_promise',
  'unresolved',
]);

export const factStatusSchema = z.enum(['draft', 'approved', 'rejected']);

export const glossaryKindSchema = z.enum([
  'name',
  'term',
  'honorific',
  'style',
]);

export const illustrationProviderSchema = z.enum([
  'catbox',
  'imgbb',
  'manual',
]);

// --- row shapes ----------------------------------------------------------

export const entitySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  type: entityTypeSchema,
  canonicalName: z.string(),
  aliases: z.array(z.string()),
  summary: z.string(),
  appearance: z.string(),
  personality: z.string(),
  backstory: z.string(),
  originEntityId: uuidSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const abilitySchema = z.object({
  id: uuidSchema,
  entityId: uuidSchema,
  kind: abilityKindSchema,
  name: z.string(),
  firstUseChapterId: uuidSchema.nullable(),
  cost: z.string(),
  limitation: z.string(),
  notes: z.string(),
  createdAt: isoTimestampSchema,
});

export const relationSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  fromEntityId: uuidSchema,
  toEntityId: uuidSchema,
  fromName: z.string(),
  toName: z.string(),
  category: relationCategorySchema,
  typeLabel: z.string(),
  sentiment: z.number().int().min(-5).max(5).nullable(),
  rank: z.string().nullable(),
  validFromChapterId: uuidSchema.nullable(),
  validToChapterId: uuidSchema.nullable(),
  isSecret: z.boolean(),
  notes: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const relationWithKnowledgeSchema = relationSchema.extend({
  knownBy: z.array(z.object({
    id: uuidSchema,
    canonicalName: z.string(),
  })),
});

export const volumeSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string(),
  ordinal: z.number().int().nonnegative(),
  summary: z.string(),
  createdAt: isoTimestampSchema,
});

export const arcSchema = z.object({
  id: uuidSchema,
  volumeId: uuidSchema,
  title: z.string(),
  ordinal: z.number().int().nonnegative(),
  summary: z.string(),
  createdAt: isoTimestampSchema,
});

/**
 * The tree carries chapter titles but not their prose.
 *
 * A serial novel's whole outline is small; every chapter's body_md together is not.
 * Loading all of it to render a list of titles would drag megabytes through IPC for
 * rows the author cannot see yet, so the tree omits body and the editor fetches one
 * chapter at a time with chapters:get.
 */
export const outlineChapterSummarySchema = z.object({
  id: uuidSchema,
  arcId: uuidSchema,
  title: z.string(),
  ordinal: z.number().int().nonnegative(),
  type: chapterTypeSchema,
  status: chapterStatusSchema,
  povEntityId: uuidSchema.nullable(),
  wordCount: z.number().int().nonnegative(),
  publishedAt: isoTimestampSchema.nullable(),
});

export const outlineArcNodeSchema = arcSchema.extend({
  chapters: z.array(outlineChapterSummarySchema),
});

export const outlineVolumeNodeSchema = volumeSchema.extend({
  arcs: z.array(outlineArcNodeSchema),
});

export const outlineTreeSchema = z.object({
  volumes: z.array(outlineVolumeNodeSchema),
});

export const outlineNodeKindSchema = z.enum(['volume', 'arc', 'chapter']);

/**
 * What a cascade would actually destroy, so the confirmation can name it.
 *
 * Deleting a chapter cascades to the facts sourced from it, and deleting an arc or
 * volume cascades to every chapter beneath it. Those facts are the reason this app
 * exists, so the author is shown the real numbers before confirming rather than
 * discovering the loss afterwards.
 */
export const outlineDeletionImpactSchema = z.object({
  kind: outlineNodeKindSchema,
  title: z.string(),
  childCount: z.number().int().nonnegative(),
  factCount: z.number().int().nonnegative(),
  illustrationCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
});

export const chapterSchema = z.object({
  id: uuidSchema,
  arcId: uuidSchema,
  title: z.string(),
  ordinal: z.number().int().nonnegative(),
  type: chapterTypeSchema,
  status: chapterStatusSchema,
  povEntityId: uuidSchema.nullable(),
  outlineGoal: z.string(),
  outlineConflict: z.string(),
  outlineOutcome: z.string(),
  outlineBeat: z.string(),
  bodyMd: z.string(),
  authorNotePre: z.string(),
  authorNotePost: z.string(),
  wordCount: z.number().int().nonnegative(),
  rrUrl: z.string().nullable(),
  publishedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

/**
 * A fact always carries a source chapter and a source quote. The schema repeats
 * the database constraint so an invalid fact is rejected at the boundary too,
 * but the CHECK in the migration remains the authority.
 */
export const factSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  scopeType: factScopeTypeSchema,
  scopeId: uuidSchema.nullable(),
  kind: factKindSchema,
  content: z.string(),
  sourceChapterId: uuidSchema,
  sourceQuote: z.string(),
  status: factStatusSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const glossaryTermSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  canonicalForm: z.string(),
  kind: glossaryKindSchema,
  notes: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const illustrationSchema = z.object({
  id: uuidSchema,
  chapterId: uuidSchema,
  afterParagraphIndex: z.number().int().nonnegative(),
  localPath: z.string(),
  remoteUrl: z.string().nullable(),
  provider: illustrationProviderSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  altText: z.string(),
  caption: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

// --- backups ---------------------------------------------------------------

/**
 * One verified dump on disk.
 *
 * The path is included because the author needs to know where to recover from,
 * not only that a backup happened. It is a path this process chose, so it is safe
 * to display; it is never a path the renderer supplied.
 */
export const backupFileInfoSchema = z.object({
  fileName: z.string(),
  filePath: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: isoTimestampSchema,
});

/** What the backup screen shows before the author presses anything. */
export const backupStatusSchema = z.object({
  /** Directory dumps are written to. */
  directory: z.string(),
  /** True when a second copy location is configured. */
  isMirrorConfigured: z.boolean(),
  /** Newest dump, or null when nothing has been backed up yet. */
  lastBackup: backupFileInfoSchema.nullable(),
});

export const runBackupRequestSchema = z.object({});

/**
 * Unsaved-prose state as the shell knows it.
 *
 * The renderer owns the draft buffer, and the main process owns the window. The only
 * way one can warn the other before closing is for the renderer to say, continuously
 * and cheaply, whether anything is unsaved.
 */
export const editorSetDirtyRequestSchema = z.object({ isDirty: z.boolean() });

/** The renderer confirming that prose was saved, so the window may close. */
export const confirmQuitRequestSchema = z.object({});

/**
 * A crash-recovery copy of the editor buffer.
 *
 * It is deliberately not a chapter: it lives in a file under the app's user data
 * directory, it is never read by the export pipeline, and it never becomes canon
 * without the author choosing to restore it. Its whole job is to survive the process
 * dying between keystrokes and the next explicit save.
 */
export const crashDraftSchema = z.object({
  chapterId: uuidSchema,
  savedAt: isoTimestampSchema,
  bodyMd: z.string(),
  authorNotePre: z.string(),
  authorNotePost: z.string(),
});

export const saveCrashDraftRequestSchema = z.object({
  chapterId: uuidSchema,
  bodyMd: z.string(),
  authorNotePre: z.string(),
  authorNotePost: z.string(),
});

export const readCrashDraftRequestSchema = z.object({ chapterId: uuidSchema });

export const clearCrashDraftRequestSchema = z.object({ chapterId: uuidSchema });

/** Status takes no arguments; the schema exists so the handler still validates. */
export const backupStatusRequestSchema = z.object({});

/**
 * What one backup wrote.
 *
 * Row counts are part of the result because "38 KB was written" tells the author
 * nothing. The counts are read from the live database immediately after the dump,
 * so a number here that looks wrong is itself a warning.
 */
export const backupRunResultSchema = z.object({
  file: backupFileInfoSchema,
  counts: z.object({
    chapters: z.number().int().nonnegative(),
    entities: z.number().int().nonnegative(),
    facts: z.number().int().nonnegative(),
    relations: z.number().int().nonnegative(),
  }),
  /** Expired dumps removed after this one was safely on disk. */
  removed: z.array(z.string()),
  /** Second copy, when a mirror directory is configured. */
  mirrorPath: z.string().nullable(),
});

// --- release preview --------------------------------------------------------

/**
 * How badly a preview problem affects publishing.
 *
 * `blocker` means Royal Road will refuse the chapter or the output will be visibly
 * wrong. `warning` means the chapter publishes but the author probably did not
 * intend it. The preview needs the distinction because a screen that lists fifteen
 * things as equally urgent is a screen the author learns to ignore.
 */
export const releaseSeveritySchema = z.enum(['blocker', 'warning']);

/** Machine-readable causes, so the preview can group and tests can assert. */
export const releaseWarningCodeSchema = z.enum([
  'not_finished',
  'too_short',
  'over_length',
  'unconverted_markdown',
  'unuploaded_image',
  'missing_alt',
  'unknown_dimensions',
  'anchor_out_of_range',
  'dropped_image',
  'dropped_author_note',
  'no_publishable_chapters',
]);

export const releaseWarningSchema = z.object({
  code: releaseWarningCodeSchema,
  severity: releaseSeveritySchema,
  message: z.string(),
});

/**
 * One block of the chapter body in publication order.
 *
 * Images are separate blocks rather than embedded in paragraph HTML because their
 * anchor is a paragraph index, so they have to be positioned between paragraphs
 * rather than inside one.
 */
export const releaseBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paragraph'),
    html: z.string(),
    paragraphIndex: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('image'),
    imageHtml: z.string(),
    captionHtml: z.string(),
    illustrationId: uuidSchema,
    afterParagraphIndex: z.number().int().nonnegative(),
    isMisplaced: z.boolean(),
  }),
]);

/**
 * What one chapter will look like once published.
 *
 * `preNoteHtml` and `postNoteHtml` are separate from `blocks` because Royal Road's
 * form renders the notes outside the chapter content, and because a note is
 * housekeeping rather than prose: it must not be caught up in paragraph anchoring
 * or in the character count that gates publication.
 */
export const chapterReleaseSchema = z.object({
  chapterId: uuidSchema,
  title: z.string(),
  preNoteHtml: z.string(),
  blocks: z.array(releaseBlockSchema),
  postNoteHtml: z.string(),
  wordCount: z.number().int().nonnegative(),
  isExcluded: z.boolean(),
  exclusionReason: z.string().nullable(),
  warnings: z.array(releaseWarningSchema),
});
export type Entity = z.infer<typeof entitySchema>;
export type Ability = z.infer<typeof abilitySchema>;
export type Relation = z.infer<typeof relationSchema>;
export type RelationWithKnowledge = z.infer<typeof relationWithKnowledgeSchema>;
export type Volume = z.infer<typeof volumeSchema>;
export type Arc = z.infer<typeof arcSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type OutlineChapterSummary = z.infer<typeof outlineChapterSummarySchema>;
export type OutlineArcNode = z.infer<typeof outlineArcNodeSchema>;
export type OutlineVolumeNode = z.infer<typeof outlineVolumeNodeSchema>;
export type Fact = z.infer<typeof factSchema>;
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;
export type Illustration = z.infer<typeof illustrationSchema>;
export type BackupFileInfo = z.infer<typeof backupFileInfoSchema>;
export type BackupStatus = z.infer<typeof backupStatusSchema>;
export type BackupRunResult = z.infer<typeof backupRunResultSchema>;
export type CrashDraft = z.infer<typeof crashDraftSchema>;

export type EntityType = z.infer<typeof entityTypeSchema>;
export type RelationCategory = z.infer<typeof relationCategorySchema>;
export type ChapterType = z.infer<typeof chapterTypeSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type FactKind = z.infer<typeof factKindSchema>;
export type FactStatus = z.infer<typeof factStatusSchema>;
export type GlossaryKind = z.infer<typeof glossaryKindSchema>;
export type IllustrationProvider = z.infer<typeof illustrationProviderSchema>;

// --- requests ------------------------------------------------------------

export const listEntitiesRequestSchema = z.object({
  projectId: uuidSchema,
  type: entityTypeSchema.optional(),
});

export const createEntityRequestSchema = z.object({
  projectId: uuidSchema,
  type: entityTypeSchema,
  canonicalName: nonEmptyText,
  aliases: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().default(''),
  originEntityId: uuidSchema.nullable().default(null),
});

/**
 * canonicalName is deliberately absent. Renaming an entity breaks every fact,
 * relation and chapter that references it, so the only way to change a name is
 * to add an alias.
 */
export const updateEntityRequestSchema = z.object({
  id: uuidSchema,
  summary: z.string().optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  backstory: z.string().optional(),
  originEntityId: uuidSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const addEntityAliasRequestSchema = z.object({
  id: uuidSchema,
  alias: nonEmptyText,
});

export const deleteByIdRequestSchema = z.object({ id: uuidSchema });

export const deleteEntityRequestSchema = z.object({ id: uuidSchema });

export const deleteRelationRequestSchema = z.object({ id: uuidSchema });

export const deleteFactRequestSchema = z.object({ id: uuidSchema });

export const listRelationsRequestSchema = z.object({
  projectId: uuidSchema,
  entityId: uuidSchema.optional(),
  category: relationCategorySchema.optional(),
});

export const createRelationRequestSchema = z
  .object({
    projectId: uuidSchema,
    fromEntityId: uuidSchema,
    toEntityId: uuidSchema,
    category: relationCategorySchema,
    typeLabel: nonEmptyText,
    sentiment: z.number().int().min(-5).max(5).nullable().default(null),
    rank: z.string().trim().min(1).nullable().default(null),
    validFromChapterId: uuidSchema.nullable().default(null),
    validToChapterId: uuidSchema.nullable().default(null),
    isSecret: z.boolean().default(false),
    notes: z.string().default(''),
    knownByEntityIds: z.array(uuidSchema).default([]),
  })
  .refine((v) => v.fromEntityId !== v.toEntityId, {
    message: 'An entity cannot have a relation with itself',
    path: ['toEntityId'],
  })
  .refine((v) => v.category === 'social' || v.sentiment === null, {
    message: 'sentiment applies only to social relations',
    path: ['sentiment'],
  })
  .refine((v) => v.category === 'membership' || v.rank === null, {
    message: 'rank applies only to membership relations',
    path: ['rank'],
  })
  .refine(
    (v) =>
      v.validFromChapterId === null ||
      v.validToChapterId === null ||
      v.validFromChapterId !== v.validToChapterId,
    {
      message: 'A relation cannot end in the same chapter it starts',
      path: ['validToChapterId'],
    },
  );

export const listFactsRequestSchema = z.object({
  projectId: uuidSchema,
  scopeType: factScopeTypeSchema.optional(),
  scopeId: uuidSchema.optional(),
  kind: factKindSchema.optional(),
  status: factStatusSchema.optional(),
});

export const createFactRequestSchema = z.object({
  projectId: uuidSchema,
  scopeType: factScopeTypeSchema,
  scopeId: uuidSchema.nullable(),
  kind: factKindSchema,
  content: nonEmptyText,
  sourceChapterId: uuidSchema,
  sourceQuote: nonEmptyText,
  status: factStatusSchema.default('draft'),
});

export const updateFactStatusRequestSchema = z.object({
  id: uuidSchema,
  status: factStatusSchema,
});

export const saveGlossaryTermRequestSchema = z.object({
  projectId: uuidSchema,
  canonicalForm: nonEmptyText,
  kind: glossaryKindSchema,
  notes: z.string().default(''),
});

export const saveIllustrationRequestSchema = z.object({
  id: uuidSchema,
  afterParagraphIndex: z.number().int().nonnegative(),
  altText: nonEmptyText,
  caption: z.string().default(''),
});

export const listChaptersRequestSchema = z.object({ arcId: uuidSchema });

export const listOutlineRequestSchema = z.object({ projectId: uuidSchema });

export const getChapterRequestSchema = z.object({ id: uuidSchema });

export const createVolumeRequestSchema = z.object({
  projectId: uuidSchema,
  title: nonEmptyText,
  summary: z.string().default(''),
});

export const updateVolumeRequestSchema = z.object({
  id: uuidSchema,
  title: nonEmptyText.optional(),
  summary: z.string().optional(),
});

export const createArcRequestSchema = z.object({
  volumeId: uuidSchema,
  title: nonEmptyText,
  summary: z.string().default(''),
});

export const updateArcRequestSchema = z.object({
  id: uuidSchema,
  title: nonEmptyText.optional(),
  summary: z.string().optional(),
});

export const createChapterRequestSchema = z.object({
  arcId: uuidSchema,
  title: nonEmptyText,
  type: chapterTypeSchema.default('chapter'),
  status: chapterStatusSchema.default('outline'),
});

export const deleteOutlineNodeRequestSchema = z.object({
  id: uuidSchema,
  kind: outlineNodeKindSchema,
});

export const describeOutlineDeletionRequestSchema = deleteOutlineNodeRequestSchema;

export const listIllustrationsRequestSchema = z.object({ chapterId: uuidSchema });

export const uploadIllustrationRequestSchema = z.object({ id: uuidSchema });

export const listGlossaryRequestSchema = z.object({ projectId: uuidSchema });

export const createIllustrationSlotRequestSchema = z.object({
  chapterId: uuidSchema,
  afterParagraphIndex: z.number().int().nonnegative(),
  localPath: nonEmptyText,
  altText: nonEmptyText,
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
});

/**
 * The authored text of a chapter, saved together on one explicit action.
 *
 * The two author notes travel with the body because they are the same kind of
 * thing: prose the author typed and wants published alongside the chapter. Keeping
 * them on a separate action would mean three save buttons for one page of text.
 *
 * All three are required rather than defaulted. A `.default('')` would let a caller
 * that forgets a field wipe the author's note without saying so, and a wiped note
 * is indistinguishable from one that was never written.
 */
export const saveChapterProseRequestSchema = z.object({
  id: uuidSchema,
  bodyMd: z.string(),
  authorNotePre: z.string(),
  authorNotePost: z.string(),
});

export const saveChapterOutlineRequestSchema = z.object({
  id: uuidSchema,
  title: nonEmptyText.optional(),
  type: chapterTypeSchema.optional(),
  status: chapterStatusSchema.optional(),
  povEntityId: uuidSchema.nullable().optional(),
  outlineGoal: z.string().optional(),
  outlineConflict: z.string().optional(),
  outlineOutcome: z.string().optional(),
  outlineBeat: z.string().optional(),
});

export type ListEntitiesRequest = z.infer<typeof listEntitiesRequestSchema>;
export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;
export type UpdateEntityRequest = z.infer<typeof updateEntityRequestSchema>;
export type ListRelationsRequest = z.infer<typeof listRelationsRequestSchema>;
export type CreateRelationRequest = z.infer<typeof createRelationRequestSchema>;
export type ListFactsRequest = z.infer<typeof listFactsRequestSchema>;
export type CreateFactRequest = z.infer<typeof createFactRequestSchema>;
export type SaveChapterProseRequest = z.infer<typeof saveChapterProseRequestSchema>;
export type SaveChapterOutlineRequest = z.infer<typeof saveChapterOutlineRequestSchema>;
export type CreateIllustrationSlotRequest = z.infer<
  typeof createIllustrationSlotRequestSchema
>;
export type SaveIllustrationRequest = z.infer<typeof saveIllustrationRequestSchema>;
export type SaveGlossaryTermRequest = z.infer<typeof saveGlossaryTermRequestSchema>;
export type ListChaptersRequest = z.infer<typeof listChaptersRequestSchema>;
export type ListOutlineRequest = z.infer<typeof listOutlineRequestSchema>;
export type GetChapterRequest = z.infer<typeof getChapterRequestSchema>;
export type CreateVolumeRequest = z.infer<typeof createVolumeRequestSchema>;
export type UpdateVolumeRequest = z.infer<typeof updateVolumeRequestSchema>;
export type CreateArcRequest = z.infer<typeof createArcRequestSchema>;
export type UpdateArcRequest = z.infer<typeof updateArcRequestSchema>;
export type CreateChapterRequest = z.infer<typeof createChapterRequestSchema>;
export type DeleteOutlineNodeRequest = z.infer<typeof deleteOutlineNodeRequestSchema>;
export type OutlineNodeKind = z.infer<typeof outlineNodeKindSchema>;
export type OutlineDeletionImpact = z.infer<typeof outlineDeletionImpactSchema>;
export type OutlineTree = z.infer<typeof outlineTreeSchema>;
/**
 * Input types, not output types.
 *
 * These schemas use .default(), which makes a field optional on the way in and
 * required on the way out. A service typed with z.infer would therefore force the
 * renderer to send `summary: ''` just to satisfy the type, when omitting it is
 * exactly what the default is for. z.input is the type the caller actually has.
 */
export type CreateVolumeInput = z.input<typeof createVolumeRequestSchema>;
export type CreateArcInput = z.input<typeof createArcRequestSchema>;
export type CreateChapterInput = z.input<typeof createChapterRequestSchema>;
export type ListIllustrationsRequest = z.infer<typeof listIllustrationsRequestSchema>;
export type ListGlossaryRequest = z.infer<typeof listGlossaryRequestSchema>;

/**
 * Preview one chapter's publishable form.
 *
 * Preview only, by design. Writing an export file is a separate deliberate step,
 * because Royal Road has no API and every release ends with the author pasting a
 * file into a browser form by hand.
 */
export const previewChapterRequestSchema = z.object({
  chapterId: uuidSchema,
});

/**
 * Export one volume as a Word document.
 *
 * A volume rather than a chapter, because that is the unit Royal Road's bulk import
 * consumes: it builds one chapter per document heading, so a per-chapter `.docx` would
 * be a manual process dressed up as an automated one.
 */
export const exportVolumeDocxRequestSchema = z.object({
  volumeId: uuidSchema,
});

/**
 * What an export produced.
 *
 * Cancelling is a separate outcome rather than an error. Closing a save dialog is a
 * decision the author made, and reporting it as a failure would train them to think the
 * export failed when it did exactly what they asked.
 *
 * The counts are on the result because a `.docx` is text only and cannot carry
 * illustrations or author notes. Without these numbers the author would have no way to
 * know that anything was left out until a reader pointed at the missing image.
 */
export const volumeDocxExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({
    status: z.literal('written'),
    filePath: z.string(),
    volumeTitle: z.string(),
    chapterCount: z.number().int().nonnegative(),
    excludedChapterCount: z.number().int().nonnegative(),
    droppedImageCount: z.number().int().nonnegative(),
    droppedNoteCount: z.number().int().nonnegative(),
    warnings: z.array(releaseWarningSchema),
  }),
]);

export type ReleaseWarning = z.infer<typeof releaseWarningSchema>;
export type ReleaseBlock = z.infer<typeof releaseBlockSchema>;
export type ChapterRelease = z.infer<typeof chapterReleaseSchema>;
export type PreviewChapterRequest = z.infer<typeof previewChapterRequestSchema>;
export type ExportVolumeDocxRequest = z.infer<typeof exportVolumeDocxRequestSchema>;
export type VolumeDocxExportResult = z.infer<typeof volumeDocxExportResultSchema>;

/**
 * The API surface exposed on window.storyboard. Every method returns a promise,
 * every argument is validated in main, every return value is validated in main
 * before it is sent back.
 */
export interface StoryBoardApi {
  entities: {
    list(input: ListEntitiesRequest): Promise<Entity[]>;
    create(input: CreateEntityRequest): Promise<Entity>;
    update(input: UpdateEntityRequest): Promise<Entity>;
    addAlias(input: { id: string; alias: string }): Promise<Entity>;
    remove(input: { id: string }): Promise<void>;
  };
  relations: {
    list(input: ListRelationsRequest): Promise<RelationWithKnowledge[]>;
    create(input: CreateRelationRequest): Promise<RelationWithKnowledge>;
    remove(input: { id: string }): Promise<void>;
  };
  facts: {
    list(input: ListFactsRequest): Promise<Fact[]>;
    create(input: CreateFactRequest): Promise<Fact>;
    setStatus(input: { id: string; status: FactStatus }): Promise<Fact>;
    remove(input: { id: string }): Promise<void>;
  };
  outline: {
    list(input: ListOutlineRequest): Promise<OutlineTree>;
    describeDeletion(input: { kind: OutlineNodeKind; id: string }): Promise<OutlineDeletionImpact>;
    createVolume(input: CreateVolumeInput): Promise<Volume>;
    updateVolume(input: UpdateVolumeRequest): Promise<Volume>;
    removeVolume(input: { id: string }): Promise<void>;
    createArc(input: CreateArcInput): Promise<Arc>;
    updateArc(input: UpdateArcRequest): Promise<Arc>;
    removeArc(input: { id: string }): Promise<void>;
  };
  chapters: {
    listByArc(input: { arcId: string }): Promise<Chapter[]>;
    get(input: { id: string }): Promise<Chapter>;
    create(input: CreateChapterInput): Promise<Chapter>;
    remove(input: { id: string }): Promise<void>;
    saveProse(input: SaveChapterProseRequest): Promise<Chapter>;
    saveOutline(input: SaveChapterOutlineRequest): Promise<Chapter>;
  };
  glossary: {
    list(input: { projectId: string }): Promise<GlossaryTerm[]>;
    save(input: {
      projectId: string;
      canonicalForm: string;
      kind: GlossaryKind;
      notes?: string;
    }): Promise<GlossaryTerm>;
  };
  illustrations: {
    listByChapter(input: { chapterId: string }): Promise<Illustration[]>;
    createSlot(input: CreateIllustrationSlotRequest): Promise<Illustration>;
    updateSlot(input: {
      id: string;
      afterParagraphIndex: number;
      altText: string;
      caption?: string;
    }): Promise<Illustration>;
    uploadToHost(input: { id: string }): Promise<Illustration>;
  };
  /**
   * The first step of the export pipeline, and the only one that writes nothing.
   * Every file later steps produce comes from what this shows, so it is reviewed
   * before anything is written to disk.
   */
  release: {
    previewChapter(input: PreviewChapterRequest): Promise<ChapterRelease>;
    exportVolumeDocx(input: ExportVolumeDocxRequest): Promise<VolumeDocxExportResult>;
  };
  /**
   * Manual backup of the manuscript database.
   *
   * Triggered by the author, not by a clock: a scheduled task that silently stops
   * working is indistinguishable from a scheduled task that works, and this app has
   * no server to notice the difference. Pressing the button returns what was written
   * and where, which is the whole point.
   */
  backup: {
    status(input: Record<string, never>): Promise<BackupStatus>;
    run(input: Record<string, never>): Promise<BackupRunResult>;
  };
  /**
   * Closing the window without losing prose.
   *
   * The shell reports whether anything is unsaved. Main intercepts `close`, asks the
   * author, and — when they choose to save — sends {@link onSaveAndQuit} so the
   * renderer can commit the exact buffer that is on screen before the window goes.
   */
  editorSafety: {
    setDirty(input: { isDirty: boolean }): Promise<void>;
    confirmQuit(input: Record<string, never>): Promise<void>;
    /** Subscribes to main's save-and-quit request. Returns an unsubscribe function. */
    onSaveAndQuit(handler: () => void): () => void;
  };
  /**
   * Crash-recovery copies of the editor buffer.
   *
   * Written to a file, never to the database, and only ever loaded back when the
   * author explicitly restores one.
   */
  drafts: {
    save(input: {
      chapterId: string;
      bodyMd: string;
      authorNotePre: string;
      authorNotePost: string;
    }): Promise<void>;
    read(input: { chapterId: string }): Promise<CrashDraft | null>;
    clear(input: { chapterId: string }): Promise<void>;
  };
}

declare global {
  interface Window {
    storyboard: StoryBoardApi;
  }
}
