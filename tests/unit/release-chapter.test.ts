import { describe, expect, it } from 'vitest';
import type { Chapter, Illustration } from '../../electron/ipc/contract.js';
import { buildChapterRelease } from '../../electron/lib/release-chapter.js';
import { escapeHtmlAttribute, escapeHtmlText } from '../../electron/lib/html-escape.js';

/**
 * Release preview assembly.
 *
 * The rules asserted here are Royal Road's, not preferences. The reason each test
 * exists is that breaking it produces output rather than an error: a chapter with a
 * literal `*`, an image that lands late, or an unescaped quote in alt text all
 * publish successfully and look approximately right to the author. The preview is
 * the only place those get caught.
 */

const CHAPTER_ID = '11111111-1111-4111-8111-111111111111';

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: '22222222-2222-4222-8222-222222222222',
    title: 'The Third Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    // Long enough to clear Royal Road's 500 character floor in most tests; the
    // tests that care about length override it.
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

function illustrationFixture(overrides: Partial<Illustration> = {}): Illustration {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    chapterId: CHAPTER_ID,
    afterParagraphIndex: 0,
    localPath: 'C:/storyboard/ch3/seal.png',
    remoteUrl: 'https://files.catbox.moe/abc123.png',
    provider: 'catbox',
    width: 900,
    height: 600,
    altText: 'A cracked stone seal, split down the middle',
    caption: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Builds a body with exactly `count` paragraphs, each easily identifiable. */
function bodyWithParagraphs(count: number): string {
  return Array.from({ length: count }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n');
}

describe('body assembly', () => {  it('emits one block per paragraph in order', () => {
    const release = buildChapterRelease(chapterFixture({ bodyMd: bodyWithParagraphs(4) }), []);

    expect(release.blocks).toHaveLength(4);
    expect(release.blocks[0]).toEqual({ kind: 'paragraph', html: 'Paragraph 1.', paragraphIndex: 0 });
    expect(release.blocks[3]).toEqual({ kind: 'paragraph', html: 'Paragraph 4.', paragraphIndex: 3 });
  });

  it('converts emphasis rather than publishing asterisks', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: 'A **bold** claim.\n\nAnd an *italic* one.' }),
      [],
    );

    const paragraphs = release.blocks.map((block) => block.html);
    expect(paragraphs).toEqual(['A <b>bold</b> claim.', 'And an <i>italic</i> one.']);
  });
});

