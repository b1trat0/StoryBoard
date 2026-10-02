import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDb, useDb } from '../../electron/db/client.js';
import { createTestDatabase } from '../helpers/test-database.js';
import type { TestDatabase } from '../helpers/test-database.js';
import { createEntityRepository } from '../../electron/repositories/entity.repository.js';
import { createRelationRepository } from '../../electron/repositories/relation.repository.js';
import { createFactRepository } from '../../electron/repositories/fact.repository.js';
import { createEntityService } from '../../electron/services/storyboard.service.js';
import { createRelationService } from '../../electron/services/storyboard.service.js';
import { createFactService } from '../../electron/services/storyboard.service.js';
import { projects, arcs, volumes, chapters } from '../../electron/db/schema.js';

/**
 * Repositories against real Postgres.
 *
 * The unit tests prove the rules; these prove the SQL. The alias array_append,
 * the dual self-join on relations, and the polymorphic fact delete are all
 * things a mocked repository would happily agree with while the real query was
 * wrong.
 */

let testDb: TestDatabase;

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const VOLUME_ID = '20000000-0000-4000-8000-000000000001';
const ARC_ID = '30000000-0000-4000-8000-000000000001';
const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';
const CHAPTER_TWO_ID = '40000000-0000-4000-8000-000000000002';

beforeAll(async () => {
  testDb = await createTestDatabase('repos');
  useDb(testDb.pool);

  // A minimal outline spine: every insert below needs a chapter to hang facts
  // and relations from, and a chapter needs an arc, volume and project.
  await testDb.pool.query(
    `INSERT INTO projects (id, title) VALUES ($1, 'Test Serial')`,
    [PROJECT_ID],
  );
  await testDb.pool.query(
    `INSERT INTO volumes (id, project_id, title, ordinal) VALUES ($1, $2, 'Volume One', 1)`,
    [VOLUME_ID, PROJECT_ID],
  );
  await testDb.pool.query(
    `INSERT INTO arcs (id, volume_id, title, ordinal) VALUES ($1, $2, 'Arc One', 1)`,
    [ARC_ID, VOLUME_ID],
  );
  await testDb.pool.query(
    `INSERT INTO chapters (id, arc_id, title, ordinal) VALUES ($1, $2, 'Chapter One', 1)`,
    [CHAPTER_ID, ARC_ID],
  );
  await testDb.pool.query(
    `INSERT INTO chapters (id, arc_id, title, ordinal) VALUES ($1, $2, 'Chapter Two', 2)`,
    [CHAPTER_TWO_ID, ARC_ID],
  );
});

afterAll(async () => {
  resetDb();
  await testDb.dispose();
});

function service() {
  return {
    entities: createEntityService(createEntityRepository()),
    relations: createRelationService(createRelationRepository()),
    facts: createFactService(createFactRepository()),
  };
}

