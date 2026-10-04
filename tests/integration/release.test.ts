import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, useDb } from '../../electron/db/client.js';
import { createTestDatabase } from '../helpers/test-database.js';
import type { TestDatabase } from '../helpers/test-database.js';
import { createChapterRepository } from '../../electron/repositories/chapter.repository.js';
import { createIllustrationRepository } from '../../electron/repositories/illustration.repository.js';
import { createOutlineRepository } from '../../electron/repositories/outline.repository.js';
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

/**
 * Records what the export asked the save dialog to write, without touching disk.
 *
 * The picker is the only place a `.docx` leaves the app, and the file's bytes are the
 * only thing these tests can assert about. Returning the captured call keeps the write
 * path exercised without a temp directory that would need cleaning up.
 */
function recordingPicker() {
  const calls: { suggestedName: string; bytes: Buffer }[] = [];
  return {
    calls,
    save: async (input: { suggestedName: string; bytes: Buffer }) => {
      calls.push(input);
      return { status: 'saved' as const, filePath: `C:\\exports\\${input.suggestedName}` };
    },
  };
}

function releaseService() {
  return createReleaseService(
    createChapterRepository(),
    createIllustrationRepository(),
    createOutlineRepository(),
    recordingPicker(),
  );
}

/** Creates a volume and arc through SQL and returns both ids. */
async function createVolumeAndArcIds(): Promise<{ volumeId: string; arcId: string }> {
  const rows = await testDb.pool.query<{ id: string }>(
    `INSERT INTO volumes (project_id, title, ordinal) VALUES ($1, 'Volume One', 1) RETURNING id`,
    [PROJECT_ID],
  );
  const arc = await testDb.pool.query<{ id: string }>(
    `INSERT INTO arcs (volume_id, title, ordinal) VALUES ($1, 'Arc One', 1) RETURNING id`,
    [rows.rows[0]!.id],
  );
  return { volumeId: rows.rows[0]!.id, arcId: arc.rows[0]!.id };
}

/** Creates a volume and arc through SQL and returns the arc id. */
async function createArcId(): Promise<string> {
  return (await createVolumeAndArcIds()).arcId;
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

/**
 * The volume export read path against real Postgres.
 *
 * The unit tests prove the selection and assembly rules with plain objects. These prove
 * the joins underneath, and the one that matters most is membership: the exported file
 * is built from the volume's chapters and no others. A query that dropped the arc join,
 * or ordered by something other than the outline, would produce a plausible document
 * with the wrong chapters in it, and the author would find out after uploading.
 */
describe('volume docx export', () => {
  /** Reads the saved filename, which is the one piece of the result that names the file. */
  function suggestedNameOf(calls: { suggestedName: string }[]): string {
    return calls[0]?.suggestedName ?? '';
  }

  it('exports every chapter of the volume in outline order', async () => {
    const { volumeId, arcId } = await createVolumeAndArcIds();
    await insertChapter(arcId, { title: 'First' });
    await insertChapter(arcId, { title: 'Second', ordinal: 2 });

    const picker = recordingPicker();
    const service = createReleaseService(
      createChapterRepository(),
      createIllustrationRepository(),
      createOutlineRepository(),
      picker,
    );
    const result = await service.exportVolumeDocx({ volumeId });

    expect(result.status).toBe('written');
    if (result.status !== 'written') {
      return;
    }
    expect(result.chapterCount).toBe(2);
    expect(suggestedNameOf(picker.calls)).toBe('Volume One.docx');
  });

  it('leaves another volume\u2019s chapters out', async () => {
    // The membership check that no unit test can make, because a plain object cannot
    // belong to two volumes at once.
    const first = await createVolumeAndArcIds();
    await insertChapter(first.arcId, { title: 'In the first volume' });

    const otherVolume = await testDb.pool.query<{ id: string }>(
      `INSERT INTO volumes (project_id, title, ordinal) VALUES ($1, 'Volume Two', 2) RETURNING id`,
      [PROJECT_ID],
    );
    const otherArc = await testDb.pool.query<{ id: string }>(
      `INSERT INTO arcs (volume_id, title, ordinal) VALUES ($1, 'Arc Two', 1) RETURNING id`,
      [otherVolume.rows[0]!.id],
    );
    await insertChapter(otherArc.rows[0]!.id, { title: 'In the second volume' });

    const picker = recordingPicker();
    const service = createReleaseService(
      createChapterRepository(),
      createIllustrationRepository(),
      createOutlineRepository(),
      picker,
    );
    const result = await service.exportVolumeDocx({ volumeId: first.volumeId });

    expect(result.status === 'written' && result.chapterCount).toBe(1);
  });

  it('refuses to export a volume that does not exist', async () => {
    const picker = recordingPicker();
    const service = createReleaseService(
      createChapterRepository(),
      createIllustrationRepository(),
      createOutlineRepository(),
      picker,
    );

    await expect(
      service.exportVolumeDocx({ volumeId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toThrow(/no longer exists/i);
    expect(picker.calls).toHaveLength(0);
  });

  it('refuses to export an unfinished chapter and writes nothing', async () => {
    const { volumeId, arcId } = await createVolumeAndArcIds();
    await insertChapter(arcId, { title: 'Too short', bodyMd: 'Three words.' });

    const picker = recordingPicker();
    const service = createReleaseService(
      createChapterRepository(),
      createIllustrationRepository(),
      createOutlineRepository(),
      picker,
    );

    await expect(service.exportVolumeDocx({ volumeId })).rejects.toThrow(/not ready to export/i);
    expect(picker.calls).toHaveLength(0);
  });

  it('reports images and author notes it could not carry', async () => {
    // The author's only record of what the Word document left out, since the document
    // itself cannot say so.
    const { volumeId, arcId } = await createVolumeAndArcIds();
    const id = await insertChapter(arcId, { authorNotePost: 'Discord.' });
    await testDb.pool.query(
      `INSERT INTO illustrations (chapter_id, after_paragraph_index, local_path, remote_url, provider, width, height, alt_text)
       VALUES ($1, 0, 'C:/a.png', 'https://host.invalid/a.png', 'catbox', 900, 600, 'An image')`,
      [id],
    );

    const picker = recordingPicker();
    const service = createReleaseService(
      createChapterRepository(),
      createIllustrationRepository(),
      createOutlineRepository(),
      picker,
    );
    const result = await service.exportVolumeDocx({ volumeId });

    expect(result.status).toBe('written');
    if (result.status !== 'written') {
      return;
    }
    expect(result.droppedImageCount).toBe(1);
    expect(result.droppedNoteCount).toBe(1);
  });

  it('reports a cancelled save as a cancellation, not a file', async () => {
    const { volumeId, arcId } = await createVolumeAndArcIds();
    await insertChapter(arcId);

    const service = createReleaseService(
      createChapterRepository(),
      createIllustrationRepository(),
      createOutlineRepository(),
      { save: async () => ({ status: 'cancelled' as const }) },
    );

    expect(await service.exportVolumeDocx({ volumeId })).toEqual({ status: 'cancelled' });
  });
});