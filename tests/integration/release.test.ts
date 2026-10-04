import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, useDb } from '../../electron/db/client.js';
import { createTestDatabase } from '../helpers/test-database.js';
import type { TestDatabase } from '../helpers/test-database.js';
import { createChapterRepository } from '../../electron/repositories/chapter.repository.js';
import { createIllustrationRepository } from '../../electron/repositories/illustration.repository.js';
import { createReleaseService } from '../../electron/services/release.service.js';
import { createChapterService } from '../../electron/services/content.service.js';

/**
 * The release preview read path against real Postgres.
 *
 * The unit tests in release-chapter.test.ts prove the assembly rules with plain
 * objects. These prove the two joins underneath: that a chapter is read with its
 * stored author notes and stored word count, and that its image slots arrive
 * attached to the right chapter.
 *
 * That second one is the reason this file exists. A preview that renders a chapter
 * without its images, or with another chapter's images, looks entirely plausible
 * and is caught only after the author uploads to Royal Road by hand.
 */

let testDb: TestDatabase;

const PROJECT_ID = '12000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  testDb = await createTestDatabase('release');
  useDb(testDb.pool);
  await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Serial')`, [
    PROJECT_ID,
  ]);
});

afterAll(async () => {
  resetDb();
  await testDb.dispose();
});

beforeEach(async () => {
  await testDb.pool.query(
    `TRUNCATE projects, volumes, arcs, chapters, entities, facts, illustrations RESTART IDENTITY CASCADE`,
  );
  await testDb.pool.query(`INSERT INTO projects (id, title) VALUES ($1, 'Serial')`, [PROJECT_ID]);
});

function releaseService() {
  const chapters = createChapterRepository();
  return createReleaseService(chapters, createIllustrationRepository());
}

/** Creates a volume and arc through SQL and returns the arc id. */
async function createArcId(): Promise<string> {
  const rows = await testDb.pool.query<{ id: string }>(
    `INSERT INTO volumes (project_id, title, ordinal) VALUES ($1, 'Volume One', 1) RETURNING id`,
    [PROJECT_ID],
  );
  const arc = await testDb.pool.query<{ id: string }>(
    `INSERT INTO arcs (volume_id, title, ordinal) VALUES ($1, 'Arc One', 1) RETURNING id`,
    [rows.rows[0]!.id],
  );
  return arc.rows[0]!.id;
}

/** Inserts a chapter directly and returns its id. */
async function insertChapter(
  arcId: string,
  overrides: {
    title?: string;
    bodyMd?: string;
    authorNotePre?: string;
    authorNotePost?: string;
    type?: string;
    ordinal?: number;
  } = {},
): Promise<string> {
  const rows = await testDb.pool.query<{ id: string }>(
    `INSERT INTO chapters (arc_id, title, ordinal, type, status, body_md, author_note_pre, author_note_post, word_count)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, 7) RETURNING id`,
    [
      arcId,
      overrides.title ?? 'The Third Seal',
      overrides.ordinal ?? 1,
      overrides.type ?? 'chapter',
      overrides.bodyMd ?? 'Filler prose to clear the character floor. '.repeat(14),
      overrides.authorNotePre ?? '',
      overrides.authorNotePost ?? '',
    ],
  );
  return rows.rows[0]!.id;
}

describe('release preview', () => {
  it('previews a chapter with its stored author notes converted', async () => {
    const arcId = await createArcId();
    const id = await insertChapter(arcId, {
      authorNotePre: 'Starts **here**.',
      authorNotePost: 'Discord: https://example.invalid',
    });

    const release = await releaseService().previewChapter({ chapterId: id });

    expect(release.title).toBe('The Third Seal');
    expect(release.preNoteHtml).toBe('Starts <b>here</b>.');
    expect(release.postNoteHtml).toBe('Discord: https://example.invalid');
  });

  it('attaches only the images belonging to the previewed chapter', async () => {
    const arcId = await createArcId();
    const firstId = await insertChapter(arcId, { title: 'First' });
    const secondId = await insertChapter(arcId, { title: 'Second', ordinal: 2 });

    await testDb.pool.query(
      `INSERT INTO illustrations (chapter_id, after_paragraph_index, local_path, remote_url, provider, width, height, alt_text)
       VALUES ($1, 0, 'C:/a.png', 'https://host.invalid/a.png', 'catbox', 900, 600, 'First image'),
              ($2, 0, 'C:/b.png', 'https://host.invalid/b.png', 'catbox', 900, 600, 'Second image')`,
      [firstId, secondId],
    );

    const release = await releaseService().previewChapter({ chapterId: firstId });
    const images = release.blocks.filter((block) => block.kind === 'image');

    expect(images).toHaveLength(1);
    expect(images[0]?.kind === 'image' && images[0].imageHtml).toContain('alt="First image"');
    expect(release.warnings.some((entry) => entry.code === 'unuploaded_image')).toBe(false);
  });

  it('blocks a chapter whose image has no public URL', async () => {
    const arcId = await createArcId();
    const id = await insertChapter(arcId);
    await testDb.pool.query(
      `INSERT INTO illustrations (chapter_id, after_paragraph_index, local_path, remote_url, provider, alt_text)
       VALUES ($1, 0, 'C:/local-only.png', NULL, 'manual', 'A local file')`,
      [id],
    );

    const release = await releaseService().previewChapter({ chapterId: id });

    const warning = release.warnings.find((entry) => entry.code === 'unuploaded_image');
    expect(warning?.severity).toBe('blocker');
  });

  it('refuses to preview a chapter that does not exist', async () => {
    await expect(
      releaseService().previewChapter({
        chapterId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('reads the chapter as saved, not as an editing buffer', async () => {
    // The preview must reflect the last explicit save. If it read stale state, the
    // author would review one version and publish another.
    const arcId = await createArcId();
    const id = await insertChapter(arcId);
    const chapters = createChapterService(createChapterRepository());
    const savedBody = 'Saved prose. '.repeat(40);
    await chapters.saveProse({
      id,
      bodyMd: savedBody,
      authorNotePre: 'Saved note.',
      authorNotePost: '',
    });

    const release = await releaseService().previewChapter({ chapterId: id });

    expect(release.preNoteHtml).toBe('Saved note.');
    // Trailing whitespace is trimmed by the paragraph splitter, nothing else is.
    expect(release.blocks).toHaveLength(1);
    expect(release.blocks[0]?.html).toBe(savedBody.trimEnd());
  });
});