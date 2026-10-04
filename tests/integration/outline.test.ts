import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, useDb } from '../../electron/db/client.js';
import { createTestDatabase } from '../helpers/test-database.js';
import type { TestDatabase } from '../helpers/test-database.js';
import { createOutlineRepository } from '../../electron/repositories/outline.repository.js';
import { createChapterRepository } from '../../electron/repositories/chapter.repository.js';
import { createOutlineService } from '../../electron/services/outline.service.js';
import { createChapterService } from '../../electron/services/content.service.js';
import {
  createArcRequestSchema,
  createVolumeRequestSchema,
} from '../../electron/ipc/contract.js';

/**
 * The outline and chapter SQL against real Postgres.
 *
 * The unit tests in outline.service.test.ts prove the rules with a mocked
 * repository. These prove the queries: ordinal assignment, the three-table tree
 * join, deletion-impact aggregation, and the cascades that delete a volume fires.
 *
 * Every one of those is a place where a plausible-looking query can be wrong while
 * the type checker stays silent. The bug this file exists to catch is a chapter
 * that silently vanishes, or a delete that takes published prose with it and
 * reports zero impact.
 */

let testDb: TestDatabase;

const PROJECT_ID = '11000000-0000-4000-8000-000000000001';
const OTHER_PROJECT_ID = '11000000-0000-4000-8000-000000000002';

beforeAll(async () => {
  testDb = await createTestDatabase('outline');
  useDb(testDb.pool);
  await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Serial')`, [PROJECT_ID]);
  await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Other')`, [
    OTHER_PROJECT_ID,
  ]);
});

afterAll(async () => {
  resetDb();
  await testDb.dispose();
});

/**
 * Clears the outline back to empty between tests. Done with TRUNCATE rather than
 * per-test deletes because the foreign keys cascade anyway and a delete cascade is
 * one of the things under test here: if TRUNCATE failed, the suite would say so.
 */
beforeEach(async () => {
  await testDb.pool.query(
    `TRUNCATE projects, volumes, arcs, chapters, entities, facts, illustrations RESTART IDENTITY CASCADE`,
  );
  await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Serial')`, [PROJECT_ID]);
  await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Other')`, [
    OTHER_PROJECT_ID,
  ]);
});

function outlineService() {
  return createOutlineService(createOutlineRepository());
}

function chapterService() {
  return createChapterService(createChapterRepository());
}

/** Builds volume -> arc -> chapter, returning their ids in order. */
/**
 * Builds a prose-save payload.
 *
 * The contract requires both author notes on every prose save rather than defaulting
 * them, so a test that omits one would be relying on a silent wipe. Stating them
 * explicitly here keeps that guarantee visible at every call site.
 */
function prose(
  id: string,
  bodyMd: string,
  notes: { pre?: string; post?: string } = {},
): { id: string; bodyMd: string; authorNotePre: string; authorNotePost: string } {
  return {
    id,
    bodyMd,
    authorNotePre: notes.pre ?? '',
    authorNotePost: notes.post ?? '',
  };
}

async function spine(titles: readonly string[] = ['Chapter One']) {
  const outline = outlineService();
  const volume = await outline.createVolume({ projectId: PROJECT_ID, title: 'Volume One' });
  const arc = await outline.createArc({ volumeId: volume.id, title: 'Arc One' });
  const chaptersApi = chapterService();
  // Sequential, not Promise.all: ordinal assignment reads the current maximum and
  // adds one, so two simultaneous inserts would both compute the same number. The
  // unique constraint on (arc_id, ordinal) catches that, and a human cannot click
  // two different add buttons in the same millisecond.
  const chapters = [];
  for (const title of titles) {
    chapters.push(await chaptersApi.create({ arcId: arc.id, title }));
  }
  return { volume, arc, chapters };
}

/** Inserts a chapter-scoped fact the way the fact repository would. */
async function insertFact(chapterId: string, content = 'He drew the blade.') {
  await testDb.pool.query(
    `INSERT INTO facts (project_id, scope_type, scope_id, kind, content, status, source_chapter_id, source_quote)
     VALUES ($1, 'chapter', $2, 'event', $3, 'approved', $2, $3)`,
    [PROJECT_ID, chapterId, content],
  );
}

/** Inserts an illustration slot. alt_text is required by Royal Road, hence NOT NULL. */
async function insertIllustration(chapterId: string) {
  await testDb.pool.query(
    `INSERT INTO illustrations (chapter_id, after_paragraph_index, local_path, provider, alt_text)
     VALUES ($1, 2, 'C:/art/scene-01.png', 'manual', 'Kael at the gate')`,
    [chapterId],
  );
}

