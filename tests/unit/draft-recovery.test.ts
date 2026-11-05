import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDraftRecoveryService } from '../../electron/services/draft-recovery.service.js';

/**
 * Crash recovery files.
 *
 * The dangerous cases are the boring ones: a corrupt file must not be offered as the
 * author's prose, a missing file is not an error, and the id is never trusted as a
 * path. These are tested without Electron because the service is plain filesystem
 * work.
 */

const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'storyboard-drafts-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('saving and reading', () => {
  it('round-trips the buffer with a timestamp', async () => {
    const service = createDraftRecoveryService(
      directory,
      () => new Date('2026-11-06T01:20:00.000Z'),
    );

    await service.save({
      chapterId: CHAPTER_ID,
      bodyMd: 'Half a paragraph',
      authorNotePre: 'pre',
      authorNotePost: 'post',
    });

    await expect(service.read(CHAPTER_ID)).resolves.toEqual({
      chapterId: CHAPTER_ID,
      savedAt: '2026-11-06T01:20:00.000Z',
      bodyMd: 'Half a paragraph',
      authorNotePre: 'pre',
      authorNotePost: 'post',
    });
  });

  it('returns null when nothing was ever written', async () => {
    const service = createDraftRecoveryService(directory);
    await expect(service.read(CHAPTER_ID)).resolves.toBeNull();
  });

  it('leaves no partial file behind', async () => {
    const service = createDraftRecoveryService(directory);
    await service.save({
      chapterId: CHAPTER_ID,
      bodyMd: 'text',
      authorNotePre: '',
      authorNotePost: '',
    });

    const files = await readdir(directory);
    expect(files).toEqual([`${CHAPTER_ID}.json`]);
  });

  it('ignores a file whose shape is wrong instead of showing corrupt text as prose', async () => {
    await writeFile(
      path.join(directory, `${CHAPTER_ID}.json`),
      JSON.stringify({ bodyMd: 42 }),
      'utf8',
    );

    const service = createDraftRecoveryService(directory);
    await expect(service.read(CHAPTER_ID)).resolves.toBeNull();
  });

  it('ignores a file that is not JSON at all', async () => {
    await writeFile(path.join(directory, `${CHAPTER_ID}.json`), 'not json', 'utf8');

    const service = createDraftRecoveryService(directory);
    await expect(service.read(CHAPTER_ID)).resolves.toBeNull();
  });
});

describe('clearing', () => {
  it('removes the file', async () => {
    const service = createDraftRecoveryService(directory);
    await service.save({
      chapterId: CHAPTER_ID,
      bodyMd: 'text',
      authorNotePre: '',
      authorNotePost: '',
    });

    await service.clear(CHAPTER_ID);

    expect(await readdir(directory)).toEqual([]);
  });

  it('treats a missing file as already cleared', async () => {
    const service = createDraftRecoveryService(directory);
    await expect(service.clear(CHAPTER_ID)).resolves.toBeUndefined();
  });
});

describe('path safety', () => {
  it('refuses an id that is not a uuid, so it can never escape the directory', async () => {
    const service = createDraftRecoveryService(directory);

    await expect(
      service.save({
        chapterId: '../../evil',
        bodyMd: 'text',
        authorNotePre: '',
        authorNotePost: '',
      }),
    ).rejects.toThrow(/not valid/i);
  });
});
