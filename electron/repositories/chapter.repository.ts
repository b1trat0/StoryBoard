import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { chapters } from '../db/schema.js';
import { toChapterDto } from '../db/mappers.js';
import type {
  Chapter,
  CreateChapterInput,
  SaveChapterProseRequest,
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
  findByIds(ids: readonly string[]): Promise<Chapter[]>;
  nextOrdinal(arcId: string): Promise<number>;
  create(input: CreateChapterInput): Promise<Chapter>;
  remove(id: string): Promise<void>;
  saveProse(input: SaveChapterProseRequest, wordCount: number): Promise<Chapter>;
  saveOutline(input: SaveChapterOutlineRequest): Promise<Chapter>;
  /**
   * Swaps a chapter with its neighbour in the same arc.
   *
   * A no-op at the edge of an arc: the buttons that call this have no way to know how
   * many siblings exist without another query, and refusing would surface as an error
   * for an action the author did not really take.
   */
  move(input: { id: string; direction: 'up' | 'down' }): Promise<void>;
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
     * Loads many chapters at once, for exporting a whole volume.
     *
     * A volume export needs every chapter in the volume, and reading them one at a
     * time turns a single export into one round trip per chapter. Order is not
     * meaningful here: the caller already knows the reading order from the outline and
     * assembles the document itself.
     *
     * @param ids - Chapter ids to load.
     * @returns The chapters that exist, which is fewer than `ids` if any were deleted
     *   between reading the outline and loading the text.
     */
    async findByIds(ids) {
      if (ids.length === 0) {
        return [];
      }
      const db = getDb();
      const rows = await db
        .select()
        .from(chapters)
        .where(inArray(chapters.id, [...ids]));
      return rows.map(toChapterDto);
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

    async saveProse(input, wordCount) {
      const db = getDb();
      const rows = await db
        .update(chapters)
        .set({
          bodyMd: input.bodyMd,
          authorNotePre: input.authorNotePre,
          authorNotePost: input.authorNotePost,
          wordCount,
          updatedAt: new Date(),
        })
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
      if (input.rrUrl !== undefined) {
        patch.rrUrl = input.rrUrl === null || input.rrUrl.trim() === '' ? null : input.rrUrl.trim();
      }
      if (input.publishedAt !== undefined) {
        patch.publishedAt = input.publishedAt === null ? null : new Date(input.publishedAt);
      }

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

    async move(input) {
      const db = getDb();
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(chapters)
          .where(eq(chapters.id, input.id))
          .limit(1);
        const chapter = rows[0];
        if (chapter === undefined) {
          throw new ChapterNotFoundError(input.id);
        }

        const targetOrdinal = chapter.ordinal + (input.direction === 'up' ? -1 : 1);
        const neighbourRows = await tx
          .select()
          .from(chapters)
          .where(
            and(eq(chapters.arcId, chapter.arcId), eq(chapters.ordinal, targetOrdinal)),
          )
          .limit(1);
        const neighbour = neighbourRows[0];
        if (neighbour === undefined) {
          return;
        }

        // The unique index on (arc_id, ordinal) means the two rows cannot simply swap
        // in two statements. A temporary ordinal far above any real position parks the
        // moving row out of the way for the length of the transaction.
        const parkingOrdinal = chapter.ordinal + 1_000_000;
        await tx
          .update(chapters)
          .set({ ordinal: parkingOrdinal })
          .where(eq(chapters.id, chapter.id));
        await tx
          .update(chapters)
          .set({ ordinal: chapter.ordinal })
          .where(eq(chapters.id, neighbour.id));
        await tx
          .update(chapters)
          .set({ ordinal: targetOrdinal })
          .where(eq(chapters.id, chapter.id));
      });
    },
  };
}