describe('Royal Road image rules', () => {
  it('hotlinks the image and never re-hosts it', () => {
    // Royal Road provides no internal image hosting, so the tag must carry the
    // permanent remote URL rather than a local path.
    const release = buildChapterRelease(chapterFixture(), [illustrationFixture()]);

    expect(release.blocks[1]).toMatchObject({
      kind: 'image',
      imageHtml:
        '<img src="https://files.catbox.moe/abc123.png" width="900" height="600" ' +
        'alt="A cracked stone seal, split down the middle">',
    });
  });

  it('emits no class attribute on the image', () => {
    const release = buildChapterRelease(chapterFixture(), [illustrationFixture()]);

    expect(release.blocks[1]?.kind === 'image' && release.blocks[1].imageHtml).not.toMatch(
      /class=/i,
    );
  });

  it('reports a repeated problem once', () => {
    // Two slots missing the same thing produce the same sentence. Two identical
    // lines are noise the author reads past to find the distinct problem beneath.
    const release = buildChapterRelease(chapterFixture(), [
      illustrationFixture({ remoteUrl: null, provider: 'manual', altText: 'A seal' }),
      illustrationFixture({
        id: '44444444-4444-4444-8444-444444444444',
        remoteUrl: null,
        provider: 'manual',
        altText: 'A seal',
      }),
    ]);

    const unuploaded = release.warnings.filter((entry) => entry.code === 'unuploaded_image');
    expect(unuploaded).toHaveLength(1);
  });

  it('places the image directly after the paragraph it is anchored to', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: bodyWithParagraphs(3) }),
      [illustrationFixture({ afterParagraphIndex: 1 })],
    );

    expect(release.blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
      'image',
      'paragraph',
    ]);
  });

  it('renders a caption as a paragraph rather than a figure element', () => {
    // Royal Road has no figure or caption concept.
    const release = buildChapterRelease(
      chapterFixture(),
      [illustrationFixture({ caption: 'The **second** seal.' })],
    );

    const image = release.blocks.find((block) => block.kind === 'image');
    expect(image?.kind === 'image' && image.captionHtml).toBe('The <b>second</b> seal.');
  });

  it('orders several images anchored to the same paragraph', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: bodyWithParagraphs(2) }),
      [
        illustrationFixture({ id: '44444444-4444-4444-8444-444444444444', altText: 'second' }),
        illustrationFixture({ altText: 'first' }),
      ],
    );

    const alts = release.blocks
      .filter((block) => block.kind === 'image')
      .map((block) => (block.kind === 'image' ? block.imageHtml : ''));
    expect(alts[0]).toContain('alt="second"');
    expect(alts[1]).toContain('alt="first"');
  });

  it('blocks an image that has a local file but no public URL', () => {
    const release = buildChapterRelease(
      chapterFixture(),
      [illustrationFixture({ remoteUrl: null, provider: 'manual' })],
    );

    const warning = release.warnings.find((entry) => entry.code === 'unuploaded_image');
    expect(warning?.severity).toBe('blocker');
    expect(warning?.message).toMatch(/no public URL/i);
  });

  it('blocks an image with no alt text', () => {
    const release = buildChapterRelease(
      chapterFixture(),
      [illustrationFixture({ altText: '   ' })],
    );

    const warning = release.warnings.find((entry) => entry.code === 'missing_alt');
    expect(warning?.severity).toBe('blocker');
  });

  it('warns about missing dimensions without inventing them', () => {
    const release = buildChapterRelease(
      chapterFixture(),
      [illustrationFixture({ width: null, height: null })],
    );

    const warning = release.warnings.find((entry) => entry.code === 'unknown_dimensions');
    expect(warning?.severity).toBe('warning');
    const image = release.blocks.find((block) => block.kind === 'image');
    expect(image?.kind === 'image' && image.imageHtml).toBe(
      '<img src="https://files.catbox.moe/abc123.png" alt="A cracked stone seal, split down the middle">',
    );
  });
});

describe('misplaced image anchors', () => {
  it('reports an anchor past the end of the chapter instead of dropping the image', () => {
    // AGENTS.md: when the paragraph count drops below a slot's index, warn so it can
    // be re-anchored deliberately. Never silently re-anchor.
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: bodyWithParagraphs(2) }),
      [illustrationFixture({ afterParagraphIndex: 7 })],
    );

    const warning = release.warnings.find((entry) => entry.code === 'anchor_out_of_range');
    expect(warning?.message).toMatch(/only has 2 paragraph/i);

    const images = release.blocks.filter((block) => block.kind === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]?.kind === 'image' && images[0].isMisplaced).toBe(true);
  });

  it('still shows a valid anchor as correctly placed', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: bodyWithParagraphs(3) }),
      [illustrationFixture({ afterParagraphIndex: 2 })],
    );

    const images = release.blocks.filter((block) => block.kind === 'image');
    expect(images[0]?.kind === 'image' && images[0].isMisplaced).toBe(false);
    expect(release.warnings.some((entry) => entry.code === 'anchor_out_of_range')).toBe(false);
  });
});

describe('author notes', () => {
  it('converts both notes and leaves them out of the body blocks', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: bodyWithParagraphs(1), authorNotePre: 'Starts **here**.', authorNotePost: 'Discord.' }),
      [],
    );

    expect(release.preNoteHtml).toBe('Starts <b>here</b>.');
    expect(release.postNoteHtml).toBe('Discord.');
    expect(release.blocks).toHaveLength(1);
  });

  it('labels an unconverted construct in a note so it is findable', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: bodyWithParagraphs(1), authorNotePre: '## Schedule' }),
      [],
    );

    const warning = release.warnings.find((entry) => entry.code === 'unconverted_markdown');
    expect(warning?.message).toMatch(/^Author note:/);
  });
});

