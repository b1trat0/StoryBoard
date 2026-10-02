import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../helpers/test-database.js';
import type { TestDatabase } from '../helpers/test-database.js';

/**
 * Integration tests for the invariants the whole project depends on.
 *
 * These run against real Postgres because the constraints are the enforcement
 * mechanism, not application validation. A test that only checked the TypeScript
 * layer would pass while the database still accepted an unsourced fact.
 *
 * Every negative test asserts on the specific constraint name, so a failure
 * identifies which rule broke rather than just "insert threw".
 */

let db: TestDatabase;
let pool: Pool;

/** Ids captured during setup so each test has a known graph to violate. */
const ids = {
  project: '',
  character: '',
  place: '',
  volume: '',
  arc: '',
  chapter: '',
};

beforeAll(async () => {
  db = await createTestDatabase('constraints');
  pool = db.pool;

  const project = await pool.query<{ id: string }>(
    `INSERT INTO projects (title) VALUES ('ConstraintTest') RETURNING id`,
  );
  ids.project = project.rows[0]?.id ?? '';

  const character = await pool.query<{ id: string }>(
    `INSERT INTO entities (project_id, type, canonical_name)
     VALUES ($1, 'character', 'Aiko') RETURNING id`,
    [ids.project],
  );
  ids.character = character.rows[0]?.id ?? '';

  const place = await pool.query<{ id: string }>(
    `INSERT INTO entities (project_id, type, canonical_name)
     VALUES ($1, 'place', 'Northreach') RETURNING id`,
    [ids.project],
  );
  ids.place = place.rows[0]?.id ?? '';

  const volume = await pool.query<{ id: string }>(
    `INSERT INTO volumes (project_id, title, ordinal) VALUES ($1, 'V1', 0) RETURNING id`,
    [ids.project],
  );
  ids.volume = volume.rows[0]?.id ?? '';

  const arc = await pool.query<{ id: string }>(
    `INSERT INTO arcs (volume_id, title, ordinal) VALUES ($1, 'A1', 0) RETURNING id`,
    [ids.volume],
  );
  ids.arc = arc.rows[0]?.id ?? '';

  const chapter = await pool.query<{ id: string }>(
    `INSERT INTO chapters (arc_id, title, ordinal) VALUES ($1, 'C1', 0) RETURNING id`,
    [ids.arc],
  );
  ids.chapter = chapter.rows[0]?.id ?? '';
});

afterAll(async () => {
  await db.dispose();
});

/** Postgres error codes that carry the constraint name we expect. */
function constraintOf(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  const constraint = (err as { constraint?: string }).constraint ?? '';
  return constraint === '' ? code : constraint;
}

describe('facts require a source', () => {
  it('rejects a fact with no source quote', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts (project_id, scope_type, scope_id, kind, content, source_chapter_id)
         VALUES ($1, 'chapter', $2, 'event', 'lost her hand', $2)`,
        [ids.project, ids.chapter],
      ),
    ).rejects.toThrowError(/source_quote/);
  });

  it('rejects a fact whose quote is only whitespace', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'chapter', $2, 'event', 'lost her hand', $2, '   ')`,
        [ids.project, ids.chapter],
      ),
    ).rejects.toThrowError(/source_quote_check/);
  });

  it('rejects a scoped fact with no scope id', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'chapter', NULL, 'event', 'orphan', $2, 'a quote')`,
        [ids.project, ids.chapter],
      ),
    ).rejects.toThrowError(/facts_scoped_rows_have_scope_id/);
  });

  it('accepts a global fact with no scope id', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'global', NULL, 'character_fact', 'magic costs memory', $2, 'every time she reaches')`,
        [ids.project, ids.chapter],
      ),
    ).resolves.toBeDefined();
  });

  it('deletes facts when their source chapter is deleted', async () => {
    const chapter = await pool.query<{ id: string }>(
      `INSERT INTO chapters (arc_id, title, ordinal) VALUES ($1, 'Throwaway', 1) RETURNING id`,
      [ids.arc],
    );
    const chapterId = chapter.rows[0]?.id ?? '';

    await pool.query(
      `INSERT INTO facts (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
       VALUES ($1, 'chapter', $2, 'event', 'transient', $2, 'quote')`,
      [ids.project, chapterId],
    );

    await pool.query(`DELETE FROM chapters WHERE id = $1`, [chapterId]);

    const remaining = await pool.query(
      `SELECT count(*)::int AS count FROM facts WHERE source_chapter_id = $1`,
      [chapterId],
    );
    expect(remaining.rows[0]?.count).toBe(0);
  });
});