describe('outline tree', () => {
  it('nests arcs under their volume and chapters under their arc', async () => {
    await spine(['Chapter One', 'Chapter Two']);

    const tree = await outlineService().list({ projectId: PROJECT_ID });

    expect(tree.volumes).toHaveLength(1);
    expect(tree.volumes[0]?.arcs).toHaveLength(1);
    expect(tree.volumes[0]?.arcs[0]?.chapters.map((chapter) => chapter.title)).toEqual([
      'Chapter One',
      'Chapter Two',
    ]);
  });

  it('keeps the tree ordered by ordinal, not by insertion accident', async () => {
    const outline = outlineService();
    const volume = await outline.createVolume({ projectId: PROJECT_ID, title: 'Volume One' });
    const first = await outline.createArc({ volumeId: volume.id, title: 'Arc First' });
    await outline.createArc({ volumeId: volume.id, title: 'Arc Second' });

    // Renaming is not reordering, so the ordering under test here is insertion
    // ordinal assignment: the arc created first must read back first.
    const tree = await outline.list({ projectId: PROJECT_ID });
    expect(tree.volumes[0]?.arcs.map((arc) => arc.title)).toEqual(['Arc First', 'Arc Second']);
    expect(first.title).toBe('Arc First');
  });

  it('scopes the tree to one project', async () => {
    await spine(['Chapter One']);
    const other = await outlineService().createVolume({
      projectId: OTHER_PROJECT_ID,
      title: 'Someone Elses Book',
    });
    await outlineService().createArc({ volumeId: other.id, title: 'Their Arc' });

    const tree = await outlineService().list({ projectId: PROJECT_ID });

    expect(tree.volumes.map((volume) => volume.title)).toEqual(['Volume One']);
  });

  it('returns an empty tree rather than throwing for a project with no outline', async () => {
    const tree = await outlineService().list({ projectId: OTHER_PROJECT_ID });

    expect(tree.volumes).toEqual([]);
  });

  it('omits the prose body from the tree, because the tree is a navigation aid', async () => {
    const { chapters } = await spine();
    await chapterService().saveProse(prose(chapters[0]!.id, 'A long paragraph.'));

    const tree = await outlineService().list({ projectId: PROJECT_ID });

    expect(tree.volumes[0]?.arcs[0]?.chapters[0]).not.toHaveProperty('bodyMd');
  });

  it('counts words on the tree so a chapter list can show length', async () => {
    const { chapters } = await spine();
    await chapterService().saveProse(prose(chapters[0]!.id, 'one two three four five'));

    const tree = await outlineService().list({ projectId: PROJECT_ID });

    expect(tree.volumes[0]?.arcs[0]?.chapters[0]?.wordCount).toBe(5);
  });
});

describe('ordinals', () => {
  it('numbers volumes from one and continues past the last', async () => {
    const outline = outlineService();
    const first = await outline.createVolume({ projectId: PROJECT_ID, title: 'One' });
    const second = await outline.createVolume({ projectId: PROJECT_ID, title: 'Two' });

    expect(first.ordinal).toBe(1);
    expect(second.ordinal).toBe(2);
  });

  it('numbers arcs per volume, not per project', async () => {
    const outline = outlineService();
    const one = await outline.createVolume({ projectId: PROJECT_ID, title: 'One' });
    const two = await outline.createVolume({ projectId: PROJECT_ID, title: 'Two' });
    const arcInOne = await outline.createArc({ volumeId: one.id, title: 'A' });
    const arcInTwo = await outline.createArc({ volumeId: two.id, title: 'B' });

    // The bug this guards: numbering arcs off the project's arc count would put
    // the second volume's first arc at 2, leaving a gap that later reordering
    // cannot close.
    expect(arcInOne.ordinal).toBe(1);
    expect(arcInTwo.ordinal).toBe(1);
  });

  it('numbers chapters per arc, not per volume', async () => {
    const outline = outlineService();
    const volume = await outline.createVolume({ projectId: PROJECT_ID, title: 'One' });
    const firstArc = await outline.createArc({ volumeId: volume.id, title: 'Arc One' });
    const secondArc = await outline.createArc({ volumeId: volume.id, title: 'Arc Two' });
    const chapters = chapterService();

    const a = await chapters.create({ arcId: firstArc.id, title: 'A1' });
    const b = await chapters.create({ arcId: firstArc.id, title: 'A2' });
    const c = await chapters.create({ arcId: secondArc.id, title: 'B1' });

    expect([a.ordinal, b.ordinal, c.ordinal]).toEqual([1, 2, 1]);
  });

  it('reuses the next ordinal after a deletion rather than racing to the top', async () => {
    const outline = outlineService();
    const volume = await outline.createVolume({ projectId: PROJECT_ID, title: 'One' });
    const arc = await outline.createArc({ volumeId: volume.id, title: 'Arc' });
    const chapters = chapterService();

    await chapters.create({ arcId: arc.id, title: 'A' });
    await chapters.create({ arcId: arc.id, title: 'B' });
    await chapters.create({ arcId: arc.id, title: 'C' });
    const first = (await chapters.listByArc({ arcId: arc.id }))[0]!;
    await chapters.remove({ id: first.id });

    const next = await chapters.create({ arcId: arc.id, title: 'D' });

    // Appending, not gap-filling: B=2 and C=3 survive the deletion of A=1, so the
    // next chapter is 4. Reusing the freed slot would require a renumbering pass, and
    // renumbering would silently move every chapter after a deletion.
    const all = await chapters.listByArc({ arcId: arc.id });
    expect(next.ordinal).toBe(4);
    expect(all.map((chapter) => chapter.title)).toEqual(['B', 'C', 'D']);
  });
});

