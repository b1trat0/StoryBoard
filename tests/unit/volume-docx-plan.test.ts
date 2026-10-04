import { describe, expect, it } from 'vitest';
import type { Chapter, Illustration } from '../../electron/ipc/contract.js';
import { planVolumeDocx } from '../../electron/lib/volume-docx-plan.js';

/**
 * Which chapters go into a volume's `.docx`, and what the author is told about the
 * ones that do not.
 *
 * Royal Road's bulk import builds one chapter per `Heading 1` in the uploaded Word
 * file, so this plan is the last point at which a chapter can be left out. Getting it
 * wrong is silent in the worst way: the file uploads fine and a chapter is simply
 * gone from the published serial.
 *
 * The plan is pure on purpose. Every decision here — ordering, exclusions, what gets
 * dropped — is checkable without a database or a dialog, and each one of them is a
 * decision about the author's book rather than about the docx library.
 */

const ARC_ONE = '22222222-2222-4222-8222-222222222222';
const ARC_TWO = '55555555-5555-4555-8555-555555555555';

let nextId = 0;

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    arcId: ARC_ONE,
    title: 'The Third Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}First paragraph.\n\nSecond paragraph.`,
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

function illustrationFixture(chapterId: string, overrides: Partial<Illustration> = {}): Illustration {
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
    ...overrides,
  };
}

describe('chapter selection', () => {
  it('keeps chapters in arc order and then ordinal order', () => {
    const first = chapterFixture({ title: 'One', arcId: ARC_ONE, ordinal: 1 });
    const second = chapterFixture({ title: 'Two', arcId: ARC_ONE, ordinal: 2 });
    const third = chapterFixture({ title: 'Three', arcId: ARC_TWO, ordinal: 1 });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [
              { id: ARC_ONE, ordinal: 1, chapters: [second, first] },
              { id: ARC_TWO, ordinal: 2, chapters: [third] },
            ],
          },
        ],
        chapters: [first, second, third],
      },
      [],
    );

    expect(result.chapters.map((entry) => entry.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('leaves interludes out and says which ones and why', () => {
    const chapter = chapterFixture({ title: 'Real' });
    const interlude = chapterFixture({ title: 'Interlude', type: 'interlude' });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter, interlude] }],
          },
        ],
        chapters: [chapter, interlude],
      },
      [],
    );

    // A chapter that silently vanishes from a release is worse than one visibly
    // excluded, so the exclusion is reported rather than performed quietly.
    expect(result.chapters.map((entry) => entry.title)).toEqual(['Real']);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].title).toBe('Interlude');
    expect(result.excluded[0].reason.length).toBeGreaterThan(10);
  });

  it('reports a volume with nothing in it rather than writing an empty file', () => {
    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [] }],
          },
        ],
        chapters: [],
      },
      [],
    );

    expect(result.chapters).toEqual([]);
    expect(result.blockers.some((warning) => warning.code === 'no_publishable_chapters')).toBe(true);
  });
});

describe('blockers stop the export', () => {
  it('refuses a volume containing a chapter that is still an outline', () => {
    const chapter = chapterFixture({ status: 'outline' });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    expect(result.blockers.map((warning) => warning.code)).toContain('not_finished');
  });

  it('refuses a chapter under Royal Road\'s character floor', () => {
    const chapter = chapterFixture({ bodyMd: 'Too short to publish.' });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    expect(result.blockers.map((warning) => warning.code)).toContain('too_short');
  });

  it('carries an untranslatable construct through as a warning, not a blocker', () => {
    const chapter = chapterFixture({
      // The heading has to start its own line: the converter reports block constructs
      // from the start of a line, which is what a real markdown heading looks like.
      bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}\n\n## A heading`,
    });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    expect(result.warnings.map((warning) => warning.code)).toContain('unconverted_markdown');
    expect(result.blockers).toEqual([]);
  });
});

describe('what a text-only document cannot carry', () => {
  it('drops images and counts them', () => {
    const chapter = chapterFixture();
    const slots = [illustrationFixture(chapter.id), illustrationFixture(chapter.id)];

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      slots,
    );

    // `.docx` is text-only: whether an embedded image survives Royal Road's import is
    // unconfirmed, so images are never embedded and the author is told how many went
    // missing rather than finding out from the published chapter.
    expect(result.droppedImageCount).toBe(2);
    expect(result.warnings.map((warning) => warning.code)).toContain('dropped_image');
  });

  it('does not block the export over an image the document was never going to carry', () => {
    // An unuploaded image is a real blocker on the single-chapter path, where Royal
    // Road shows it. Blocking a text-only export for it would refuse work over
    // something that cannot appear in the output at all.
    const chapter = chapterFixture();
    const slots = [illustrationFixture(chapter.id, { remoteUrl: null })];

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      slots,
    );

    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).not.toContain('unuploaded_image');
    expect(result.droppedImageCount).toBe(1);
  });

  it('drops author notes and says so', () => {
    const chapter = chapterFixture({ authorNotePre: 'Thanks for reading.', authorNotePost: 'More next week.' });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    // Bulk import turns everything after a heading into chapter content, so a note in
    // the file would silently become prose the author never wrote as prose.
    expect(result.droppedNoteCount).toBe(1);
    expect(result.warnings.map((warning) => warning.code)).toContain('dropped_author_note');
  });

  it('says nothing about notes when there are none', () => {
    const chapter = chapterFixture();

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    expect(result.droppedNoteCount).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).not.toContain('dropped_author_note');
  });
});

describe('the plan carries no document formatting', () => {
  it('keeps the paragraphs the writer needs and nothing else', () => {
    const chapter = chapterFixture({
      bodyMd: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
    });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    expect(result.chapters[0].paragraphs).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'Third paragraph.',
    ]);
    expect(result.chapters[0].title).toBe('The Third Seal');
  });

  it('counts every paragraph so the writer can be checked against it', () => {
    const chapter = chapterFixture({ bodyMd: 'One.\n\nTwo.' });

    const result = planVolumeDocx(
      {
        volumes: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'Volume One',
            arcs: [{ id: ARC_ONE, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    expect(result.paragraphCount).toBe(2);
  });
});