describe('relation shape rules', () => {
  it('rejects a self relation', async () => {
    await expect(
      pool.query(
        `INSERT INTO relations (project_id, from_entity_id, to_entity_id, category, type_label)
         VALUES ($1, $2, $2, 'social', 'ally')`,
        [ids.project, ids.character],
      ),
    ).rejects.toThrowError(/relations_no_self_reference/);
  });

  it('rejects sentiment on a possession relation', async () => {
    await expect(
      pool.query(
        `INSERT INTO relations (project_id, from_entity_id, to_entity_id, category, type_label, sentiment)
         VALUES ($1, $2, $3, 'possession', 'carries', 4)`,
        [ids.project, ids.character, ids.place],
      ),
    ).rejects.toThrowError(/relations_sentiment_is_social_only/);
  });

  it('rejects rank on a social relation', async () => {
    await expect(
      pool.query(
        `INSERT INTO relations (project_id, from_entity_id, to_entity_id, category, type_label, rank)
         VALUES ($1, $2, $3, 'social', 'ally', 'elder')`,
        [ids.project, ids.character, ids.place],
      ),
    ).rejects.toThrowError(/relations_rank_is_membership_only/);
  });

  it('rejects sentiment outside minus five to five', async () => {
    await expect(
      pool.query(
        `INSERT INTO relations (project_id, from_entity_id, to_entity_id, category, type_label, sentiment)
         VALUES ($1, $2, $3, 'social', 'ally', 9)`,
        [ids.project, ids.character, ids.place],
      ),
    ).rejects.toThrowError(/sentiment/);
  });

  it('rejects a relation that ends in the chapter it starts', async () => {
    await expect(
      pool.query(
        `INSERT INTO relations
           (project_id, from_entity_id, to_entity_id, category, type_label, valid_from_chapter_id, valid_to_chapter_id)
         VALUES ($1, $2, $3, 'social', 'ally', $4, $4)`,
        [ids.project, ids.character, ids.place, ids.chapter],
      ),
    ).rejects.toThrowError(/relations_validity_order/);
  });

  it('accepts a null valid_to to mean still true', async () => {
    await expect(
      pool.query(
        `INSERT INTO relations
           (project_id, from_entity_id, to_entity_id, category, type_label, sentiment, valid_from_chapter_id, valid_to_chapter_id)
         VALUES ($1, $2, $3, 'social', 'sworn to', -3, $4, NULL)`,
        [ids.project, ids.character, ids.place, ids.chapter],
      ),
    ).resolves.toBeDefined();
  });
});

describe('entity identity', () => {
  it('rejects a duplicate canonical name that differs only by case', async () => {
    await expect(
      pool.query(
        `INSERT INTO entities (project_id, type, canonical_name) VALUES ($1, 'character', 'aiko')`,
        [ids.project],
      ),
    ).rejects.toThrowError(/entities_project_canonical_name_uq/);
  });

  it('allows the same name in a different project', async () => {
    const other = await pool.query<{ id: string }>(
      `INSERT INTO projects (title) VALUES ('Other') RETURNING id`,
    );
    await expect(
      pool.query(
        `INSERT INTO entities (project_id, type, canonical_name) VALUES ($1, 'character', 'Aiko')`,
        [other.rows[0]?.id],
      ),
    ).resolves.toBeDefined();
  });

  it('keeps aliases separate from the canonical name', async () => {
    const result = await pool.query<{ aliases: string[] }>(
      `UPDATE entities SET aliases = ARRAY['The Tower Warden', 'Warden'] WHERE id = $1 RETURNING aliases`,
      [ids.character],
    );
    expect(result.rows[0]?.aliases).toEqual(['The Tower Warden', 'Warden']);
  });
});

