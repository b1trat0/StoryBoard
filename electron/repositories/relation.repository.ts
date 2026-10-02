import { and, asc, eq, getTableColumns, inArray, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '../db/client.js';
import { entities, relationKnownBy, relations } from '../db/schema.js';
import { toRelationDto } from '../db/mappers.js';
import type {
  CreateRelationRequest,
  ListRelationsRequest,
  RelationWithKnowledge,
} from '../ipc/contract.js';

/**
 * Relation data access, including which entities know about each relation.
 *
 * Endpoint names are resolved inside SQL so the renderer receives
 * self-describing rows and never needs a second round trip to label a graph
 * edge. Both endpoints live in `entities`, so the second join uses an alias to
 * avoid colliding with the first.
 */

export interface RelationRepository {
  list(input: ListRelationsRequest): Promise<RelationWithKnowledge[]>;
  create(input: CreateRelationRequest): Promise<RelationWithKnowledge>;
  remove(id: string): Promise<void>;
}

export function createRelationRepository(): RelationRepository {
  return {
    async list(input) {
      const db = getDb();
      const toEntity = alias(entities, 'to_entity');

      const conditions: SQL[] = [eq(relations.projectId, input.projectId)];

      if (input.entityId !== undefined) {
        // An edge is visible from either endpoint, because the question is
        // always "what is this character's relationship to everything".
        conditions.push(
          or(
            eq(relations.fromEntityId, input.entityId),
            eq(relations.toEntityId, input.entityId),
          )!,
        );
      }
      if (input.category !== undefined) {
        conditions.push(eq(relations.category, input.category));
      }

      const rows = await db
        .select({
          // getTableColumns, not a spread of the table object: spreading the
          // table drags in Drizzle's internal brand/config keys, which are not
          // selectable columns.
          ...getTableColumns(relations),
          fromName: entities.canonicalName,
          toName: toEntity.canonicalName,
        })
        .from(relations)
        .innerJoin(entities, eq(relations.fromEntityId, entities.id))
        .innerJoin(toEntity, eq(relations.toEntityId, toEntity.id))
        .where(and(...conditions))
        .orderBy(asc(relations.createdAt));

      if (rows.length === 0) {
        return [];
      }

      // One extra query for all edges rather than one per edge: a serial novel
      // can accumulate hundreds of relations, and N+1 here would be felt.
      const knowers = await db
        .select({
          relationId: relationKnownBy.relationId,
          id: entities.id,
          canonicalName: entities.canonicalName,
        })
        .from(relationKnownBy)
        .innerJoin(entities, eq(relationKnownBy.entityId, entities.id))
        .where(
          inArray(
            relationKnownBy.relationId,
            rows.map((row) => row.id),
          ),
        );

      const byRelation = new Map<string, { id: string; canonicalName: string }[]>();
      for (const row of knowers) {
        const bucket = byRelation.get(row.relationId) ?? [];
        bucket.push({ id: row.id, canonicalName: row.canonicalName });
        byRelation.set(row.relationId, bucket);
      }

      return rows.map((row) => ({
        ...toRelationDto(row),
        knownBy: byRelation.get(row.id) ?? [],
      }));
    },

    async create(input) {
      const db = getDb();
      const insertedId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(relations)
          .values({
            projectId: input.projectId,
            fromEntityId: input.fromEntityId,
            toEntityId: input.toEntityId,
            category: input.category,
            typeLabel: input.typeLabel,
            sentiment: input.sentiment,
            rank: input.rank,
            validFromChapterId: input.validFromChapterId,
            validToChapterId: input.validToChapterId,
            isSecret: input.isSecret,
            notes: input.notes,
          })
          .returning({ id: relations.id });

        const row = inserted[0];
        if (row === undefined) {
          throw new Error('Relation insert returned no rows');
        }

        // Knowing about a relation is itself a fact about the story, so knowers
        // are written in the same transaction as the relation.
        if (input.knownByEntityIds.length > 0) {
          await tx.insert(relationKnownBy).values(
            input.knownByEntityIds.map((entityId) => ({
              relationId: row.id,
              entityId,
            })),
          );
        }

        return row.id;
      });

      const created = await this.list({ projectId: input.projectId });
      const match = created.find((row) => row.id === insertedId);
      if (match === undefined) {
        throw new Error('Relation was written but could not be read back');
      }
      return match;
    },

    async remove(id) {
      const db = getDb();
      await db.delete(relations).where(eq(relations.id, id));
    },
  };
}