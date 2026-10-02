import { and, asc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { facts } from '../db/schema.js';
import { toFactDto } from '../db/mappers.js';
import type {
  CreateFactRequest,
  Fact,
  FactStatus,
  ListFactsRequest,
} from '../ipc/contract.js';

/**
 * Fact data access.
 *
 * Facts are the single store behind all three tabs. A tab is a scope filter, not
 * a separate table, which is the only way the tabs cannot drift apart.
 */

export class FactNotFoundError extends Error {
  constructor(id: string) {
    super(`Fact ${id} was not found`);
    this.name = 'FactNotFoundError';
  }
}

export interface FactRepository {
  list(input: ListFactsRequest): Promise<Fact[]>;
  create(input: CreateFactRequest): Promise<Fact>;
  setStatus(id: string, status: FactStatus): Promise<Fact>;
  remove(id: string): Promise<void>;
}

export function createFactRepository(): FactRepository {
  return {
    async list(input) {
      const db = getDb();
      const conditions: SQL[] = [eq(facts.projectId, input.projectId)];

      // Filtering by scope is exactly what turns one table into three tabs.
      if (input.scopeType !== undefined) {
        conditions.push(eq(facts.scopeType, input.scopeType));
      }
      if (input.scopeId !== undefined) {
        conditions.push(eq(facts.scopeId, input.scopeId));
      }
      if (input.kind !== undefined) {
        conditions.push(eq(facts.kind, input.kind));
      }
      if (input.status !== undefined) {
        conditions.push(eq(facts.status, input.status));
      }

      const rows = await db
        .select()
        .from(facts)
        .where(and(...conditions))
        .orderBy(asc(facts.createdAt));

      return rows.map(toFactDto);
    },

    async create(input) {
      const db = getDb();
      const rows = await db
        .insert(facts)
        .values({
          projectId: input.projectId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          kind: input.kind,
          content: input.content,
          sourceChapterId: input.sourceChapterId,
          sourceQuote: input.sourceQuote,
          status: input.status,
        })
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new Error('Fact insert returned no rows');
      }
      return toFactDto(row);
    },

    async setStatus(id, status) {
      const db = getDb();
      const rows = await db
        .update(facts)
        .set({ status, updatedAt: new Date() })
        .where(eq(facts.id, id))
        .returning();

      const row = rows[0];
      if (row === undefined) {
        throw new FactNotFoundError(id);
      }
      return toFactDto(row);
    },

    async remove(id) {
      const db = getDb();
      await db.delete(facts).where(eq(facts.id, id));
    },
  };
}