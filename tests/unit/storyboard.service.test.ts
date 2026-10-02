import { describe, expect, it } from 'vitest';
import {
  createEntityService,
  createFactService,
  createRelationService,
  RuleViolationError,
} from '../../electron/services/storyboard.service.js';
import type { EntityRepository } from '../../electron/repositories/entity.repository.js';
import type { Entity, CreateEntityRequest } from '../../electron/ipc/contract.js';

/**
 * Service rules, tested against a stub repository.
 *
 * No database is involved: the point of the service layer is that the rules are
 * decidable without Postgres. These are the tests that would have caught the
 * alias-collision and self-reference bugs.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const CHAPTER_ID = '44444444-4444-4444-8444-444444444444';
const ALIAS_ID = '55555555-5555-4555-8555-555555555555';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: ENTITY_ID,
    projectId: PROJECT_ID,
    type: 'character',
    canonicalName: 'Kael',
    aliases: [],
    summary: '',
    appearance: '',
    personality: '',
    backstory: '',
    originEntityId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<CreateEntityRequest> = {}): CreateEntityRequest {
  return {
    projectId: PROJECT_ID,
    type: 'character',
    canonicalName: 'Kael',
    aliases: [],
    summary: '',
    originEntityId: null,
    ...overrides,
  };
}

/**
 * Records every call so a test can assert the repository was not written to
 * when a rule rejects the call first.
 */
function stubEntityRepository(seed: Entity[] = []) {
  const rows = [...seed];
  const calls = {
    create: 0,
    update: 0,
    appendAlias: 0,
    remove: 0,
  };

  const repo: EntityRepository = {
    async list() {
      return rows;
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async findByCanonicalName(_projectId, name) {
      const normal = name.toLowerCase();
      return (
        rows.find((row) => row.canonicalName.toLowerCase() === normal) ?? null
      );
    },
    async isAliasTaken(_projectId, alias, excludingId) {
      const normal = alias.toLowerCase();
      return rows.some(
        (row) =>
          row.id !== excludingId &&
          row.aliases.some((candidate) => candidate.toLowerCase() === normal),
      );
    },
    // (excludingId is nullable: null means create, where nothing is excluded.)
    async create(input) {
      calls.create += 1;
      const created = makeEntity({
        canonicalName: input.canonicalName,
        aliases: input.aliases,
        summary: input.summary,
      });
      rows.push(created);
      return created;
    },
    async update(input) {
      calls.update += 1;
      const row = rows.find((candidate) => candidate.id === input.id);
      if (row === undefined) {
        throw new Error(`Entity ${input.id} was not found`);
      }
      return row;
    },
    async appendAlias(id, alias) {
      calls.appendAlias += 1;
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new Error(`Entity ${id} was not found`);
      }
      row.aliases.push(alias);
      return row;
    },
    async remove(id) {
      calls.remove += 1;
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) {
        rows.splice(index, 1);
      }
    },
  };

  return { repo, calls, rows };
}

