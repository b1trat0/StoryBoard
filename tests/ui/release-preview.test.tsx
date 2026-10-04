// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleasePreview } from '../../src/features/export/release-preview.js';
import type { ChapterRelease, ReleaseWarning } from '../../src/lib/bridge.js';

/**
 * The release preview screen.
 *
 * The preview is the only place an author finds out that a chapter will publish
 * wrong. Everything it renders comes back already escaped from the main process, so
 * these tests check two things: that the HTML shown is the HTML that will be sent,
 * and that a blocker is visually louder than an advisory. A preview that renders
 * both in the same tone trains the author to read past the one that matters.
 */

const CHAPTER_ID = '50000000-0000-4000-8000-000000000001';

function warningFixture(overrides: Partial<ReleaseWarning> = {}): ReleaseWarning {
  return {
    code: 'unknown_dimensions',
    severity: 'warning',
    message: 'Image "A seal" has no recorded width and height.',
    ...overrides,
  };
}

function releaseFixture(overrides: Partial<ChapterRelease> = {}): ChapterRelease {
  return {
    chapterId: CHAPTER_ID,
    title: 'The Third Seal',
    preNoteHtml: '',
    blocks: [
      { kind: 'paragraph', html: 'Kael pressed his palm to the <b>ward</b>.', paragraphIndex: 0 },
      { kind: 'paragraph', html: 'It held.', paragraphIndex: 1 },
    ],
    postNoteHtml: '',
    wordCount: 2100,
    isExcluded: false,
    exclusionReason: null,
    warnings: [],
    ...overrides,
  };
}

