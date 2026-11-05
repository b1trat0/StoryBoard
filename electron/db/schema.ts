import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  text,
  integer,
  smallint,
  boolean,
  uuid,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Drizzle schema mirroring db/migrations/0001_init.sql.
 *
 * The SQL migrations remain the source of truth. This file exists so repositories
 * get typed rows without a code generation step. It deliberately does NOT
 * declare the CHECK constraints, because those are enforced by Postgres and
 * cannot be weakened from here. A constraint that only existed in TypeScript
 * would not protect the data.
 */

export const entityTypeEnum = pgEnum('entity_type', [
  'character',
  'place',
  'faction',
  'item',
  'rule',
]);

/** What kind of work a project is. Not decoration: export defaults read it. */
export const projectKindEnum = pgEnum('project_kind', ['light_novel', 'novel']);

/** Which publishing rules apply to a work. */
export const exportProfileEnum = pgEnum('export_profile', ['royal_road', 'plain']);

export const abilityKindEnum = pgEnum('ability_kind', ['power', 'technique']);

export const relationCategoryEnum = pgEnum('relation_category', [
  'social',
  'possession',
  'membership',
]);

export const chapterTypeEnum = pgEnum('chapter_type', [
  'chapter',
  'prologue',
  'epilogue',
  'interlude',
]);

export const chapterStatusEnum = pgEnum('chapter_status', [
  'outline',
  'draft',
  'done',
]);

export const factScopeTypeEnum = pgEnum('fact_scope_type', [
  'chapter',
  'entity',
  'relation',
  'global',
]);

export const factKindEnum = pgEnum('fact_kind', [
  'event',
  'character_fact',
  'new_entity',
  'relation_shift',
  'open_promise',
  'unresolved',
]);

export const factStatusEnum = pgEnum('fact_status', [
  'draft',
  'approved',
  'rejected',
]);

export const glossaryKindEnum = pgEnum('glossary_kind', [
  'name',
  'term',
  'honorific',
  'style',
]);

export const illustrationProviderEnum = pgEnum('illustration_provider', [
  'catbox',
  'imgbb',
  'manual',
]);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  kind: projectKindEnum('kind').notNull().default('light_novel'),
  exportProfile: exportProfileEnum('export_profile').notNull().default('royal_road'),
  summary: text('summary').notNull().default(''),
  /** Where this work's files live. Empty means the app default. */
  storageRoot: text('storage_root').notNull().default(''),
  archivedAt: timestamp('archived_at', { withTimezone: true }),  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const volumes = pgTable(
  'volumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ordinal: integer('ordinal').notNull(),
    summary: text('summary').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('volumes_project_ordinal_uq').on(t.projectId, t.ordinal)],
);

export const arcs = pgTable(
  'arcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    volumeId: uuid('volume_id')
      .notNull()
      .references(() => volumes.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ordinal: integer('ordinal').notNull(),
    summary: text('summary').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('arcs_volume_ordinal_uq').on(t.volumeId, t.ordinal)],
);

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: entityTypeEnum('type').notNull(),
    canonicalName: text('canonical_name').notNull(),
    // `.array()` matters: the SQL column is text[], and declaring plain text()
    // would make drizzle type a string[] row as a string. That silently breaks
    // every alias read and every array_append.
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    summary: text('summary').notNull().default(''),
    appearance: text('appearance').notNull().default(''),
    personality: text('personality').notNull().default(''),
    backstory: text('backstory').notNull().default(''),
    // Self-reference: an entity's origin is another entity, usually a place.
    // The AnyPgColumn annotation breaks the circular type inference.
    originEntityId: uuid('origin_entity_id').references(
      (): AnyPgColumn => entities.id,
      { onDelete: 'set null' },
    ),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive: two entities differing only by capitalisation would
    // split their facts across two records.
    uniqueIndex('entities_project_canonical_name_uq').on(
      t.projectId,
      sql`lower(${t.canonicalName})`,
    ),
    index('entities_project_type_idx').on(t.projectId, t.type),
  ],
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    arcId: uuid('arc_id')
      .notNull()
      .references(() => arcs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ordinal: integer('ordinal').notNull(),
    type: chapterTypeEnum('type').notNull().default('chapter'),
    status: chapterStatusEnum('status').notNull().default('outline'),
    povEntityId: uuid('pov_entity_id').references(() => entities.id, {
      onDelete: 'set null',
    }),
    outlineGoal: text('outline_goal').notNull().default(''),
    outlineConflict: text('outline_conflict').notNull().default(''),
    outlineOutcome: text('outline_outcome').notNull().default(''),
    outlineBeat: text('outline_beat').notNull().default(''),
    bodyMd: text('body_md').notNull().default(''),
    authorNotePre: text('author_note_pre').notNull().default(''),
    authorNotePost: text('author_note_post').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
    rrUrl: text('rr_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chapters_arc_ordinal_uq').on(t.arcId, t.ordinal),
    index('chapters_pov_idx').on(t.povEntityId),
  ],
);