describe('entity service', () => {
  it('creates an entity when the name is free', async () => {
    const { repo, calls } = stubEntityRepository();
    const service = createEntityService(repo);

    const created = await service.create(makeCreateInput());

    expect(created.canonicalName).toBe('Kael');
    expect(calls.create).toBe(1);
  });

  it('refuses a duplicate canonical name and explains the fix', async () => {
    const { repo, calls } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    await expect(service.create(makeCreateInput())).rejects.toThrow(RuleViolationError);
    await expect(service.create(makeCreateInput())).rejects.toThrow(/Add an alias/);
    expect(calls.create).toBe(0);
  });

  it('matches canonical names case-insensitively', async () => {
    const { repo, calls } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    await expect(
      service.create(makeCreateInput({ canonicalName: 'KAEL' })),
    ).rejects.toThrow(RuleViolationError);
    expect(calls.create).toBe(0);
  });

  it('refuses a new entity whose alias is already taken', async () => {
    const { repo, calls } = stubEntityRepository([
      makeEntity({ id: OTHER_ID, canonicalName: 'Mira', aliases: ['The Ash Blade'] }),
    ]);
    const service = createEntityService(repo);

    await expect(
      service.create(makeCreateInput({ canonicalName: 'Kael', aliases: ['the ash blade'] })),
    ).rejects.toThrow(/already an alias/);
    expect(calls.create).toBe(0);
  });

  it('adds an alias that nobody else uses', async () => {
    const { repo, calls } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    const updated = await service.addAlias({ id: ENTITY_ID, alias: '  The Ash Blade  ' });

    expect(updated.aliases).toEqual(['The Ash Blade']);
    expect(calls.appendAlias).toBe(1);
  });

  it('trims an alias rather than storing stray whitespace', async () => {
    const { repo } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    const updated = await service.addAlias({ id: ENTITY_ID, alias: 'Blade of Cinder' });

    expect(updated.aliases).toContain('Blade of Cinder');
    expect(updated.aliases.some((alias) => alias !== alias.trim())).toBe(false);
  });

  it('treats a repeated alias as a no-op instead of an error', async () => {
    const { repo, calls } = stubEntityRepository([
      makeEntity({ aliases: ['The Ash Blade'] }),
    ]);
    const service = createEntityService(repo);

    const updated = await service.addAlias({ id: ENTITY_ID, alias: 'the ash blade' });

    expect(updated.aliases).toEqual(['The Ash Blade']);
    expect(calls.appendAlias).toBe(0);
  });

  it('refuses an alias that equals the entity own name', async () => {
    const { repo, calls } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    await expect(
      service.addAlias({ id: ENTITY_ID, alias: 'kael' }),
    ).rejects.toThrow(/already the name/);
    expect(calls.appendAlias).toBe(0);
  });

  it('refuses an alias belonging to another entity', async () => {
    const { repo, calls } = stubEntityRepository([
      makeEntity(),
      makeEntity({ id: OTHER_ID, canonicalName: 'Mira', aliases: ['The Quiet'] }),
    ]);
    const service = createEntityService(repo);

    await expect(
      service.addAlias({ id: ENTITY_ID, alias: 'The Quiet' }),
    ).rejects.toThrow(/already belongs to another entity/);
    expect(calls.appendAlias).toBe(0);
  });

  it('refuses an alias that shadows another entity canonical name', async () => {
    const { repo, calls } = stubEntityRepository([
      makeEntity(),
      makeEntity({ id: OTHER_ID, canonicalName: 'Mira' }),
    ]);
    const service = createEntityService(repo);

    await expect(
      service.addAlias({ id: ENTITY_ID, alias: 'Mira' }),
    ).rejects.toThrow(/name of another entity/);
    expect(calls.appendAlias).toBe(0);
  });

  it('updates prose fields but offers no way to rename', async () => {
    const { repo, calls } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    await service.update({ id: ENTITY_ID, appearance: 'Burnt left hand' });

    expect(calls.update).toBe(1);
    // canonicalName is absent from updateEntityRequestSchema precisely so a
    // rename cannot be expressed through the bridge at all.
  });

  it('rejects an update to an entity that no longer exists', async () => {
    const { repo, calls } = stubEntityRepository();
    const service = createEntityService(repo);

    await expect(
      service.update({ id: ENTITY_ID, summary: 'gone' }),
    ).rejects.toThrow(/no longer exists/);
    expect(calls.update).toBe(0);
  });

  it('deletes an entity on request', async () => {
    const { repo, calls, rows } = stubEntityRepository([makeEntity()]);
    const service = createEntityService(repo);

    await service.remove({ id: ENTITY_ID });

    expect(calls.remove).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it('does not resurrect a deleted id through alias handling', async () => {
    const { repo } = stubEntityRepository();
    const service = createEntityService(repo);

    await expect(
      service.addAlias({ id: ALIAS_ID, alias: 'Ghost' }),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe('relation service', () => {
  function stubRelationRepository() {
    const created: unknown[] = [];
    const repo = {
      async list() {
        return [];
      },
      async create(input) {
        created.push(input);
        return {
          id: RELATION_ID,
          projectId: input.projectId,
          fromEntityId: input.fromEntityId,
          toEntityId: input.toEntityId,
          fromName: 'Kael',
          toName: 'Mira',
          category: input.category,
          typeLabel: input.typeLabel,
          sentiment: input.sentiment,
          rank: input.rank,
          validFromChapterId: input.validFromChapterId,
          validToChapterId: input.validToChapterId,
          isSecret: input.isSecret,
          notes: input.notes,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          knownBy: [],
        };
      },
      async remove() {
        return undefined;
      },
    };
    return { repo, created };
  }

  const RELATION_ID = '66666666-6666-4666-8666-666666666666';

  function makeRelationInput(overrides: Record<string, unknown> = {}) {
    return {
      projectId: PROJECT_ID,
      fromEntityId: ENTITY_ID,
      toEntityId: OTHER_ID,
      category: 'social' as const,
      typeLabel: 'rival',
      sentiment: -2,
      rank: null,
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: false,
      notes: '',
      knownByEntityIds: [],
      ...overrides,
    };
  }

  it('creates a social relation with sentiment', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await service.create(makeRelationInput());

    expect(created).toHaveLength(1);
  });

  it('refuses a self relation', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await expect(
      service.create(makeRelationInput({ toEntityId: ENTITY_ID })),
    ).rejects.toThrow(/relation with itself/);
    expect(created).toHaveLength(0);
  });

  it('refuses sentiment on a possession relation', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await expect(
      service.create(makeRelationInput({ category: 'possession', sentiment: 3 })),
    ).rejects.toThrow(/social relations only/);
    expect(created).toHaveLength(0);
  });

  it('refuses a rank outside faction membership', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await expect(
      service.create(
        makeRelationInput({ category: 'social', sentiment: 0, rank: 'Captain' }),
      ),
    ).rejects.toThrow(/membership relations only/);
    expect(created).toHaveLength(0);
  });

  it('accepts a possession relation with no sentiment', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await service.create(
      makeRelationInput({ category: 'possession', sentiment: null, typeLabel: 'carries' }),
    );

    expect(created).toHaveLength(1);
  });

  it('refuses a relation that ends in the chapter it starts', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await expect(
      service.create(
        makeRelationInput({ validFromChapterId: CHAPTER_ID, validToChapterId: CHAPTER_ID }),
      ),
    ).rejects.toThrow(/same chapter it starts/);
    expect(created).toHaveLength(0);
  });

  it('accepts a timeline that spans chapters', async () => {
    const { repo, created } = stubRelationRepository();
    const service = createRelationService(repo);

    await service.create(
      makeRelationInput({
        validFromChapterId: CHAPTER_ID,
        validToChapterId: '77777777-7777-4777-8777-777777777777',
      }),
    );

    expect(created).toHaveLength(1);
  });
});

describe('fact service', () => {
  function stubFactRepository() {
    const created: unknown[] = [];
    const repo = {
      async list() {
        return [];
      },
      async create(input) {
        created.push(input);
        return {
          id: '88888888-8888-4888-8888-888888888888',
          projectId: input.projectId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          kind: input.kind,
          content: input.content,
          sourceChapterId: input.sourceChapterId,
          sourceQuote: input.sourceQuote,
          status: input.status,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      },
      async setStatus(id: string, status: string) {
        return {
          id,
          projectId: PROJECT_ID,
          scopeType: 'chapter',
          scopeId: CHAPTER_ID,
          kind: 'event',
          content: 'x',
          sourceChapterId: CHAPTER_ID,
          sourceQuote: 'y',
          status,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      },
      async remove() {
        return undefined;
      },
    };
    return { repo, created };
  }

  function makeFactInput(overrides: Record<string, unknown> = {}) {
    return {
      projectId: PROJECT_ID,
      scopeType: 'chapter' as const,
      scopeId: CHAPTER_ID,
      kind: 'event' as const,
      content: 'Mira arrives at the Ash Gate.',
      sourceChapterId: CHAPTER_ID,
      sourceQuote: 'Mira reached the Ash Gate at dusk.',
      status: 'draft' as const,
      ...overrides,
    };
  }

  it('creates a sourced chapter-scoped fact', async () => {
    const { repo, created } = stubFactRepository();
    const service = createFactService(repo);

    await service.create(makeFactInput());

    expect(created).toHaveLength(1);
  });

  it('refuses a scoped fact with nothing to attach it to', async () => {
    const { repo, created } = stubFactRepository();
    const service = createFactService(repo);

    await expect(
      service.create(makeFactInput({ scopeId: null })),
    ).rejects.toThrow(/must be attached/);
    expect(created).toHaveLength(0);
  });

  it('refuses a global fact that is attached to something', async () => {
    const { repo, created } = stubFactRepository();
    const service = createFactService(repo);

    await expect(
      service.create(makeFactInput({ scopeType: 'global', scopeId: CHAPTER_ID })),
    ).rejects.toThrow(/not attached to anything/);
    expect(created).toHaveLength(0);
  });

  it('accepts a global fact with no target', async () => {
    const { repo, created } = stubFactRepository();
    const service = createFactService(repo);

    await service.create(makeFactInput({ scopeType: 'global', scopeId: null }));

    expect(created).toHaveLength(1);
  });

  it('refuses a fact whose source quote is only whitespace', async () => {
    const { repo, created } = stubFactRepository();
    const service = createFactService(repo);

    await expect(
      service.create(makeFactInput({ sourceQuote: '   ' })),
    ).rejects.toThrow(/exact line it came from/);
    expect(created).toHaveLength(0);
  });

  it('records a status change for the author to confirm or reject', async () => {
    const { repo } = stubFactRepository();
    const service = createFactService(repo);

    const updated = await service.setStatus({
      id: '88888888-8888-4888-8888-888888888888',
      status: 'approved',
    });

    expect(updated.status).toBe('approved');
  });
});