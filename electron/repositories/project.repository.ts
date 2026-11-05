import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects } from '../db/schema.js';
import { toProjectDto } from '../db/mappers.js';
import type {
  CreateProjectInput,
  Project,
  UpdateProjectRequest,
} from '../ipc/contract.js';

/**
 * Work data access.
 *
 * Archives rather than deletes. Every chapter, entity and fact references a project
 * with ON DELETE CASCADE, so a delete here is a manuscript disappearing in one
 * statement with no recovery path outside a backup.
 */

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} was not found`);
    this.name = 'ProjectNotFoundError';
  }
}

export interface ProjectRepository {
  list(includeArchived: boolean): Promise<Project[]>;
  findById(id: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  update(input: UpdateProjectRequest): Promise<Project>;
  archive(id: string): Promise<Project>;
  countActive(): Promise<number>;
  firstActive(): Promise<Project | null>;
}

export function createProjectRepository(): ProjectRepository {
  return {
    async list(includeArchived) {
      const db = getDb();
      const query = db.select().from(projects).orderBy(asc(projects.createdAt));
      const rows = includeArchived
        ? await query
        : await db
            .select()
            .from(projects)
            .where(isNull(projects.archivedAt))
            .orderBy(asc(projects.createdAt));
      return rows.map(toProjectDto);
    },

    async findById(id) {
      const db = getDb();
      const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? null : toProjectDto(row);
    },

    async create(input) {
      const db = getDb();
      const rows = await db
        .insert(projects)
        .values({
          title: input.title,
          kind: input.kind,
          exportProfile: input.exportProfile,
          summary: input.summary,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('Project insert returned no rows');
      }
      return toProjectDto(row);
    },

    async update(input) {
      const db = getDb();
      const rows = await db
        .update(projects)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.exportProfile === undefined
            ? {}
            : { exportProfile: input.exportProfile }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new ProjectNotFoundError(input.id);
      }
      return toProjectDto(row);
    },

    async archive(id) {
      const db = getDb();
      const rows = await db
        .update(projects)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new ProjectNotFoundError(id);
      }
      return toProjectDto(row);
    },

    async countActive() {
      const db = getDb();
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(projects)
        .where(isNull(projects.archivedAt));
      return rows[0]?.value ?? 0;
    },

    async firstActive() {
      const db = getDb();
      const rows = await db
        .select()
        .from(projects)
        .where(and(isNull(projects.archivedAt)))
        .orderBy(asc(projects.createdAt))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toProjectDto(row);
    },
  };
}