describe('publish gates', () => {
  it('blocks a chapter under Royal Road 500 character minimum', () => {
    const release = buildChapterRelease(chapterFixture({ bodyMd: 'Too short.' }), []);

    expect(
      release.warnings.find((entry) => entry.code === 'too_short')?.severity,
    ).toBe('blocker');
  });

  it('blocks a chapter that is still an outline', () => {
    const release = buildChapterRelease(chapterFixture({ status: 'outline' }), []);

    expect(release.warnings.find((entry) => entry.code === 'not_finished')?.severity).toBe(
      'blocker',
    );
  });

  it('only warns above the recommended word ceiling', () => {
    const release = buildChapterRelease(chapterFixture({ wordCount: 12_000 }), []);

    const warning = release.warnings.find((entry) => entry.code === 'over_length');
    expect(warning?.severity).toBe('warning');
  });

  it('keeps two problems that share a severity, because they are two fixes', () => {
    const release = buildChapterRelease(chapterFixture({ status: 'outline', bodyMd: 'Short.' }), []);

    const codes = release.warnings.map((entry) => entry.code);
    expect(codes).toContain('not_finished');
    expect(codes).toContain('too_short');
  });

  it('reports nothing for a chapter that is ready to publish', () => {
    // The default fixture body clears the 500 character floor and carries no
    // untranslatable markup, which is the state a release is ready in.
    const release = buildChapterRelease(chapterFixture(), []);

    expect(release.warnings).toEqual([]);
  });
});

describe('interludes', () => {
  it('marks an interlude as excluded and explains why', () => {
    const release = buildChapterRelease(chapterFixture({ type: 'interlude' }), []);

    expect(release.isExcluded).toBe(true);
    expect(release.exclusionReason).toMatch(/not part of the main arc/i);
  });

  it('still renders the body, so the author can see what the chapter says', () => {
    // Excluding it from the release is not the same as pretending it does not exist.
    const release = buildChapterRelease(
      chapterFixture({ type: 'interlude', bodyMd: bodyWithParagraphs(2) }),
      [],
    );

    expect(release.blocks).toHaveLength(2);
  });

  it('includes a prologue or epilogue in the release', () => {
    expect(buildChapterRelease(chapterFixture({ type: 'prologue' }), []).isExcluded).toBe(false);
    expect(buildChapterRelease(chapterFixture({ type: 'epilogue' }), []).isExcluded).toBe(false);
  });
});

describe('escaping', () => {
  it('escapes a double quote in alt text so it cannot break out of the attribute', () => {
    const release = buildChapterRelease(
      chapterFixture(),
      [illustrationFixture({ altText: 'The "third" seal' })],
    );

    const image = release.blocks.find((block) => block.kind === 'image');
    expect(image?.kind === 'image' && image.imageHtml).toContain('alt="The &quot;third&quot; seal"');
  });

  it('escapes an ampersand in a URL exactly once', () => {
    const release = buildChapterRelease(
      chapterFixture(),
      [illustrationFixture({ remoteUrl: 'https://host.invalid/a?x=1&y=2' })],
    );

    const image = release.blocks.find((block) => block.kind === 'image');
    expect(image?.kind === 'image' && image.imageHtml).toContain('src="https://host.invalid/a?x=1&amp;y=2"');
  });
});

describe('html escaping helpers', () => {
  it('escapes text content but leaves quotes readable', () => {
    expect(escapeHtmlText('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d "e"');
  });

  it('escapes quotes in attributes', () => {
    expect(escapeHtmlAttribute('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('escapes ampersands before anything else', () => {
    expect(escapeHtmlText('&lt;')).toBe('&amp;lt;');
  });
});

describe('publishing profile', () => {
  /**
   * Royal Road's length rules are that site's rules. A plain manuscript is not
   * published there, so applying them would produce blockers the author cannot act on
   * and would teach them to ignore the ones that matter.
   */
  it('applies Royal Road length gates by default', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: 'Short.', wordCount: 1 }),
      [],
    );
    const codes = release.warnings.map((warning) => warning.code);
    expect(codes).toContain('too_short');
  });

  it('skips length gates for a plain manuscript but keeps the real problems', () => {
    const release = buildChapterRelease(
      chapterFixture({ bodyMd: 'Short.', wordCount: 1, status: 'outline' }),
      [],
      { profile: 'plain' },
    );
    const codes = release.warnings.map((warning) => warning.code);
    expect(codes).not.toContain('too_short');
    expect(codes).not.toContain('over_length');
    // An outline has nothing to publish in any profile.
    expect(codes).toContain('not_finished');
  });
});