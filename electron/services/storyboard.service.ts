import type {
  CreateEntityRequest,
  CreateFactRequest,
  CreateRelationRequest,
  Entity,
  Fact,
  FactStatus,
  ListEntitiesRequest,
  ListFactsRequest,
  ListRelationsRequest,
  RelationWithKnowledge,
  UpdateEntityRequest,
} from '../ipc/contract.js';
import type { EntityRepository } from '../repositories/entity.repository.js';
import type { FactRepository } from '../repositories/fact.repository.js';
import type { RelationRepository } from '../repositories/relation.repository.js';
import { RuleViolationError } from '../lib/errors.js';

/**
 * Business rules.
 *
 * The service is the only layer that knows policy. Repositories move rows,
 * controllers shape IPC responses. Every rule here is unit-testable with a stub
 * repository and no database, which is why the rules live here rather than being
 * spread across handlers.
 */

/**
 * Re-exported so existing imports keep working; the class itself lives in
 * `lib/errors.ts` so services outside this one can raise an author-facing rule
 * violation without importing a feature module.
 */
export { RuleViolationError } from '../lib/errors.js';

export interface EntityService {
  list(input: ListEntitiesRequest): Promise<Entity[]>;
  create(input: CreateEntityRequest): Promise<Entity>;
  update(input: UpdateEntityRequest): Promise<Entity>;
  addAlias(input: { id: string; alias: string }): Promise<Entity>;
  remove(input: { id: string }): Promise<void>;
}

export function createEntityService(repo: EntityRepository): EntityService {
  return {
    list: (input) => repo.list(input),

    async create(input) {
      // The unique index would catch this anyway, but the service can explain
      // the fix: adding an alias is the correct answer, not picking a new name.
      const existing = await repo.findByCanonicalName(
        input.projectId,
        input.canonicalName,
      );
      if (existing !== null) {
        throw new RuleViolationError(
          `"${input.canonicalName}" already exists. Add an alias to it instead of creating a duplicate.`,
        );
      }

      for (const alias of input.aliases) {
        // The entity does not exist yet, so there is nothing to exclude: any
        // alias already in use anywhere in the project is a collision.
        const taken = await repo.isAliasTaken(input.projectId, alias, null);
        if (taken) {
          throw new RuleViolationError(
            `"${alias}" is already an alias of another entity. Aliases must resolve to one entity.`,
          );
        }
      }

      return repo.create(input);
    },

    /**
     * canonicalName is deliberately not updatable. Renaming an entity breaks
     * every fact, relation and chapter pointing at it, so the only way to change
     * a name is to add an alias.
     */
    async update(input) {
      const existing = await repo.findById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That character no longer exists.');
      }
      return repo.update(input);
    },

    async addAlias({ id, alias }) {
      const existing = await repo.findById(id);
      if (existing === null) {
        throw new RuleViolationError('That character no longer exists.');
      }

      const trimmed = alias.trim();
      const normal = trimmed.toLowerCase();

      // Re-adding an existing alias is a no-op rather than an error, so a
      // double-click or a re-save cannot grow the list with duplicates.
      if (existing.aliases.some((candidate) => candidate.toLowerCase() === normal)) {
        return existing;
      }
      if (existing.canonicalName.toLowerCase() === normal) {
        throw new RuleViolationError('That is already the name of this entity.');
      }

      if (await repo.isAliasTaken(existing.projectId, trimmed, id)) {
        throw new RuleViolationError(
          `"${trimmed}" already belongs to another entity. Two entities must not answer to one name.`,
        );
      }

      const shadowing = await repo.findByCanonicalName(existing.projectId, trimmed);
      if (shadowing !== null) {
        throw new RuleViolationError(
          `"${trimmed}" is the name of another entity. Give the alias to that entity instead.`,
        );
      }

      return repo.appendAlias(id, trimmed);
    },

    async remove({ id }) {
      await repo.remove(id);
    },
  };
}

export interface FactService {
  list(input: ListFactsRequest): Promise<Fact[]>;
  create(input: CreateFactRequest): Promise<Fact>;
  setStatus(input: { id: string; status: FactStatus }): Promise<Fact>;
  remove(input: { id: string }): Promise<void>;
}

export function createFactService(repo: FactRepository): FactService {
  return {
    list: (input) => repo.list(input),

    /**
     * The database rejects an unsourced fact outright. These checks exist so the
     * author reads a sentence about sourcing rather than a constraint name; the
     * database stays the authority.
     */
    async create(input) {
      if (input.scopeType !== 'global' && input.scopeId === null) {
        throw new RuleViolationError(
          'A fact must be attached to something: pick the chapter, character or relation it is about.',
        );
      }
      if (input.scopeType === 'global' && input.scopeId !== null) {
        throw new RuleViolationError(
          'A fact about the whole story is not attached to anything. Leave the target empty.',
        );
      }
      if (input.sourceQuote.trim().length === 0) {
        throw new RuleViolationError(
          'A fact must carry the exact line it came from, so you can check it months later.',
        );
      }
      return repo.create(input);
    },

    async setStatus({ id, status }) {
      return repo.setStatus(id, status);
    },

    async remove({ id }) {
      await repo.remove(id);
    },
  };
}

export interface RelationService {
  list(input: ListRelationsRequest): Promise<RelationWithKnowledge[]>;
  create(input: CreateRelationRequest): Promise<RelationWithKnowledge>;
  remove(input: { id: string }): Promise<void>;
}

export function createRelationService(repo: RelationRepository): RelationService {
  return {
    list: (input) => repo.list(input),

    /**
     * The Zod contract already enforces the shape rules. These repeats exist to
     * cover the cases a payload schema cannot see, and to make the service safe
     * to call directly from a test or a future import path.
     */
    async create(input) {
      if (input.fromEntityId === input.toEntityId) {
        throw new RuleViolationError('An entity cannot have a relation with itself.');
      }
      if (input.category !== 'social' && input.sentiment !== null) {
        throw new RuleViolationError(
          'Sentiment describes how two characters feel over time, so it applies to social relations only.',
        );
      }
      if (input.category !== 'membership' && input.rank !== null) {
        throw new RuleViolationError(
          'Rank belongs to faction membership relations only.',
        );
      }
      if (
        input.validFromChapterId !== null &&
        input.validToChapterId !== null &&
        input.validFromChapterId === input.validToChapterId
      ) {
        throw new RuleViolationError('A relation cannot end in the same chapter it starts.');
      }

      return repo.create(input);
    },

    async remove({ id }) {
      await repo.remove(id);
    },
  };
}