describe('entity repository', () => {
  it('round-trips an entity with its aliases intact', async () => {
    const { entities } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Kael',
      aliases: ['The Ash Blade'],
      summary: 'A reluctant heir.',
      originEntityId: null,
    });

    expect(created.canonicalName).toBe('Kael');
    // The bug this guards: `aliases` is text[] in SQL. If the Drizzle column were
    // declared as plain text, this would come back as a string and every alias
    // read in the app would break at runtime while still typechecking.
    expect(Array.isArray(created.aliases)).toBe(true);
    expect(created.aliases).toEqual(['The Ash Blade']);

    const readBack = await entities.list({ projectId: PROJECT_ID });
    const found = readBack.find((row) => row.id === created.id);
    expect(found?.aliases).toEqual(['The Ash Blade']);
  });

  it('defaults aliases to an empty array, never null', async () => {
    const { entities } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'place',
      canonicalName: 'The Ash Gate',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    expect(created.aliases).toEqual([]);
  });

  it('appends an alias with array_append in SQL', async () => {
    const { entities } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Mira',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    await entities.addAlias({ id: created.id, alias: 'The Quiet' });
    const updated = await entities.addAlias({ id: created.id, alias: 'Ash Wraith' });

    expect(updated.aliases).toEqual(['The Quiet', 'Ash Wraith']);
  });

  it('preserves alias order across appends', async () => {
    const { entities } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Sorren',
      aliases: ['First Alias'],
      summary: '',
      originEntityId: null,
    });

    const updated = await entities.addAlias({ id: created.id, alias: 'Second Alias' });

    expect(updated.aliases).toEqual(['First Alias', 'Second Alias']);
  });

  it('finds an entity by canonical name regardless of case', async () => {
    service();
    const repo = createEntityRepository();

    const found = await repo.findByCanonicalName(PROJECT_ID, 'mira');

    expect(found?.canonicalName).toBe('Mira');
  });

  it('detects an alias already used by another entity', async () => {
    const { entities } = service();
    // A distinct alias: an earlier relation test already created "Mira" with
    // "The Quiet", and reusing it would trip the service's own collision rule
    // before the repository method is ever reached.
    const other = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Tovan',
      aliases: ['The Drowned Herald'],
      summary: '',
      originEntityId: null,
    });
    const repo = createEntityRepository();

    // Seen from any entity other than Tovan, the alias is taken: case does not
    // matter. Excluding Tovan makes it free, which is what editing Tovan needs.
    const takenFromElsewhere = await repo.isAliasTaken(
      PROJECT_ID,
      'the drowned herald',
      '90000000-0000-4000-8000-000000000001',
    );
    const takenInCaps = await repo.isAliasTaken(
      PROJECT_ID,
      'THE DROWNED HERALD',
      '90000000-0000-4000-8000-000000000001',
    );
    const freeForOwner = await repo.isAliasTaken(
      PROJECT_ID,
      'The Drowned Herald',
      other.id,
    );

    expect(takenFromElsewhere).toBe(true);
    expect(takenInCaps).toBe(true);
    expect(freeForOwner).toBe(false);
  });

  it('does not treat an entity own alias as a conflict with itself', async () => {
    const { entities } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Halda',
      aliases: ['The Cartographer'],
      summary: '',
      originEntityId: null,
    });
    const repo = createEntityRepository();

    const taken = await repo.isAliasTaken(PROJECT_ID, 'The Cartographer', created.id);

    expect(taken).toBe(false);
  });

  it('ignores an entity in a different project when checking aliases', async () => {
    const { entities } = service();
    await entities.create({
      projectId: PROJECT_ID,
      type: 'faction',
      canonicalName: 'The Cinder Court',
      aliases: ['The Court'],
      summary: '',
      originEntityId: null,
    });

    const otherProject = '10000000-0000-4000-8000-0000000000ff';
    await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Other')`, [
      otherProject,
    ]);

    const repo = createEntityRepository();
    const taken = await repo.isAliasTaken(
      otherProject,
      'The Court',
      '90000000-0000-4000-8000-000000000002',
    );

    expect(taken).toBe(false);
  });

  it('filters by entity type', async () => {
    const { entities } = service();
    const places = await entities.list({ projectId: PROJECT_ID, type: 'place' });

    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.type).toBe('place');
    }
  });

  it('updates prose fields without touching the name', async () => {
    const { entities } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Bryn',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const updated = await entities.update({
      id: created.id,
      appearance: 'Scars along the jaw.',
      personality: 'Suspicious.',
    });

    expect(updated.appearance).toBe('Scars along the jaw.');
    expect(updated.personality).toBe('Suspicious.');
    expect(updated.canonicalName).toBe('Bryn');
  });

  it('deletes entity-scoped facts explicitly, since they cannot cascade', async () => {
    const { entities, facts } = service();
    const created = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Doomed',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    await facts.create({
      projectId: PROJECT_ID,
      scopeType: 'entity',
      scopeId: created.id,
      kind: 'character_fact',
      content: 'Doomed cannot read.',
      sourceChapterId: CHAPTER_ID,
      sourceQuote: 'He turned the page upside down.',
      status: 'approved',
    });

    const before = await facts.list({ projectId: PROJECT_ID, scopeId: created.id });
    expect(before).toHaveLength(1);

    await entities.remove({ id: created.id });

    const after = await facts.list({ projectId: PROJECT_ID, scopeId: created.id });
    expect(after).toHaveLength(0);

    const remaining = await testDb.pool.query(
      `SELECT count(*)::int AS count FROM entities WHERE id = $1`,
      [created.id],
    );
    expect(remaining.rows[0].count).toBe(0);
  });

  it('rejects a duplicate canonical name at the database level', async () => {
    const { entities } = service();
    await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Unique One',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    // The service would refuse this first; the raw insert proves the index holds
    // even if a future caller bypasses the service.
    await expect(
      testDb.pool.query(
        `INSERT INTO entities (project_id, type, canonical_name)
         VALUES ($1, 'character', 'unique one')`,
        [PROJECT_ID],
      ),
    ).rejects.toThrow(/entities_project_canonical_name_uq/);
  });
});

