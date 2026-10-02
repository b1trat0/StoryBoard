import { and, asc, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { entities } from '../db/schema.js';
import { toEntityDto } from '../db/mappers.js';
import type {
  CreateEntityRequest,
  Entity,
  ListEntitiesRequest,
  UpdateEntityRequest,
} from '../ipc/contract.js';

/**
 * Entity data access.
 *
 * No business rules live here: this module moves rows and nothing else. Rules
 * such as "an alias may not shadow another entity" belong to the service layer,
 * even when the database enforces them as well.
 */

export interface EntityRepository {
  list(input: ListEntitiesRequest): Promise<Entity[]>;
  findById(id: string): Promise<Entity | null>;
  /** Case-insensitive canonical-name lookup, used for collision checks. */
  findByCanonicalName(projectId: string, name: string): Promise<Entity | null>;
  /**
   * True when any other entity in the project already uses `alias` in its alias
   * list. Two entities answering to one name makes prose search ambiguous.
   *
   * @param excludingId - The entity being edited, whose own aliases must not
   *   count as a conflict. `null` on create, where no entity exists yet. It is
   *   nullable rather than a sentinel string because the column is a uuid and an
   *   empty string is not a valid one.
   */
  isAliasTaken(
    projectId: string,
    alias: string,
    excludingId: string | null,
  ): Promise<boolean>;
  create(input: CreateEntityRequest): Promise<Entity>;
  update(input: UpdateEntityRequest): Promise<Entity>;
  appendAlias(id: string, alias: string): Promise<Entity>;
  remove(id: string): Promise<void>;
}

export function createEntityRepository(): EntityRepository {
  return {
    async list(input) {
      const db = getDb();
      const conditions: SQL[] = [eq(entities.projectId, input.projectId)];
      if (input.type !== undefined) {
        conditions.push(eq(entities.type, input.type));
      }

      const rows = await db
        .select()
        .from(entities)
        .where(and(...conditions))
        .orderBy(asc(entities.canonicalName));

      return rows.map(toEntityDto);
    },

    async findById(id) {
      const db = getDb();
      const rows = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? null : toEntityDto(row);
    },

    async findByCanonicalName(projectId, name) {
      const db = getDb();
      const rows = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.projectId, projectId),
            sql`lower(${entities.canonicalName}) = lower(${name})`,
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toEntityDto(row);
    },

    async isAliasTaken(projectId, alias, excludingId) {
      const db = getDb();
      const conditions: SQL[] = [
        eq(entities.projectId, projectId),
        sql`exists (
          select 1 from unnest(${entities.aliases}) as alias(value)
          where lower(alias.value) = lower(${alias})
        )`,
      ];
      // The exclusion clause is omitted rather than compared against a sentinel:
      // an empty string is not a valid uuid, and Postgres rejects it outright.
      if (excludingId !== null) {
        conditions.push(sql`${entities.id} <> ${excludingId}`);
      }

      // `aliases` is a text[] with no index. At the scale of one serial novel an
      // unnest scan is far cheaper than a GIN index, and it cannot go stale.
      const rows = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(...conditions))
        .limit(1);

      return rows.length > 0;
    },

    async create(input) {
      const db = getDb();
      const rows = await db
        .insert(entities)
        .values({
          projectId: input.projectId,
          type: input.type,
          canonicalName: input.canonicalName,
          aliases: input.aliases,
          summary: input.summary,
          originEntityId: input.originEntityId,
        })
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new Error('Entity insert returned no rows');
      }
      return toEntityDto(row);
    },

    async update(input) {
      const db = getDb();
      const patch: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() };
      if (input.summary !== undefined) patch.summary = input.summary;
      if (input.appearance !== undefined) patch.appearance = input.appearance;
      if (input.personality !== undefined) patch.personality = input.personality;
      if (input.backstory !== undefined) patch.backstory = input.backstory;
      if (input.originEntityId !== undefined) patch.originEntityId = input.originEntityId;
      if (input.metadata !== undefined) patch.metadata = input.metadata;

      const rows = await db
        .update(entities)
        .set(patch)
        .where(eq(entities.id, input.id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new EntityNotFoundError(input.id);
      }
      return toEntityDto(row);
    },

    async appendAlias(id, alias) {
      const db = getDb();
      // array_append inside the UPDATE, rather than read-modify-write, so two
      // concurrent alias additions cannot overwrite one another.
      const rows = await db
        .update(entities)
        .set({
          aliases: sql`array_append(${entities.aliases}, ${alias})`,
          updatedAt: new Date(),
        })
        .where(eq(entities.id, id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new EntityNotFoundError(id);
      }
      return toEntityDto(row);
    },

    async remove(id) {
      const db = getDb();
      await db.transaction(async (tx) => {
        // relations and relation_known_by are true foreign keys and cascade on
        // their own. Entity-scoped facts are polymorphic, so Postgres cannot
        // cascade them and they must be collected explicitly.
        await tx.execute(sql`
          delete from facts
          where scope_type = 'entity' and scope_id = ${id}
        `);
        await tx.delete(entities).where(eq(entities.id, id));
      });
    },
  };
}

/** Thrown when a row the caller named does not exist. Mapped to a 404-style code. */
export class EntityNotFoundError extends Error {
  constructor(id: string) {
    super(`Entity ${id} was not found`);
    this.name = 'EntityNotFoundError';
  }
}