import type { OutlineRepository } from '../repositories/outline.repository.js';
import type {
  Arc,
  CreateArcInput,
  CreateVolumeInput,
  OutlineDeletionImpact,
  OutlineNodeKind,
  OutlineTree,
  UpdateArcRequest,
  UpdateVolumeRequest,
  Volume,
} from '../ipc/contract.js';
import { RuleViolationError } from './storyboard.service.js';

/**
 * Rules for the outline scaffolding: volumes and arcs.
 *
 * Two things are worth stating plainly.
 *
 * First, a parent is checked before a child is inserted. The foreign key would
 * catch it anyway, but it would surface as a Postgres constraint message, and the
 * author deserves to be told "that volume no longer exists" instead.
 *
 * Second, this service never deletes. It reports what a deletion would cost and
 * leaves the actual removal to the caller, because the cascade from a volume takes
 * facts with it and facts are the thing this app exists to protect.
 */

export interface OutlineService {
  list(input: { projectId: string }): Promise<OutlineTree>;
  describeDeletion(input: { kind: OutlineNodeKind; id: string }): Promise<OutlineDeletionImpact>;
  createVolume(input: CreateVolumeInput): Promise<Volume>;
  updateVolume(input: UpdateVolumeRequest): Promise<Volume>;
  removeVolume(input: { id: string }): Promise<void>;
  createArc(input: CreateArcInput): Promise<Arc>;
  updateArc(input: UpdateArcRequest): Promise<Arc>;
  removeArc(input: { id: string }): Promise<void>;
}

export function createOutlineService(repo: OutlineRepository): OutlineService {
  return {
    list: (input) => repo.listTree(input.projectId),

    describeDeletion: (input) => repo.describeDeletion(input),

    async createVolume(input) {
      return repo.createVolume({
        projectId: input.projectId,
        title: requireTitle(input.title),
        summary: input.summary,
      });
    },

    async updateVolume(input) {
      const existing = await repo.findVolumeById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That volume no longer exists.');
      }
      if (input.title === undefined && input.summary === undefined) {
        throw new RuleViolationError('Nothing to save.');
      }
      return repo.updateVolume({
        id: input.id,
        ...(input.title === undefined ? {} : { title: requireTitle(input.title) }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
      });
    },

    removeVolume: (input) => repo.removeVolume(input.id),

    async createArc(input) {
      const volume = await repo.findVolumeById(input.volumeId);
      if (volume === null) {
        throw new RuleViolationError('That volume no longer exists, so the arc was not added.');
      }
      return repo.createArc({
        volumeId: input.volumeId,
        title: requireTitle(input.title),
        summary: input.summary,
      });
    },

    async updateArc(input) {
      const existing = await repo.findArcById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That arc no longer exists.');
      }
      if (input.title === undefined && input.summary === undefined) {
        throw new RuleViolationError('Nothing to save.');
      }
      return repo.updateArc({
        id: input.id,
        ...(input.title === undefined ? {} : { title: requireTitle(input.title) }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
      });
    },

    removeArc: (input) => repo.removeArc(input.id),
  };
}

/**
 * Trims and rejects an empty title.
 *
 * The schema already rejects a blank string, but by the time a request reaches the
 * service the author may have typed only spaces. "  " passes `nonEmptyText` and
 * would otherwise become a chapter called nothing.
 */
function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new RuleViolationError('Give it a title first.');
  }
  return trimmed;
}