export const entityAbilities = pgTable(
  'entity_abilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    kind: abilityKindEnum('kind').notNull(),
    name: text('name').notNull(),
    firstUseChapterId: uuid('first_use_chapter_id').references(() => chapters.id, {
      onDelete: 'set null',
    }),
    cost: text('cost').notNull().default(''),
    limitation: text('limitation').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('entity_abilities_entity_kind_name_uq').on(
      t.entityId,
      t.kind,
      sql`lower(${t.name})`,
    ),
    // Partial index: only learned-but-unused or used techniques matter to a query.
    index('entity_abilities_first_use_idx')
      .on(t.firstUseChapterId)
      .where(sql`${t.firstUseChapterId} is not null`),
  ],
);

export const relations = pgTable(
  'relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromEntityId: uuid('from_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    toEntityId: uuid('to_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    category: relationCategoryEnum('category').notNull(),
    typeLabel: text('type_label').notNull(),
    sentiment: smallint('sentiment'),
    rank: text('rank'),
    validFromChapterId: uuid('valid_from_chapter_id').references(() => chapters.id, {
      onDelete: 'set null',
    }),
    validToChapterId: uuid('valid_to_chapter_id').references(() => chapters.id, {
      onDelete: 'set null',
    }),
    isSecret: boolean('is_secret').notNull().default(false),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('relations_from_idx').on(t.fromEntityId),
    index('relations_to_idx').on(t.toEntityId),
    index('relations_project_category_idx').on(t.projectId, t.category),
  ],
);

export const relationKnownBy = pgTable(
  'relation_known_by',
  {
    relationId: uuid('relation_id')
      .notNull()
      .references(() => relations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.relationId, t.entityId] }),
    index('relation_known_by_entity_idx').on(t.entityId),
  ],
);

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    scopeType: factScopeTypeEnum('scope_type').notNull(),
    // Polymorphic, so it cannot be a foreign key. The migration enforces that
    // non-global rows carry one.
    scopeId: uuid('scope_id'),
    kind: factKindEnum('kind').notNull(),
    content: text('content').notNull(),
    sourceChapterId: uuid('source_chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    sourceQuote: text('source_quote').notNull(),
    status: factStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('facts_scope_idx').on(t.scopeType, t.scopeId),
    index('facts_project_status_idx').on(t.projectId, t.status),
    index('facts_source_chapter_idx').on(t.sourceChapterId),
    index('facts_kind_idx').on(t.kind),
  ],
);

export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    canonicalForm: text('canonical_form').notNull(),
    kind: glossaryKindEnum('kind').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('glossary_terms_project_form_uq').on(
      t.projectId,
      sql`lower(${t.canonicalForm})`,
    ),
  ],
);

export const illustrations = pgTable(
  'illustrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    afterParagraphIndex: integer('after_paragraph_index').notNull(),
    localPath: text('local_path').notNull(),
    remoteUrl: text('remote_url'),
    provider: illustrationProviderEnum('provider').notNull().default('manual'),
    width: integer('width'),
    height: integer('height'),
    altText: text('alt_text').notNull(),
    caption: text('caption').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('illustrations_chapter_anchor_idx').on(t.chapterId, t.afterParagraphIndex),
    // Partial index on exactly the state the UI must surface: a local file with
    // no live URL cannot produce a working <img> in an export.
    index('illustrations_unuploaded_idx')
      .on(t.chapterId)
      .where(sql`${t.remoteUrl} is null`),
  ],
);

export type ProjectRow = InferSelectModel<typeof projects>;
export type VolumeRow = InferSelectModel<typeof volumes>;
export type ArcRow = InferSelectModel<typeof arcs>;
export type EntityRow = InferSelectModel<typeof entities>;
export type ChapterRow = InferSelectModel<typeof chapters>;
export type AbilityRow = InferSelectModel<typeof entityAbilities>;
export type RelationRow = InferSelectModel<typeof relations>;
export type FactRow = InferSelectModel<typeof facts>;
export type GlossaryTermRow = InferSelectModel<typeof glossaryTerms>;
export type IllustrationRow = InferSelectModel<typeof illustrations>;

export const schema = {
  projects,
  volumes,
  arcs,
  entities,
  chapters,
  entityAbilities,
  relations,
  relationKnownBy,
  facts,
  glossaryTerms,
  illustrations,
};