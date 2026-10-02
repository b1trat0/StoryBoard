import type {
  Ability,
  Chapter,
  Entity,
  Fact,
  GlossaryTerm,
  Illustration,
  Relation,
} from '../ipc/contract.js';
import type {
  AbilityRow,
  ChapterRow,
  EntityRow,
  FactRow,
  GlossaryTermRow,
  IllustrationRow,
  RelationRow,
} from './schema.js';

/**
 * Database rows to contract DTOs.
 *
 * Postgres returns snake_case columns, Date objects and raw jsonb; the IPC
 * contract wants camelCase, ISO strings and plain objects. Converting in one
 * place means no consumer ever sees a raw row, and every mapper is annotated
 * with its contract return type, so a schema change that breaks the contract
 * fails the build instead of shipping.
 */

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function requiredIso(value: Date): string {
  return value.toISOString();
}

/** jsonb is typed `unknown` by drizzle; the contract wants a string-keyed object. */
function toMetadata(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function toEntityDto(row: EntityRow): Entity {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    canonicalName: row.canonicalName,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    summary: row.summary,
    appearance: row.appearance,
    personality: row.personality,
    backstory: row.backstory,
    originEntityId: row.originEntityId,
    metadata: toMetadata(row.metadata),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function toAbilityDto(row: AbilityRow): Ability {
  return {
    id: row.id,
    entityId: row.entityId,
    kind: row.kind,
    name: row.name,
    firstUseChapterId: row.firstUseChapterId,
    cost: row.cost,
    limitation: row.limitation,
    notes: row.notes,
    createdAt: requiredIso(row.createdAt),
  };
}

/**
 * Endpoint names come from a join, not from the relations row, so the input is
 * the row widened with the two resolved names.
 */
export type RelationRowWithNames = RelationRow & {
  fromName: string;
  toName: string;
};

export function toRelationDto(row: RelationRowWithNames): Relation {
  return {
    id: row.id,
    projectId: row.projectId,
    fromEntityId: row.fromEntityId,
    toEntityId: row.toEntityId,
    fromName: row.fromName,
    toName: row.toName,
    category: row.category,
    typeLabel: row.typeLabel,
    sentiment: row.sentiment,
    rank: row.rank,
    validFromChapterId: row.validFromChapterId,
    validToChapterId: row.validToChapterId,
    isSecret: row.isSecret,
    notes: row.notes,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function toFactDto(row: FactRow): Fact {
  return {
    id: row.id,
    projectId: row.projectId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    kind: row.kind,
    content: row.content,
    sourceChapterId: row.sourceChapterId,
    sourceQuote: row.sourceQuote,
    status: row.status,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function toChapterDto(row: ChapterRow): Chapter {
  return {
    id: row.id,
    arcId: row.arcId,
    title: row.title,
    ordinal: row.ordinal,
    type: row.type,
    status: row.status,
    povEntityId: row.povEntityId,
    outlineGoal: row.outlineGoal,
    outlineConflict: row.outlineConflict,
    outlineOutcome: row.outlineOutcome,
    outlineBeat: row.outlineBeat,
    bodyMd: row.bodyMd,
    wordCount: row.wordCount,
    rrUrl: row.rrUrl,
    publishedAt: toIso(row.publishedAt),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function toGlossaryTermDto(row: GlossaryTermRow): GlossaryTerm {
  return {
    id: row.id,
    projectId: row.projectId,
    canonicalForm: row.canonicalForm,
    kind: row.kind,
    notes: row.notes,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function toIllustrationDto(row: IllustrationRow): Illustration {
  return {
    id: row.id,
    chapterId: row.chapterId,
    afterParagraphIndex: row.afterParagraphIndex,
    localPath: row.localPath,
    remoteUrl: row.remoteUrl,
    provider: row.provider,
    width: row.width,
    height: row.height,
    altText: row.altText,
    caption: row.caption,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}