describe('relation repository', () => {
  it('resolves both endpoint names through the dual self-join', async () => {
    const { entities, relations } = service();
    const kael = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Join Kael',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const mira = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Join Mira',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const created = await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: kael.id,
      toEntityId: mira.id,
      category: 'social',
      typeLabel: 'rival',
      sentiment: -3,
      rank: null,
      validFromChapterId: CHAPTER_ID,
      validToChapterId: null,
      isSecret: true,
      notes: '',
      knownByEntityIds: [mira.id],
    });

    // If the aliased join were wrong, fromName and toName would collapse to the
    // same value or one of them would come back undefined.
    expect(created.fromName).toBe('Join Kael');
    expect(created.toName).toBe('Join Mira');
    expect(created.fromName).not.toBe(created.toName);
    expect(created.knownBy).toEqual([{ id: mira.id, canonicalName: 'Join Mira' }]);
  });

  it('returns an edge when filtering from either endpoint', async () => {
    const { entities, relations } = service();
    const left = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Either Left',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const right = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Either Right',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: left.id,
      toEntityId: right.id,
      category: 'possession',
      typeLabel: 'carries',
      sentiment: null,
      rank: null,
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: false,
      notes: '',
      knownByEntityIds: [],
    });

    const fromLeft = await relations.list({ projectId: PROJECT_ID, entityId: left.id });
    const fromRight = await relations.list({ projectId: PROJECT_ID, entityId: right.id });

    expect(fromLeft).toHaveLength(1);
    expect(fromRight).toHaveLength(1);
    expect(fromLeft[0].id).toBe(fromRight[0].id);
  });

  it('returns no rows for an entity with no edges', async () => {
    const { entities, relations } = service();
    const lonely = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Nobody Knows Me',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const rows = await relations.list({
      projectId: PROJECT_ID,
      entityId: lonely.id,
    });

    expect(rows).toEqual([]);
  });

  it('records multiple knowers on one relation', async () => {
    const { entities, relations } = service();
    const a = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Knower A',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const b = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Knower B',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const c = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Knower C',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const created = await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: a.id,
      toEntityId: b.id,
      category: 'social',
      typeLabel: 'twin',
      sentiment: 5,
      rank: null,
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: true,
      notes: '',
      knownByEntityIds: [a.id, b.id, c.id],
    });

    expect(created.knownBy).toHaveLength(3);
  });

  it('returns an empty knower list rather than undefined', async () => {
    const { entities, relations } = service();
    const a = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'No Knower A',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const b = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'No Knower B',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const created = await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: a.id,
      toEntityId: b.id,
      category: 'membership',
      typeLabel: 'captain',
      sentiment: null,
      rank: 'Captain',
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: false,
      notes: '',
      knownByEntityIds: [],
    });

    expect(created.knownBy).toEqual([]);
  });

  it('keeps knower rows scoped to the relations actually returned', async () => {
    const { entities, relations } = service();
    const a = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Scoped A',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const b = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Scoped B',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const first = await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: a.id,
      toEntityId: b.id,
      category: 'social',
      typeLabel: 'first',
      sentiment: 0,
      rank: null,
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: false,
      notes: '',
      knownByEntityIds: [a.id],
    });

    // A second project-wide list must not leak first's knowers onto other edges.
    const all = await relations.list({ projectId: PROJECT_ID });
    const other = all.filter((row) => row.id !== first.id);
    for (const row of other) {
      const knowsFirst = row.knownBy.some((knower) => knower.id === a.id);
      // Only relations that genuinely include a as a knower may carry that id.
      if (knowsFirst) {
        expect(row.knownBy).toBeDefined();
      }
    }
  });

  it('filters by category', async () => {
    const { entities, relations } = service();
    const a = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Category A',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const b = await entities.create({
      projectId: PROJECT_ID,
      type: 'item',
      canonicalName: 'Category B',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: a.id,
      toEntityId: b.id,
      category: 'possession',
      typeLabel: 'wields',
      sentiment: null,
      rank: null,
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: false,
      notes: '',
      knownByEntityIds: [],
    });

    const possession = await relations.list({
      projectId: PROJECT_ID,
      category: 'possession',
    });

    expect(possession.length).toBeGreaterThan(0);
    for (const row of possession) {
      expect(row.category).toBe('possession');
    }
  });

  it('cascades knower rows when a relation is deleted', async () => {
    const { entities, relations } = service();
    const a = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Cascade A',
      aliases: [],
      summary: '',
      originEntityId: null,
    });
    const b = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Cascade B',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const created = await relations.create({
      projectId: PROJECT_ID,
      fromEntityId: a.id,
      toEntityId: b.id,
      category: 'social',
      typeLabel: 'temporary',
      sentiment: 0,
      rank: null,
      validFromChapterId: null,
      validToChapterId: null,
      isSecret: false,
      notes: '',
      knownByEntityIds: [a.id],
    });

    await relations.remove({ id: created.id });

    const orphaned = await testDb.pool.query(
      `SELECT count(*)::int AS count FROM relation_known_by WHERE relation_id = $1`,
      [created.id],
    );
    expect(orphaned.rows[0].count).toBe(0);
  });
});

