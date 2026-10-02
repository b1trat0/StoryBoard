import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { arcs, chapters, facts, illustrations, volumes } from '../db/schema.js';
import { toArcDto, toVolumeDto } from '../db/mappers.js';
import type { OutlineNodeKind } from '../ipc/contract.js';
import type {
  Arc,
  CreateArcInput,
  CreateVolumeInput,
  OutlineArcNode,
  OutlineDeletionImpact,
  OutlineTree,
  OutlineVolumeNode,
  UpdateArcRequest,
  UpdateVolumeRequest,
  Volume,
} from '../ipc/contract.js';

/**
 * Volumes and arcs: the outline scaffolding above the prose.
 *
 * Ordinals are unique per parent, so every insert reads the current maximum and
 * appends after it. That is safe here because there is exactly one author and one
 * window; a collision would surface as a unique-violation error rather than silent
 * corruption.
 *
 * Deleting any level cascades. volumes -> arcs -> chapters, and chapters -> facts
 * and illustrations. Nothing here deletes without the service having already told
 * the author what would be lost.
 */

export class OutlineNodeNotFoundError extends Error {
  constructor(kind: OutlineNodeKind, _id: string) {
    // The id is not in the message: this surfaces to the author as "that volume no
    // longer exists", and a raw uuid helps nobody reading it.
    super(`That ${kind} no longer exists`);
    this.name = 'OutlineNodeNotFoundError';
  }
}

export interface OutlineRepository {
  listTree(projectId: string): Promise<OutlineTree>;
  findVolumeById(id: string): Promise<Volume | null>;
  findArcById(id: string): Promise<Arc | null>;
  nextVolumeOrdinal(projectId: string): Promise<number>;
  createVolume(input: CreateVolumeInput): Promise<Volume>;
  updateVolume(input: UpdateVolumeRequest): Promise<Volume>;
  removeVolume(id: string): Promise<void>;
  nextArcOrdinal(volumeId: string): Promise<number>;
  createArc(input: CreateArcInput): Promise<Arc>;
  updateArc(input: UpdateArcRequest): Promise<Arc>;
  removeArc(id: string): Promise<void>;
  describeDeletion(input: { kind: OutlineNodeKind; id: string }): Promise<OutlineDeletionImpact>;
}

