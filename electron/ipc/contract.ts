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

export type Entity = z.infer<typeof entitySchema>;
export type Ability = z.infer<typeof abilitySchema>;
export type Relation = z.infer<typeof relationSchema>;
export type RelationWithKnowledge = z.infer<typeof relationWithKnowledgeSchema>;
export type Volume = z.infer<typeof volumeSchema>;
export type Arc = z.infer<typeof arcSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Fact = z.infer<typeof factSchema>;
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;
export type Illustration = z.infer<typeof illustrationSchema>;

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

export const saveChapterBodyRequestSchema = z.object({
  id: uuidSchema,
  bodyMd: z.string(),
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
export type SaveChapterBodyRequest = z.infer<typeof saveChapterBodyRequestSchema>;
export type SaveChapterOutlineRequest = z.infer<typeof saveChapterOutlineRequestSchema>;
export type CreateIllustrationSlotRequest = z.infer<
  typeof createIllustrationSlotRequestSchema
>;
export type SaveIllustrationRequest = z.infer<typeof saveIllustrationRequestSchema>;
export type SaveGlossaryTermRequest = z.infer<typeof saveGlossaryTermRequestSchema>;
export type ListChaptersRequest = z.infer<typeof listChaptersRequestSchema>;
export type ListIllustrationsRequest = z.infer<typeof listIllustrationsRequestSchema>;
export type ListGlossaryRequest = z.infer<typeof listGlossaryRequestSchema>;

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
  chapters: {
    listByArc(input: { arcId: string }): Promise<Chapter[]>;
    saveBody(input: SaveChapterBodyRequest): Promise<Chapter>;
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
}

declare global {
  interface Window {
    storyboard: StoryBoardApi;
  }
}