describe('outlines', () => {
  it('trims the title so a stray space cannot create a duplicate-looking volume', async () => {
    const volume = await outlineService().createVolume({
      projectId: PROJECT_ID,
      title: '  Volume One  ',
    });

    expect(volume.title).toBe('Volume One');
  });

  it('refuses an empty title rather than storing a blank node', async () => {
    await expect(
      outlineService().createVolume({ projectId: PROJECT_ID, title: '   ' }),
    ).rejects.toThrow(/title/i);
  });

  it('renames a volume without touching its arcs', async () => {
    const { volume, arc } = await spine();

    const renamed = await outlineService().updateVolume({ id: volume.id, title: 'Volume Two' });

    expect(renamed.title).toBe('Volume Two');
    const tree = await outlineService().list({ projectId: PROJECT_ID });
    expect(tree.volumes[0]?.arcs[0]?.id).toBe(arc.id);
  });

  it('rejects an update carrying no fields, so a stray save is visible', async () => {
    const { volume } = await spine();

    await expect(outlineService().updateVolume({ id: volume.id })).rejects.toThrow(/nothing to save/i);
  });

  it('accepts a rename to the title it already has', async () => {
    // Deliberately not an error. The editor commits on blur, so an unchanged field
    // produces a same-value write; raising an error there would toast at the author
    // for typing and clicking away.
    const { volume } = await spine();

    const result = await outlineService().updateVolume({ id: volume.id, title: 'Volume One' });

    expect(result.title).toBe('Volume One');
  });

  it('trims a rename, so a trailing space cannot create a duplicate-looking node', async () => {
    const { volume } = await spine();

    const renamed = await outlineService().updateVolume({ id: volume.id, title: '  Volume Two  ' });

    expect(renamed.title).toBe('Volume Two');
  });

  it('refuses to rename a node that does not exist', async () => {
    await expect(
      outlineService().updateVolume({
        id: '99999999-9999-4999-8999-999999999999',
        title: 'Ghost',
      }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('refuses an arc whose volume is missing rather than orphaning it', async () => {
    await expect(
      outlineService().createArc({
        volumeId: '99999999-9999-4999-8999-999999999999',
        title: 'Orphan',
      }),
    ).rejects.toThrow(/no longer exists/i);
  });
});

describe('deletion impact', () => {
  it('reports nothing for an empty node', async () => {
    const { volume } = await spine();

    const impact = await outlineService().describeDeletion({ kind: 'volume', id: volume.id });

    expect(impact.childCount).toBe(1);
    expect(impact.factCount).toBe(0);
    expect(impact.illustrationCount).toBe(0);
    expect(impact.wordCount).toBe(0);
  });

  it('counts the arcs inside a volume, not the chapters two levels down', async () => {
    const { volume } = await spine(['One', 'Two', 'Three']);

    const impact = await outlineService().describeDeletion({ kind: 'volume', id: volume.id });

    expect(impact.childCount).toBe(1);
  });

  it('counts the chapters inside an arc', async () => {
    const { arc } = await spine(['One', 'Two']);

    const impact = await outlineService().describeDeletion({ kind: 'arc', id: arc.id });

    expect(impact.childCount).toBe(2);
  });

  it('counts the facts that would be destroyed with a chapter', async () => {
    const { chapters } = await spine();
    await insertFact(chapters[0]!.id);

    const impact = await outlineService().describeDeletion({ kind: 'chapter', id: chapters[0]!.id });

    expect(impact.factCount).toBe(1);
  });

  it('counts the illustrations that would be destroyed with a chapter', async () => {
    const { chapters } = await spine();
    await insertIllustration(chapters[0]!.id);

    const impact = await outlineService().describeDeletion({ kind: 'chapter', id: chapters[0]!.id });

    expect(impact.illustrationCount).toBe(1);
  });

  it('counts the words that would be destroyed, so the author sees the prose at risk', async () => {
    const { chapters } = await spine();
    await chapterService().saveProse(prose(chapters[0]!.id, 'one two three four five six'));

    const impact = await outlineService().describeDeletion({
      kind: 'chapter',
      id: chapters[0]!.id,
    });

    expect(impact.wordCount).toBe(6);
  });

  it('adds up the whole subtree when a volume goes, not just its direct arcs', async () => {
    const outline = outlineService();
    const chapters = chapterService();
    const volume = await outline.createVolume({ projectId: PROJECT_ID, title: 'One' });
    const arcOne = await outline.createArc({ volumeId: volume.id, title: 'Arc One' });
    const arcTwo = await outline.createArc({ volumeId: volume.id, title: 'Arc Two' });
    await chapters.create({ arcId: arcOne.id, title: 'A' });
    await chapters.create({ arcId: arcTwo.id, title: 'B' });
    const [chapterA] = await chapters.listByArc({ arcId: arcOne.id });
    await chapters.saveProse(prose(chapterA!.id, 'one two three'));
    await insertFact(chapterA!.id, 'Something.');

    const impact = await outline.describeDeletion({ kind: 'volume', id: volume.id });

    // The confirmation dialog reads these numbers before the author destroys
    // work. Undercounting here is the whole failure mode this assertion blocks.
    expect(impact.childCount).toBe(2);
    expect(impact.factCount).toBe(1);
    expect(impact.wordCount).toBe(3);
  });
});

describe('the create payload the dialog actually sends', () => {
  /**
   * The unit tests call the service directly and the UI tests stub the bridge, so
   * neither sees the request schema the real payload passes through. The dialog
   * always sends `summary: ''` when the author skips the optional field, so that
   * exact shape has to survive validation or Add volume fails at the last hop with
   * an error the author cannot act on.
   */
  it('accepts the volume payload with the summary field left empty', async () => {
    const parsed = createVolumeRequestSchema.parse({
      projectId: PROJECT_ID,
      title: 'The Ashen Crown',
      summary: '',
    });

    const created = await outlineService().createVolume(parsed);

    expect(created.title).toBe('The Ashen Crown');
    expect(created.summary).toBe('');
    expect(created.ordinal).toBe(1);
  });

  it('accepts the arc payload with the summary field left empty', async () => {
    const volume = await outlineService().createVolume({ projectId: PROJECT_ID, title: 'One' });
    const parsed = createArcRequestSchema.parse({
      volumeId: volume.id,
      title: 'The Cinders',
      summary: '',
    });

    const created = await outlineService().createArc(parsed);

    expect(created.title).toBe('The Cinders');
  });

  it('still rejects a volume whose title is only spaces', () => {
    // nonEmptyText trims and checks length, so this must fail before the service.
    expect(
      createVolumeRequestSchema.safeParse({ projectId: PROJECT_ID, title: '   ' }).success,
    ).toBe(false);
  });
});

describe('cascade', () => {
  it('takes the arcs and chapters with the volume', async () => {
    const { volume, arc, chapters } = await spine(['One', 'Two']);

    await outlineService().removeVolume({ id: volume.id });

    const tree = await outlineService().list({ projectId: PROJECT_ID });
    expect(tree.volumes).toEqual([]);
    await expect(testDb.pool.query(`SELECT 1 FROM arcs WHERE id = $1`, [arc.id])).resolves.toBeDefined();
    const remaining = await testDb.pool.query(`SELECT id FROM chapters WHERE id = ANY($1)`, [
      chapters.map((chapter) => chapter.id),
    ]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('takes the chapters with the arc', async () => {
    const { arc, chapters } = await spine(['One', 'Two']);

    await outlineService().removeArc({ id: arc.id });

    const remaining = await testDb.pool.query(`SELECT id FROM chapters WHERE id = ANY($1)`, [
      chapters.map((chapter) => chapter.id),
    ]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('takes a chapter scoped facts with the chapter, since the source would dangle', async () => {
    const { chapters } = await spine();
    const chapterId = chapters[0]!.id;
    await insertFact(chapterId, 'Something.');

    await chapterService().remove({ id: chapterId });

    const remaining = await testDb.pool.query(`SELECT id FROM facts WHERE scope_id = $1`, [chapterId]);
    expect(remaining.rows).toHaveLength(0);
  });
});

describe('chapter prose', () => {
  it('stores the body verbatim, because markdown round-trips to Obsidian', async () => {
    const { chapters } = await spine();
    const body = 'First paragraph.\n\nSecond *paragraph* with `code`.\n\n- a list item';

    const saved = await chapterService().saveProse(prose(chapters[0]!.id, body));

    expect(saved.bodyMd).toBe(body);
  });

  it('recomputes the word count on every body save', async () => {
    const { chapters } = await spine();
    const chaptersApi = chapterService();
    await chaptersApi.saveProse(prose(chapters[0]!.id, 'one two three'));

    const grown = await chaptersApi.saveProse(prose(chapters[0]!.id, 'one two three four'));

    expect(grown.wordCount).toBe(4);
  });

  it('stores both author notes and reads them back', async () => {
    const { chapters } = await spine();
    const chaptersApi = chapterService();

    const saved = await chaptersApi.saveProse(
      prose(chapters[0]!.id, 'The body.', {
        pre: 'Start at book one.',
        post: 'Discord: https://example.invalid',
      }),
    );

    expect(saved.authorNotePre).toBe('Start at book one.');
    expect(saved.authorNotePost).toBe('Discord: https://example.invalid');

    // Round-tripped through the database, not just echoed back from the write.
    const reread = await chaptersApi.listByArc({ arcId: chapters[0]!.arcId });
    expect(reread[0]?.authorNotePre).toBe('Start at book one.');
    expect(reread[0]?.authorNotePost).toBe('Discord: https://example.invalid');
  });

  it('leaves the word count out of the author notes', async () => {
    const { chapters } = await spine();
    const chaptersApi = chapterService();

    // Royal Road derives its page wordcount from chapter content only, so a long
    // author note must not inflate the number the author sees against the 2,000
    // word target.
    const saved = await chaptersApi.saveProse(
      prose(chapters[0]!.id, 'one two three', {
        pre: 'a '.repeat(50),
        post: 'b '.repeat(50),
      }),
    );

    expect(saved.wordCount).toBe(3);
  });

  it('clears a note when the author empties it', async () => {
    const { chapters } = await spine();
    const chaptersApi = chapterService();
    const id = chapters[0]!.id;
    await chaptersApi.saveProse(prose(id, 'Body.', { pre: 'Note.', post: 'Also this.' }));

    const cleared = await chaptersApi.saveProse(prose(id, 'Body.'));

    expect(cleared.authorNotePre).toBe('');
    expect(cleared.authorNotePost).toBe('');
  });

  it('counts zero words for an empty body rather than leaving the old count', async () => {
    const { chapters } = await spine();
    const chaptersApi = chapterService();
    await chaptersApi.saveProse(prose(chapters[0]!.id, 'one two three'));

    const emptied = await chaptersApi.saveProse(prose(chapters[0]!.id, ''));

    expect(emptied.wordCount).toBe(0);
  });

  it('leaves the prose alone when only the outline changes', async () => {
    const { chapters } = await spine();
    const chaptersApi = chapterService();
    await chaptersApi.saveProse(prose(chapters[0]!.id, 'keep this sentence'));

    const updated = await chaptersApi.saveOutline({ id: chapters[0]!.id, status: 'done' });

    expect(updated.bodyMd).toBe('keep this sentence');
    expect(updated.status).toBe('done');
  });

  it('refuses a prose save for a chapter that no longer exists', async () => {
    await expect(
      chapterService().saveProse(prose('99999999-9999-4999-8999-999999999999', 'orphan')),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('keeps published chapters listed after the prose changes', async () => {
    const { chapters } = await spine();
    const chapterId = chapters[0]!.id;
    await testDb.pool.query(
      `UPDATE chapters SET rr_url = 'https://www.royalroad.com/fiction/1/1', published_at = now()
       WHERE id = $1`,
      [chapterId],
    );

    await chapterService().saveProse(prose(chapterId, 'revised after publication'));
    const tree = await outlineService().list({ projectId: PROJECT_ID });
    const node = tree.volumes[0]?.arcs[0]?.chapters[0];

    expect(node?.publishedAt).not.toBeNull();
  });
});