/** Installs a bridge returning one release, and returns the spy. */
function installBridge(release: ChapterRelease | Error) {
  const previewChapter = vi.fn(async () => {
    if (release instanceof Error) {
      throw release;
    }
    return release;
  });
  (globalThis as { window?: Window }).window!.storyboard = {
    release: { previewChapter },
  } as never;
  return { previewChapter };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Flattens the rendered body into one entry per meaningful node, ignoring the
 * break tags the converter inserts between blocks.
 */
function sequenceOf(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? '';
      if (text !== '') {
        out.push(text);
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const element = node as HTMLElement;
    if (element.tagName === 'IMG') {
      out.push('image');
    } else if (element.tagName !== 'BR') {
      out.push(element.textContent?.trim() ?? '');
    }
  }
  return out;
}

describe('choosing a chapter', () => {
  it('asks for nothing and explains itself when no chapter is selected', () => {
    installBridge(releaseFixture());
    render(<ReleasePreview chapterId={null} isOutlineLoading={false} />);

    expect(screen.getByText(/pick a chapter to preview/i)).toBeTruthy();
  });
});

describe('the rendered body', () => {
  it('shows the chapter title and word count', async () => {
    installBridge(releaseFixture());
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect(await screen.findByRole('heading', { name: 'The Third Seal' })).toBeTruthy();
    expect(screen.getByText(/2,100 words/)).toBeTruthy();
  });

  it('renders the converted HTML rather than the raw markdown', async () => {
    // The whole reason this screen exists: a re-render from the source would hide
    // the exact differences the preview is meant to reveal.
    installBridge(releaseFixture());
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    const body = await screen.findByTestId('release-body');
    expect(body.querySelector('b')?.textContent).toBe('ward');
    expect(body.textContent).not.toContain('**');
  });

  it('places an image after the paragraph it is anchored to', async () => {
    installBridge(
      releaseFixture({
        blocks: [
          { kind: 'paragraph', html: 'Before.', paragraphIndex: 0 },
          {
            kind: 'image',
            imageHtml: '<img src="https://host.invalid/a.png" width="900" height="600" alt="A seal">',
            captionHtml: '',
            illustrationId: '60000000-0000-4000-8000-000000000001',
            afterParagraphIndex: 0,
            isMisplaced: false,
          },
          { kind: 'paragraph', html: 'After.', paragraphIndex: 1 },
        ],
      }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    const body = await screen.findByTestId('release-body');
    const image = body.querySelector('img');
    expect(image?.getAttribute('alt')).toBe('A seal');
    // Order is the thing under test, so compare it directly: the blocks are joined
    // with break tags, so the image's previous sibling is a <br>, not the paragraph.
    expect(sequenceOf(body)).toEqual(['Before.', 'image', 'After.']);
  });

  it('shows a caption under its image', async () => {
    installBridge(
      releaseFixture({
        blocks: [
          {
            kind: 'image',
            imageHtml: '<img src="https://host.invalid/a.png" alt="A seal">',
            captionHtml: 'The <b>second</b> seal.',
            illustrationId: '60000000-0000-4000-8000-000000000001',
            afterParagraphIndex: 0,
            isMisplaced: false,
          },
        ],
      }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    const body = await screen.findByTestId('release-body');
    expect(body.querySelector('em')?.textContent).toBe('The second seal.');
  });

  it('renders a scene break as a rule', async () => {
    installBridge(
      releaseFixture({
        blocks: [
          { kind: 'paragraph', html: 'Before.', paragraphIndex: 0 },
          { kind: 'paragraph', html: '<hr />', paragraphIndex: 1 },
        ],
      }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect((await screen.findByTestId('release-body')).querySelector('hr')).toBeTruthy();
  });

  it('puts both author notes outside the body, in their own sections', async () => {
    // Royal Road's form keeps Author Notes separate from Chapter Content, so the
    // preview must not fold them into the prose.
    installBridge(releaseFixture({ preNoteHtml: 'Starts <b>here</b>.', postNoteHtml: 'Discord.' }));
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    // Wait for the load to land before asserting on anything rendered from it.
    const body = await screen.findByTestId('release-body');
    const pre = screen.getByText('Pre-chapter note').closest('section');
    const post = screen.getByText('Post-chapter note').closest('section');
    expect(pre?.querySelector('b')?.textContent).toBe('here');
    expect(post?.textContent).toContain('Discord.');

    // Neither note leaked into the chapter body.
    expect(body.textContent).not.toContain('Starts');
    expect(body.textContent).not.toContain('Discord');
  });
});

describe('publish readiness', () => {
  it('says a clean chapter is ready', async () => {
    installBridge(releaseFixture({ warnings: [] }));
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect(await screen.findByText(/ready to publish/i)).toBeTruthy();
  });

  it('lists a blocker and an advisory when both exist', async () => {
    installBridge(
      releaseFixture({
        warnings: [
          warningFixture({ code: 'unuploaded_image', severity: 'blocker', message: 'No public URL.' }),
          warningFixture({ code: 'unknown_dimensions', severity: 'warning', message: 'No dimensions.' }),
        ],
      }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect(await screen.findByText('No public URL.')).toBeTruthy();
    expect(screen.getByText('No dimensions.')).toBeTruthy();
    // Not a green light when a blocker exists.
    expect(screen.queryByText(/ready to publish/i)).toBeNull();
  });

  it('renders every warning it is given', async () => {
    // Uniqueness is the assembler's guarantee, not the screen's. The screen's job is
    // to show all of them, and asserting otherwise here would test the wrong layer.
    installBridge(
      releaseFixture({
        warnings: [
          warningFixture({ code: 'unuploaded_image', severity: 'blocker', message: 'No public URL.' }),
          warningFixture({ code: 'missing_alt', severity: 'blocker', message: 'An image has no alt text.' }),
        ],
      }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect(await screen.findByText('No public URL.')).toBeTruthy();
    expect(screen.getByText('An image has no alt text.')).toBeTruthy();
  });
});

describe('excluded chapters', () => {
  it('marks an interlude as not part of the release and says why', async () => {
    installBridge(
      releaseFixture({
        isExcluded: true,
        exclusionReason: 'Interludes stay on the timeline but are not part of the main arc.',
      }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect(await screen.findByText(/not part of this release/i)).toBeTruthy();
    expect(screen.getByText(/not part of the main arc/i)).toBeTruthy();
  });

  it('still shows the body of an excluded chapter', async () => {
    // Excluding a chapter from the output is not the same as pretending it is unwritten.
    installBridge(
      releaseFixture({ isExcluded: true, exclusionReason: 'Because.', blocks: releaseFixture().blocks }),
    );
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect((await screen.findByTestId('release-body')).textContent).toContain('Kael pressed');
  });
});

describe('failures', () => {
  it('explains a failed preview and offers a retry', async () => {
    installBridge(new Error('That chapter no longer exists.'));
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    expect(await screen.findByText(/could not build the preview/i)).toBeTruthy();
    expect(screen.getByText(/no longer exists/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('refetches for the selected chapter', async () => {
    const { previewChapter } = installBridge(releaseFixture());
    render(<ReleasePreview chapterId={CHAPTER_ID} isOutlineLoading={false} />);

    await waitFor(() => expect(previewChapter).toHaveBeenCalledWith({ chapterId: CHAPTER_ID }));
  });
});