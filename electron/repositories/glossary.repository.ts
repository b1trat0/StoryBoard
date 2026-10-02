import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { glossaryTerms } from '../db/schema.js';
import { toGlossaryTermDto } from '../db/mappers.js';
import type { GlossaryTerm } from '../ipc/contract.js';

/**
 * Glossary data access.
 *
 * The glossary exists so a spell-checker cannot "correct" invented vocabulary.
 * That means the stored form is the canonical spelling, and lookups are
 * case-insensitive in the same way the unique index is.
 */

export interface SaveGlossaryTermInput {
  projectId: string;
  canonicalForm: string;
  kind: GlossaryTerm['kind'];
  notes: string;
}

export interface GlossaryRepository {
  list(projectId: string): Promise<GlossaryTerm[]>;
  findByForm(projectId: string, canonicalForm: string): Promise<GlossaryTerm | null>;
  /** Inserts on first sight of a form, updates notes on later saves. */
  upsert(input: SaveGlossaryTermInput): Promise<GlossaryTerm>;
}

export function createGlossaryRepository(): GlossaryRepository {
  return {
    async list(projectId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(glossaryTerms)
        .where(eq(glossaryTerms.projectId, projectId))
        .orderBy(asc(glossaryTerms.canonicalForm));
      return rows.map(toGlossaryTermDto);
    },

    async findByForm(projectId, canonicalForm) {
      const db = getDb();
      const rows = await db
        .select()
        .from(glossaryTerms)
        .where(
          and(
            eq(glossaryTerms.projectId, projectId),
            sql`lower(${glossaryTerms.canonicalForm}) = lower(${canonicalForm})`,
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toGlossaryTermDto(row);
    },

    async upsert(input) {
      const db = getDb();
      // ON CONFLICT is not usable against a functional unique index without a
      // matching index predicate, so the read-then-branch is the honest form.
      // It is safe here because a glossary form is edited by one person.
      const existing = await this.findByForm(input.projectId, input.canonicalForm);

      if (existing !== null) {
        const rows = await db
          .update(glossaryTerms)
          .set({ kind: input.kind, notes: input.notes, updatedAt: new Date() })
          .where(eq(glossaryTerms.id, existing.id))
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error(`Glossary term ${existing.id} was not found on update`);
        }
        return toGlossaryTermDto(row);
      }

      const rows = await db
        .insert(glossaryTerms)
        .values({
          projectId: input.projectId,
          canonicalForm: input.canonicalForm,
          kind: input.kind,
          notes: input.notes,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('Glossary insert returned no rows');
      }
      return toGlossaryTermDto(row);
    },
  };
}