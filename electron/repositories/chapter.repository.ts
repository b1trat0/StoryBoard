import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { chapters } from '../db/schema.js';
import { toChapterDto } from '../db/mappers.js';
import type {
  Chapter,
  CreateChapterInput,
  SaveChapterBodyRequest,
  SaveChapterOutlineRequest,
} from '../ipc/contract.js';

/**
 * Chapter data access.
 *
 * The prose in body_md is the author's, and the editor is the only thing that
 * writes it. This repository never reformats it: markdown stays plain and
 * blank-line separated so the same file remains usable outside the app.
 */

export class ChapterNotFoundError extends Error {
  constructor(id: string) {
    super(`Chapter ${id} was not found`);
    this.name = 'ChapterNotFoundError';
  }
}

export interface ChapterRepository {
  listByArc(arcId: string): Promise<Chapter[]>;
  findById(id: string): Promise<Chapter | null>;
  nextOrdinal(arcId: string): Promise<number>;
  create(input: CreateChapterInput): Promise<Chapter>;
  remove(id: string): Promise<void>;
  saveBody(input: SaveChapterBodyRequest, wordCount: number): Promise<Chapter>;
  saveOutline(input: SaveChapterOutlineRequest): Promise<Chapter>;
}

export function createChapterRepository(): ChapterRepository {
  return {
    async listByArc(arcId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(chapters)
        .where(eq(chapters.arcId, arcId))
        .orderBy(asc(chapters.ordinal));
      return rows.map(toChapterDto);
    },

    async findById(id) {
      const db = getDb();
      const rows = await db.select().from(chapters).where(eq(chapters.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? null : toChapterDto(row);
    },

    /**
     * Appends after the last chapter in the arc.
     *
     * Ordinal is unique per arc, so the insert has to know where the end is. A
     * null maximum means the arc is empty and the first chapter is 1, not 0.
     */
    async nextOrdinal(arcId) {
      const db = getDb();
      const rows = await db
        .select({ value: sql<number | null>`max(${chapters.ordinal})` })
        .from(chapters)
        .where(eq(chapters.arcId, arcId));
      // `?? -1` would make the first chapter ordinal 0; chapters are numbered from 1.
      return (rows[0]?.value ?? 0) + 1;
    },

    async create(input) {
      const db = getDb();
      const ordinal = await this.nextOrdinal(input.arcId);
      const rows = await db
        .insert(chapters)
        .values({
          arcId: input.arcId,
          title: input.title.trim(),
          ordinal,
          type: input.type,
          status: input.status,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('the chapter insert returned no row');
      }
      return toChapterDto(row);
    },

    /**
     * Cascades to the chapter's facts and illustration slots. Callers must ask the
     * author what would be lost first: outline:describeDeletion exists for exactly
     * that, and a fact whose source chapter is gone is gone with it.
     */
    async remove(id) {
      const db = getDb();
      const rows = await db
        .delete(chapters)
        .where(eq(chapters.id, id))
        .returning({ id: chapters.id });
      if (rows.length === 0) {
        throw new ChapterNotFoundError(id);
      }
    },

    async saveBody(input, wordCount) {
      const db = getDb();
      const rows = await db
        .update(chapters)
        .set({ bodyMd: input.bodyMd, wordCount, updatedAt: new Date() })
        .where(eq(chapters.id, input.id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new ChapterNotFoundError(input.id);
      }
      return toChapterDto(row);
    },

    async saveOutline(input) {
      const db = getDb();
      const patch: Partial<typeof chapters.$inferInsert> = { updatedAt: new Date() };

      if (input.title !== undefined) patch.title = input.title;
      if (input.type !== undefined) patch.type = input.type;
      if (input.status !== undefined) patch.status = input.status;
      if (input.povEntityId !== undefined) patch.povEntityId = input.povEntityId;
      if (input.outlineGoal !== undefined) patch.outlineGoal = input.outlineGoal;
      if (input.outlineConflict !== undefined) patch.outlineConflict = input.outlineConflict;
      if (input.outlineOutcome !== undefined) patch.outlineOutcome = input.outlineOutcome;
      if (input.outlineBeat !== undefined) patch.outlineBeat = input.outlineBeat;

      const rows = await db
        .update(chapters)
        .set(patch)
        .where(eq(chapters.id, input.id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new ChapterNotFoundError(input.id);
      }
      return toChapterDto(row);
    },
  };
}