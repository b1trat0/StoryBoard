import { RuleViolationError } from '../lib/errors.js';
import type {
  CreateProjectInput,
  ListProjectsRequest,
  Project,
  UpdateProjectRequest,
} from '../ipc/contract.js';
import type { ProjectRepository } from '../repositories/project.repository.js';
import type { SettingsService } from './settings.service.js';

/**
 * Rules about works.
 *
 * Thin on purpose: the database owns uniqueness and referential integrity, and this
 * layer owns the two decisions that are about the author's situation rather than the
 * data's shape — you cannot archive your only work, and the app always opens on a work
 * that exists and is not archived.
 */

export interface ProjectService {
  list(input: ListProjectsRequest): Promise<Project[]>;
  create(input: CreateProjectInput): Promise<Project>;
  update(input: UpdateProjectRequest): Promise<Project>;
  archive(input: { id: string }): Promise<Project>;
  /** The work the app should open. */
  getActive(): Promise<{ projectId: string | null }>;
  setActive(input: { projectId: string }): Promise<void>;
}

/**
 * @param projects - Work data access.
 * @param settings - Durable preference storage for the last opened work.
 */
export function createProjectService(
  projects: ProjectRepository,
  settings: SettingsService,
): ProjectService {
  return {
    list(input) {
      return projects.list(input.includeArchived ?? false);
    },

    create(input) {
      return projects.create(input);
    },

    update(input) {
      return projects.update(input);
    },

    async archive(input) {
      const activeCount = await projects.countActive();
      if (activeCount <= 1) {
        throw new RuleViolationError(
          'This is your only work, so it cannot be archived. Create another one first.',
        );
      }

      const archived = await projects.archive(input.id);
      const current = await settings.read();
      if (current.activeProjectId === archived.id) {
        const fallback = await projects.firstActive();
        await settings.setActiveProjectId(fallback?.id ?? null);
      }
      return archived;
    },

    async getActive() {
      const stored = await settings.read();
      if (stored.activeProjectId !== null) {
        const candidate = await projects.findById(stored.activeProjectId);
        if (candidate !== null && candidate.archivedAt === null) {
          return { projectId: candidate.id };
        }
      }

      // Nothing remembered, or the remembered work was archived. Fall back to the
      // oldest active work rather than opening an empty shell.
      const fallback = await projects.firstActive();
      return { projectId: fallback?.id ?? null };
    },

    async setActive(input) {
      const project = await projects.findById(input.projectId);
      if (project === null) {
        throw new RuleViolationError('That work no longer exists.');
      }
      if (project.archivedAt !== null) {
        throw new RuleViolationError('That work is archived, so it cannot be opened.');
      }
      await settings.setActiveProjectId(project.id);
    },
  };
}