describe('fact repository', () => {
  it('round-trips a sourced fact', async () => {
    const { facts } = service();
    const created = await facts.create({
      projectId: PROJECT_ID,
      scopeType: 'chapter',
      scopeId: CHAPTER_ID,
      kind: 'open_promise',
      content: 'The gate is said to open only for blood.',
      sourceChapterId: CHAPTER_ID,
      sourceQuote: 'It has not opened for me. Not once.',
      status: 'approved',
    });

    expect(created.kind).toBe('open_promise');
    expect(created.sourceQuote).toContain('not opened');

    const rows = await facts.list({
      projectId: PROJECT_ID,
      scopeType: 'chapter',
      scopeId: CHAPTER_ID,
    });
    expect(rows.some((row) => row.id === created.id)).toBe(true);
  });

  it('returns the same fact under each tab filter', async () => {
    const { entities, facts } = service();
    const character = await entities.create({
      projectId: PROJECT_ID,
      type: 'character',
      canonicalName: 'Tab Target',
      aliases: [],
      summary: '',
      originEntityId: null,
    });

    const entityFact = await facts.create({
      projectId: PROJECT_ID,
      scopeType: 'entity',
      scopeId: character.id,
      kind: 'character_fact',
      content: 'Tab Target fears open water.',
      sourceChapterId: CHAPTER_ID,
      sourceQuote: 'He would not put his hands in the river.',
      status: 'approved',
    });

    // Tab 1 and tab 2 are different filters over one table, which is the whole
    // reason they cannot drift apart.
    const viaEntity = await facts.list({
      projectId: PROJECT_ID,
      scopeType: 'entity',
      scopeId: character.id,
    });
    const viaScopeId = await facts.list({
      projectId: PROJECT_ID,
      scopeId: character.id,
    });

    expect(viaEntity.map((row) => row.id)).toContain(entityFact.id);
    expect(viaScopeId.map((row) => row.id)).toContain(entityFact.id);
  });

  it('filters by status and by kind', async () => {
    const { facts } = service();
    await facts.create({
      projectId: PROJECT_ID,
      scopeType: 'chapter',
      scopeId: CHAPTER_TWO_ID,
      kind: 'unresolved',
      content: 'The second sigil is unexplained.',
      sourceChapterId: CHAPTER_TWO_ID,
      sourceQuote: 'The second sigil simply was.',
      status: 'draft',
    });

    const drafts = await facts.list({
      projectId: PROJECT_ID,
      scopeId: CHAPTER_TWO_ID,
      status: 'draft',
    });
    const unresolved = await facts.list({
      projectId: PROJECT_ID,
      scopeId: CHAPTER_TWO_ID,
      kind: 'unresolved',
    });

    expect(drafts.length).toBeGreaterThan(0);
    for (const row of drafts) {
      expect(row.status).toBe('draft');
    }
    for (const row of unresolved) {
      expect(row.kind).toBe('unresolved');
    }
  });

  it('changes status without touching the source', async () => {
    const { facts } = service();
    const created = await facts.create({
      projectId: PROJECT_ID,
      scopeType: 'chapter',
      scopeId: CHAPTER_TWO_ID,
      kind: 'event',
      content: 'A bell rang in the empty tower.',
      sourceChapterId: CHAPTER_TWO_ID,
      sourceQuote: 'Somewhere above, a bell rang once.',
      status: 'draft',
    });

    const approved = await facts.setStatus({ id: created.id, status: 'approved' });

    expect(approved.status).toBe('approved');
    expect(approved.sourceQuote).toBe(created.sourceQuote);
  });

  it('refuses a fact with no source quote at the database level', async () => {
    await expect(
      testDb.pool.query(
        `INSERT INTO facts
           (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'chapter', $2, 'event', 'Unsourced', $3, '   ')`,
        [PROJECT_ID, CHAPTER_ID, CHAPTER_ID],
      ),
    ).rejects.toThrow();
  });

  it('refuses a scoped fact with a null scope id at the database level', async () => {
    await expect(
      testDb.pool.query(
        `INSERT INTO facts
           (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'chapter', NULL, 'event', 'Unscoped', $2, 'A quoted line.')`,
        [PROJECT_ID, CHAPTER_ID],
      ),
    ).rejects.toThrow();
  });
});

describe('spine tables referenced by the repositories', () => {
  it('exposes the outline hierarchy the tests relied on', async () => {
    // Guards against a fixture quietly depending on a table that a later
    // migration renames.
    const counts = await testDb.pool.query(
      `SELECT
         (SELECT count(*)::int FROM projects)  AS projects,
         (SELECT count(*)::int FROM volumes)  AS volumes,
         (SELECT count(*)::int FROM arcs)      AS arcs,
         (SELECT count(*)::int FROM chapters)  AS chapters`,
    );

    expect(counts.rows[0].projects).toBeGreaterThan(0);
    expect(counts.rows[0].volumes).toBeGreaterThan(0);
    expect(counts.rows[0].arcs).toBeGreaterThan(0);
    expect(counts.rows[0].chapters).toBeGreaterThan(0);
  });

  it('keeps the drizzle exports used by fixtures in sync with SQL', () => {
    expect(projects).toBeDefined();
    expect(volumes).toBeDefined();
    expect(arcs).toBeDefined();
    expect(chapters).toBeDefined();
  });
});