import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { chapters } from '../db/schema.js';
import { toChapterDto } from '../db/mappers.js';
import type {
  Chapter,
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