export function createOutlineRepository(): OutlineRepository {
  return {
    /**
     * Three flat reads assembled into a tree, rather than one recursive query per
     * node. The hierarchy is fixed at three levels and a serial novel has hundreds
     * of chapters, not thousands of volumes, so three round trips beat an N+1 walk
     * and stays readable in a log.
     */
    async listTree(projectId) {
      const db = getDb();
      const volumeRows = await db
        .select()
        .from(volumes)
        .where(eq(volumes.projectId, projectId))
        .orderBy(asc(volumes.ordinal));

      if (volumeRows.length === 0) {
        return { volumes: [] };
      }

      const volumeIds = volumeRows.map((row) => row.id);
      const arcRows = await db
        .select()
        .from(arcs)
        .where(inArray(arcs.volumeId, volumeIds))
        .orderBy(asc(arcs.ordinal));

      const arcIds = arcRows.map((row) => row.id);
      const chapterRows =
        arcIds.length === 0
          ? []
          : await db
              .select({
                id: chapters.id,
                arcId: chapters.arcId,
                title: chapters.title,
                ordinal: chapters.ordinal,
                type: chapters.type,
                status: chapters.status,
                povEntityId: chapters.povEntityId,
                wordCount: chapters.wordCount,
                publishedAt: chapters.publishedAt,
              })
              .from(chapters)
              .where(inArray(chapters.arcId, arcIds))
              .orderBy(asc(chapters.ordinal));

      const arcNodes: OutlineArcNode[] = arcRows.map((arc) => ({
        ...toArcDto(arc),
        chapters: chapterRows
          .filter((chapter) => chapter.arcId === arc.id)
          .map((chapter) => ({
            id: chapter.id,
            arcId: chapter.arcId,
            title: chapter.title,
            ordinal: chapter.ordinal,
            type: chapter.type,
            status: chapter.status,
            povEntityId: chapter.povEntityId,
            wordCount: chapter.wordCount,
            publishedAt: chapter.publishedAt?.toISOString() ?? null,
          })),
      }));

      const volumeNodes: OutlineVolumeNode[] = volumeRows.map((volume) => ({
        ...toVolumeDto(volume),
        arcs: arcNodes.filter((arc) => arc.volumeId === volume.id),
      }));

      return { volumes: volumeNodes };
    },

    async findVolumeById(id) {
      const db = getDb();
      const rows = await db.select().from(volumes).where(eq(volumes.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? null : toVolumeDto(row);
    },

    async findArcById(id) {
      const db = getDb();
      const rows = await db.select().from(arcs).where(eq(arcs.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? null : toArcDto(row);
    },

    async nextVolumeOrdinal(projectId) {
      const db = getDb();
      const rows = await db
        .select({ value: sql<number | null>`max(${volumes.ordinal})` })
        .from(volumes)
        .where(eq(volumes.projectId, projectId));
      // A null max means the table is empty for this project, so the first ordinal
      // is 1 rather than 0. Reading `?? -1` would start the count at 0 and leave the
      // first volume labelled "Volume 0" in the tree.
      return (rows[0]?.value ?? 0) + 1;
    },

    async createVolume(input) {
      const db = getDb();
      const ordinal = await this.nextVolumeOrdinal(input.projectId);
      const rows = await db
        .insert(volumes)
        .values({
          projectId: input.projectId,
          title: input.title.trim(),
          ordinal,
          summary: input.summary,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('the volume insert returned no row');
      }
      return toVolumeDto(row);
    },

    async updateVolume(input) {
      const db = getDb();
      const patch: Partial<typeof volumes.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.summary !== undefined) patch.summary = input.summary;

      const rows = await db.update(volumes).set(patch).where(eq(volumes.id, input.id)).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OutlineNodeNotFoundError('volume', input.id);
      }
      return toVolumeDto(row);
    },

    async removeVolume(id) {
      const db = getDb();
      const rows = await db
        .delete(volumes)
        .where(eq(volumes.id, id))
        .returning({ id: volumes.id });
      if (rows.length === 0) {
        throw new OutlineNodeNotFoundError('volume', id);
      }
    },

    async nextArcOrdinal(volumeId) {
      const db = getDb();
      const rows = await db
        .select({ value: sql<number | null>`max(${arcs.ordinal})` })
        .from(arcs)
        .where(eq(arcs.volumeId, volumeId));
      // Same first-is-one rule as volumes: `?? -1` would put an arc at ordinal 0.
      return (rows[0]?.value ?? 0) + 1;
    },

    async createArc(input) {
      const db = getDb();
      const ordinal = await this.nextArcOrdinal(input.volumeId);
      const rows = await db
        .insert(arcs)
        .values({
          volumeId: input.volumeId,
          title: input.title.trim(),
          ordinal,
          summary: input.summary,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('the arc insert returned no row');
      }
      return toArcDto(row);
    },

    async updateArc(input) {
      const db = getDb();
      const patch: Partial<typeof arcs.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.summary !== undefined) patch.summary = input.summary;

      const rows = await db.update(arcs).set(patch).where(eq(arcs.id, input.id)).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OutlineNodeNotFoundError('arc', input.id);
      }
      return toArcDto(row);
    },

    async removeArc(id) {
      const db = getDb();
      const rows = await db.delete(arcs).where(eq(arcs.id, id)).returning({ id: arcs.id });
      if (rows.length === 0) {
        throw new OutlineNodeNotFoundError('arc', id);
      }
    },

    /**
     * Counts everything a cascade would take with it.
     *
     * Fact count is the number that matters: a fact whose source chapter is deleted
     * is deleted with it, and facts are the reason the author keeps this app. The
     * caller shows these numbers and only then deletes.
     */
    async describeDeletion({ kind, id }) {
      const db = getDb();

      const chapterScope =
        kind === 'volume'
          ? await volumeChapterIds(db, id)
          : kind === 'arc'
            ? await chaptersInArcs(db, [id])
            : await directChapterIds(db, id);

      if (chapterScope.length === 0) {
        throw new OutlineNodeNotFoundError(kind, id);
      }

      const [factTotals] = await db
        .select({ value: count() })
        .from(facts)
        .where(inArray(facts.sourceChapterId, chapterScope));
      const [illustrationTotals] = await db
        .select({ value: count() })
        .from(illustrations)
        .where(inArray(illustrations.chapterId, chapterScope));
      const [wordTotals] = await db
        .select({ value: sql<number | string | null>`coalesce(sum(${chapters.wordCount}), 0)` })
        .from(chapters)
        .where(inArray(chapters.id, chapterScope));

      return {
        kind,
        title: await outlineTitle(db, kind, id),
        // What sits directly beneath the node, not the whole subtree: a volume
        // reports its arcs, an arc its chapters, and a chapter has no children.
        childCount:
          kind === 'volume'
            ? await countArcsInVolume(db, id)
            : kind === 'arc'
              ? chapterScope.length
              : 0,
        factCount: factTotals?.value ?? 0,
        illustrationCount: illustrationTotals?.value ?? 0,
        // `sum()` comes back as a Postgres numeric, which the driver hands over as a
        // string. The declared type says number, so without this conversion the
        // deletion dialog would render "3000" as "3" followed by "000" once a volume
        // passes a thousand words, and every sum would concatenate instead of add.
        wordCount: Number(wordTotals?.value ?? 0),
      };
    },
  };
}

/** Chapter ids beneath a volume, across all of its arcs. */
async function volumeChapterIds(db: ReturnType<typeof getDb>, volumeId: string): Promise<string[]> {
  const arcRows = await db.select({ id: arcs.id }).from(arcs).where(eq(arcs.volumeId, volumeId));
  return chaptersInArcs(db, arcRows.map((row) => row.id));
}

/** Chapter ids belonging to the given arcs. */
async function chaptersInArcs(db: ReturnType<typeof getDb>, arcIds: string[]): Promise<string[]> {
  if (arcIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(inArray(chapters.arcId, arcIds));
  return rows.map((row) => row.id);
}

/**
 * The chapter itself, if it exists.
 *
 * A separate lookup from chaptersInArcs on purpose: this takes a chapter id, where
 * that helper takes arc ids. Passing a chapter id through an `arc_id` filter returns
 * nothing, which reads as "that chapter no longer exists" and blocks the author from
 * ever deleting a chapter.
 */
async function directChapterIds(
  db: ReturnType<typeof getDb>,
  chapterId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  return rows.map((row) => row.id);
}

async function countArcsInVolume(db: ReturnType<typeof getDb>, volumeId: string): Promise<number> {
  const rows = await db.select({ value: count() }).from(arcs).where(eq(arcs.volumeId, volumeId));
  return rows[0]?.value ?? 0;
}

/** Resolves the human-facing title of the node about to be deleted. */
async function outlineTitle(
  db: ReturnType<typeof getDb>,
  kind: OutlineNodeKind,
  id: string,
): Promise<string> {
  // Spelled out per level rather than selected from a union of three table types:
  // Drizzle's query builder narrows on the concrete table, and the union form does
  // not survive that narrowing.
  if (kind === 'volume') {
    const rows = await db
      .select({ title: volumes.title })
      .from(volumes)
      .where(eq(volumes.id, id))
      .limit(1);
    return rows[0]?.title ?? '';
  }
  if (kind === 'arc') {
    const rows = await db
      .select({ title: arcs.title })
      .from(arcs)
      .where(eq(arcs.id, id))
      .limit(1);
    return rows[0]?.title ?? '';
  }
  const rows = await db
    .select({ title: chapters.title })
    .from(chapters)
    .where(eq(chapters.id, id))
    .limit(1);
  return rows[0]?.title ?? '';
}
