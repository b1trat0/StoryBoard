import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { entities, facts, glossaryTerms } from '../db/schema.js';

/**
 * Recall across the whole work.
 *
 * The premise of the app is "stop rereading", and a list you can only scroll is not
 * recall. This searches the three things an author reaches for by name: entities
 * (including aliases), glossary terms, and facts with their quotes.
 *
 * Plain case-insensitive matching, no index, no ranking. At this scale — a serial's
 * cast and a few thousand facts — a sequential ILIKE is fast, and a full-text index
 * would add a migration and a maintenance burden for a search box used a few times a
 * session.
 */

export type SearchResultKind = 'entity' | 'glossary' | 'fact';

export interface SearchResult {
  kind: SearchResultKind;
  /** Row id, so the caller can select it. */
  id: string;
  /** The thing's name or first line. */
  title: string;
  /** A second line giving context. */
  detail: string;
  /** Chapter a fact came from, for jumping straight to the prose. */
  chapterId: string | null;
  /** Entity type, so the caller can switch to the right tab. */
  entityType: 'character' | 'place' | 'faction' | 'item' | 'rule' | null;
}

export interface SearchRepository {
  search(projectId: string, query: string): Promise<SearchResult[]>;
}

/** Keeps a broad query from returning the entire manuscript. */
const RESULT_LIMIT = 40;

export function createSearchRepository(): SearchRepository {
  return {
    async search(projectId, query) {
      const db = getDb();
      const pattern = `%${query}%`;

      const [entityRows, glossaryRows, factRows] = await Promise.all([
        db
          .select()
          .from(entities)
          .where(
            sql`${entities.projectId} = ${projectId} AND (
              ${entities.canonicalName} ILIKE ${pattern}
              OR EXISTS (SELECT 1 FROM unnest(${entities.aliases}) AS alias WHERE alias ILIKE ${pattern})
            )`,
          )
          .limit(RESULT_LIMIT),
        db
          .select()
          .from(glossaryTerms)
          .where(
            sql`${glossaryTerms.projectId} = ${projectId} AND ${glossaryTerms.canonicalForm} ILIKE ${pattern}`,
          )
          .limit(RESULT_LIMIT),
        db
          .select()
          .from(facts)
          .where(
            sql`${facts.projectId} = ${projectId} AND (${facts.content} ILIKE ${pattern} OR ${facts.sourceQuote} ILIKE ${pattern})`,
          )
          .limit(RESULT_LIMIT),
      ]);

      const results: SearchResult[] = [];

      for (const row of entityRows) {
        results.push({
          kind: 'entity',
          id: row.id,
          title: row.canonicalName,
          detail:
            row.aliases.length > 0
              ? `${row.type} · also ${row.aliases.join(', ')}`
              : row.type,
          chapterId: null,
          entityType: row.type,
        });
      }

      for (const row of glossaryRows) {
        results.push({
          kind: 'glossary',
          id: row.id,
          title: row.canonicalForm,
          detail: row.notes.trim().length > 0 ? row.notes : row.kind,
          chapterId: null,
          entityType: null,
        });
      }

      for (const row of factRows) {
        results.push({
          kind: 'fact',
          id: row.id,
          title: row.content,
          detail: row.sourceQuote,
          chapterId: row.sourceChapterId,
          entityType: null,
        });
      }

      return results.slice(0, RESULT_LIMIT);
    },
  };
}
