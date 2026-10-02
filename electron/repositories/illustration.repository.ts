import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { illustrations } from '../db/schema.js';
import { toIllustrationDto } from '../db/mappers.js';
import type {
  CreateIllustrationSlotRequest,
  Illustration,
} from '../ipc/contract.js';

/**
 * Illustration slot data access.
 *
 * The local file is the source of truth and the remote URL is derived from it,
 * so both are stored: a slot with a local path and a null URL is an unuploaded
 * slot, and the UI must be able to see that state rather than discover it at
 * export time.
 */

export class IllustrationNotFoundError extends Error {
  constructor(id: string) {
    super(`Illustration ${id} was not found`);
    this.name = 'IllustrationNotFoundError';
  }
}

/** The shape of a Catbox upload, reduced to what the app stores afterwards. */
export interface UploadOutcome {
  remoteUrl: string;
  provider: 'catbox' | 'imgbb' | 'manual';
}

export interface SaveIllustrationSlotInput {
  id: string;
  afterParagraphIndex: number;
  altText: string;
  caption: string;
}

export interface IllustrationRepository {
  listByChapter(chapterId: string): Promise<Illustration[]>;
  findById(id: string): Promise<Illustration | null>;
  createSlot(input: CreateIllustrationSlotRequest): Promise<Illustration>;
  saveSlot(input: SaveIllustrationSlotInput): Promise<Illustration>;
  markUploaded(id: string, outcome: UploadOutcome): Promise<Illustration>;
  remove(id: string): Promise<void>;
}

export function createIllustrationRepository(): IllustrationRepository {
  return {
    async listByChapter(chapterId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(illustrations)
        .where(eq(illustrations.chapterId, chapterId))
        .orderBy(illustrations.afterParagraphIndex);
      return rows.map(toIllustrationDto);
    },

    async findById(id) {
      const db = getDb();
      const rows = await db
        .select()
        .from(illustrations)
        .where(eq(illustrations.id, id))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toIllustrationDto(row);
    },

    async createSlot(input) {
      const db = getDb();
      const rows = await db
        .insert(illustrations)
        .values({
          chapterId: input.chapterId,
          afterParagraphIndex: input.afterParagraphIndex,
          localPath: input.localPath,
          altText: input.altText,
          width: input.width,
          height: input.height,
          // A new slot has never been uploaded; provider stays 'manual' until an
          // upload actually succeeds and replaces it.
          provider: 'manual',
        })
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new Error('Illustration insert returned no rows');
      }
      return toIllustrationDto(row);
    },

    async saveSlot(input) {
      const db = getDb();
      const rows = await db
        .update(illustrations)
        .set({
          afterParagraphIndex: input.afterParagraphIndex,
          altText: input.altText,
          caption: input.caption,
          updatedAt: new Date(),
        })
        .where(eq(illustrations.id, input.id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new IllustrationNotFoundError(input.id);
      }
      return toIllustrationDto(row);
    },

    async markUploaded(id, outcome) {
      const db = getDb();
      const rows = await db
        .update(illustrations)
        .set({
          remoteUrl: outcome.remoteUrl,
          provider: outcome.provider,
          updatedAt: new Date(),
        })
        .where(eq(illustrations.id, id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new IllustrationNotFoundError(id);
      }
      return toIllustrationDto(row);
    },

    async remove(id) {
      const db = getDb();
      await db.delete(illustrations).where(eq(illustrations.id, id));
    },
  };
}