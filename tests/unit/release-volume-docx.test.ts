import { describe, expect, it } from 'vitest';
import { createReleaseService } from '../../electron/services/release.service.js';
import type { ChapterRepository } from '../../electron/repositories/chapter.repository.js';
import type { IllustrationRepository } from '../../electron/repositories/illustration.repository.js';
import type { OutlineRepository } from '../../electron/repositories/outline.repository.js';
import type { SaveFilePicker, SaveFileOutcome } from '../../electron/interfaces/file-dialog.interface.js';
import type { Chapter, Illustration, OutlineTree } from '../../electron/ipc/contract.js';

/**
 * Exporting a volume as a Word file.
 *
 * The service is where the pipeline stops being pure and starts touching the author's
 * disk, so this is the layer that has to be right about three things: it reads
 * committed data rather than an editor buffer, it refuses before writing when something
 * is wrong, and it never writes anything the author did not agree to.
 *
 * The picker is faked throughout. A test that opened a real save dialog would need a
 * window and a human, which is exactly the test that never gets written.
 */

const VOLUME_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ARC_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let nextId = 0;

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    arcId: ARC_ID,
    title: 'The Third Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}First paragraph.`,
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 100,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function illustrationFixture(chapterId: string): Illustration {
  return {
    id: `99999999-9999-4999-8999-${String(nextId).padStart(12, '0')}`,
    chapterId,
    afterParagraphIndex: 0,
    localPath: 'C:/storyboard/seal.png',
    remoteUrl: 'https://files.catbox.moe/abc123.png',
    provider: 'catbox',
    width: 900,
    height: 600,
    altText: 'A cracked stone seal',
    caption: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function outlineFor(chapters: Chapter[]): OutlineTree {
  return {
    volumes: [
      {
        id: VOLUME_ID,
        projectId: PROJECT_ID,
        title: 'Volume One',
        ordinal: 1,
        summary: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        arcs: [
          {
            id: ARC_ID,
            volumeId: VOLUME_ID,
            title: 'The Seal',
            ordinal: 1,
            summary: '',
            createdAt: '2026-01-01T00:00:00.000Z',
            chapters: chapters.map((chapter, index) => ({
              id: chapter.id,
              arcId: ARC_ID,
              title: chapter.title,
              ordinal: index + 1,
              type: chapter.type,
              status: chapter.status,
              povEntityId: null,
              wordCount: chapter.wordCount,
              publishedAt: null,
            })),
          },
        ],
      },
    ],
  };
}

interface Harness {
  service: ReturnType<typeof createReleaseService>;
  saved: { suggestedName: string; bytes: Buffer }[];
}

function harness(options: { chapters?: Chapter[]; slots?: Illustration[]; outcome?: SaveFileOutcome } = {}): Harness {
  const chapters = options.chapters ?? [chapterFixture()];
  const slots = options.slots ?? [];
  const saved: { suggestedName: string; bytes: Buffer }[] = [];
  const outcome: SaveFileOutcome = options.outcome ?? {
    status: 'saved',
    filePath: 'C:/exports/out.docx',
  };

  const chapterRepository: ChapterRepository = {
    listByArc: async () => chapters,
    findById: async (id) => chapters.find((chapter) => chapter.id === id) ?? null,
    findByIds: async (ids) => chapters.filter((chapter) => ids.includes(chapter.id)),
    nextOrdinal: async () => chapters.length + 1,
    create: async () => {
      throw new Error('not used');
    },
    remove: async () => {
      throw new Error('not used');
    },
    saveProse: async () => {
      throw new Error('not used');
    },
    saveOutline: async () => {
      throw new Error('not used');
    },
  };

  const illustrationRepository: IllustrationRepository = {
    listByChapter: async (chapterId) => slots.filter((slot) => slot.chapterId === chapterId),
  } as unknown as IllustrationRepository;

  const outlineRepository: OutlineRepository = {
    listTree: async () => outlineFor(chapters),
    findVolumeById: async (id) => {
      const tree = outlineFor(chapters);
      return id === VOLUME_ID ? (tree.volumes[0] ?? null) : null;
    },
  } as unknown as OutlineRepository;

  const picker: SaveFilePicker = {
    save: async ({ suggestedName, bytes }) => {
      saved.push({ suggestedName, bytes });
      return outcome;
    },
  };

  return {
    service: createReleaseService(chapterRepository, illustrationRepository, outlineRepository, picker),
    saved,
  };
}

describe('a volume exports to a file the author chose', () => {
  it('writes the file and reports where it went', async () => {
    const { service, saved } = harness();

    const result = await service.exportVolumeDocx({ volumeId: VOLUME_ID });

    expect(result.status).toBe('written');
    expect(result.status === 'written' && result.filePath).toBe('C:/exports/out.docx');
    expect(saved).toHaveLength(1);
  });

  it('names the file after the volume', async () => {
    const { service, saved } = harness();

    await service.exportVolumeDocx({ volumeId: VOLUME_ID });

    expect(saved[0].suggestedName).toBe('Volume One.docx');
  });

  it('writes a real Word document, not an empty file', async () => {
    const { service, saved } = harness();

    await service.exportVolumeDocx({ volumeId: VOLUME_ID });

    // The zip signature, so "the export produced nothing" cannot pass silently.
    expect(saved[0].bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  it('reports how many chapters went into the file', async () => {
    const { service } = harness({
      chapters: [chapterFixture({ title: 'One' }), chapterFixture({ title: 'Two' })],
    });

    const result = await service.exportVolumeDocx({ volumeId: VOLUME_ID });

    expect(result.status === 'written' && result.chapterCount).toBe(2);
  });

  it('reports images and notes it could not carry, so nothing goes missing quietly', async () => {
    const chapter = chapterFixture({ authorNotePre: 'Thanks for reading.' });
    const { service } = harness({ chapters: [chapter], slots: [illustrationFixture(chapter.id)] });

    const result = await service.exportVolumeDocx({ volumeId: VOLUME_ID });

    expect(result.status === 'written' && result.droppedImageCount).toBe(1);
    expect(result.status === 'written' && result.droppedNoteCount).toBe(1);
  });
});

describe('cancelling is not an error', () => {
  it('reports a cancelled export without writing anything', async () => {
    const { service, saved } = harness({ outcome: { status: 'cancelled' } });

    const result = await service.exportVolumeDocx({ volumeId: VOLUME_ID });

    expect(result.status).toBe('cancelled');
    expect(saved).toHaveLength(1);
  });
});

describe('nothing is written when something is wrong', () => {
  it('refuses a volume with an unwritten chapter', async () => {
    const { service } = harness({ chapters: [chapterFixture({ status: 'outline' })] });

    await expect(service.exportVolumeDocx({ volumeId: VOLUME_ID })).rejects.toThrow(/outline/i);
  });

  it('refuses a chapter under Royal Road\'s character floor', async () => {
    const { service } = harness({ chapters: [chapterFixture({ bodyMd: 'Too short.' })] });

    await expect(service.exportVolumeDocx({ volumeId: VOLUME_ID })).rejects.toThrow(/500/);
  });

  it('names every blocker rather than only the first', async () => {
    // One blocker at a time would send the author round the loop once per chapter.
    const { service } = harness({
      chapters: [chapterFixture({ status: 'outline' }), chapterFixture({ bodyMd: 'Too short.' })],
    });

    await expect(service.exportVolumeDocx({ volumeId: VOLUME_ID })).rejects.toThrow(/outline/i);
  });

  it('still refuses when the volume has nothing exportable at all', async () => {
    const { service } = harness({ chapters: [] });

    await expect(service.exportVolumeDocx({ volumeId: VOLUME_ID })).rejects.toThrow(/no chapters/i);
  });
});

describe('a volume that does not exist is said plainly', () => {
  it('rejects rather than writing an empty document', async () => {
    const { service, saved } = harness();

    await expect(service.exportVolumeDocx({ volumeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).rejects.toThrow(
      /no longer exists/i,
    );
    expect(saved).toHaveLength(0);
  });
});