describe('illustrations require alt text', () => {
  it('rejects a blank alt text', async () => {
    await expect(
      pool.query(
        `INSERT INTO illustrations (chapter_id, after_paragraph_index, local_path, alt_text)
         VALUES ($1, 0, 'art/a.png', '  ')`,
        [ids.chapter],
      ),
    ).rejects.toThrowError(/illustrations_alt_text_check/);
  });

  it('accepts a slot that has no remote url yet', async () => {
    await expect(
      pool.query(
        `INSERT INTO illustrations (chapter_id, after_paragraph_index, local_path, alt_text, provider)
         VALUES ($1, 2, 'art/cover.png', 'Aiko at the tower gate', 'manual')`,
        [ids.chapter],
      ),
    ).resolves.toBeDefined();
  });

  it('finds unuploaded slots through the partial index', async () => {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM illustrations
       WHERE chapter_id = $1 AND remote_url IS NULL`,
      [ids.chapter],
    );
    expect(result.rows[0]?.count).toBe(1);
  });
});

describe('outline ordering', () => {
  it('rejects two chapters with the same ordinal in one arc', async () => {
    await expect(
      pool.query(`INSERT INTO chapters (arc_id, title, ordinal) VALUES ($1, 'Clash', 0)`, [
        ids.arc,
      ]),
    ).rejects.toThrowError(/chapters_arc_ordinal_uq/);
  });

  it('allows the same ordinal in a different arc', async () => {
    const arc = await pool.query<{ id: string }>(
      `INSERT INTO arcs (volume_id, title, ordinal) VALUES ($1, 'A2', 1) RETURNING id`,
      [ids.volume],
    );
    await expect(
      pool.query(`INSERT INTO chapters (arc_id, title, ordinal) VALUES ($1, 'Same', 0)`, [
        arc.rows[0]?.id,
      ]),
    ).resolves.toBeDefined();
  });

  it('lets the same character be the POV of many chapters', async () => {
    await expect(
      pool.query(
        `UPDATE chapters SET pov_entity_id = $1, word_count = 2500 WHERE id = $2`,
        [ids.character, ids.chapter],
      ),
    ).resolves.toBeDefined();
  });
});

/**
 * Regression cover for migration 0002.
 *
 * The 0001 constraint `facts_global_rows_have_no_scope_id` was a tautology and
 * enforced nothing. These tests are the ones that would have caught it, and they
 * fail against 0001 alone.
 */
describe('facts scope constraints', () => {
  it('rejects a global fact that carries a scope_id', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts
           (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'global', $2, 'event', 'Global but attached', $3, 'A quoted line.')`,
        [ids.project, ids.chapter, ids.chapter],
      ),
    ).rejects.toThrowError(/facts_global_rows_have_no_scope_id/);
  });

  it('accepts a global fact with a null scope_id', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts
           (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'global', NULL, 'event', 'A world rule', $2, 'A quoted line.')`,
        [ids.project, ids.chapter],
      ),
    ).resolves.toBeDefined();
  });

  it('still rejects a scoped fact with a null scope_id', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts
           (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'entity', NULL, 'character_fact', 'Unattached', $2, 'A quoted line.')`,
        [ids.project, ids.chapter],
      ),
    ).rejects.toThrowError(/facts_scoped_rows_have_scope_id/);
  });

  it('names the global-scope constraint so the controller can report it', async () => {
    const err = await pool
      .query(
        `INSERT INTO facts
           (project_id, scope_type, scope_id, kind, content, source_chapter_id, source_quote)
         VALUES ($1, 'global', $2, 'event', 'Named error check', $3, 'A quoted line.')`,
        [ids.project, ids.chapter, ids.chapter],
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(err).not.toBeNull();
    expect(constraintOf(err)).toBe('facts_global_rows_have_no_scope_id');
  });
});

describe('error surface', () => {
  it('names the violated constraint so the controller can report it', async () => {
    const err = await pool
      .query(
        `INSERT INTO relations (project_id, from_entity_id, to_entity_id, category, type_label, sentiment)
         VALUES ($1, $2, $3, 'possession', 'carries', 1)`,
        [ids.project, ids.character, ids.place],
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(err).not.toBeNull();
    expect(constraintOf(err)).toBe('relations_sentiment_is_social_only');
  });
});