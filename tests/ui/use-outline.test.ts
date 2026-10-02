// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOutline } from '../../src/features/chapters/use-outline.js';
import type { Chapter, OutlineTree } from '../../src/lib/bridge.js';

/**
 * The outline hook's contract with the tree it renders.
 *
 * A chapter is created with the placeholder title "Untitled chapter". The tree is a
 * snapshot taken when the outline loads, and the open chapter is a separate fetch, so
 * a title saved in the editor reaches the database without reaching the tree unless
 * the save is routed through this hook. The symptom is that the outline keeps showing
 * the placeholder after a successful rename, which the author cannot tell apart from
 * the rename having been lost.
 *
 * These tests therefore assert on the tree the hook publishes, not on whether the
 * bridge was called. Calling the bridge is the old behaviour and it is not the bug.
 */

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const VOLUME_ID = '10000000-0000-4000-8000-000000000001';
const ARC_ID = '30000000-0000-4000-8000-000000000001';
const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

function treeWithChapterTitle(title: string): OutlineTree {
  return {
    volumes: [
      {
        id: VOLUME_ID,
        projectId: PROJECT_ID,
        title: 'Book One',
        ordinal: 1,
        summary: '',
        arcs: [
          {
            id: ARC_ID,
            volumeId: VOLUME_ID,
            title: 'The Kindling',
            ordinal: 1,
            summary: '',
            chapters: [
              {
                id: CHAPTER_ID,
                arcId: ARC_ID,
                title,
                ordinal: 1,
                type: 'chapter',
                status: 'outline',
                povEntityId: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: ARC_ID,
    title: 'Untitled chapter',
    ordinal: 1,
    type: 'chapter',
    status: 'outline',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: '',
    wordCount: 0,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface BridgeSpy {
  list: ReturnType<typeof vi.fn>;
  saveOutline: ReturnType<typeof vi.fn>;
}

/**
 * Installs a bridge whose tree read returns `title` before the save and the renamed
 * title after it, which is what the real database would do.
 */
function installBridge(storedTitle = 'Untitled chapter', renamedTitle = 'The Ash Gate Reborn'): BridgeSpy {
  let saved = false;
  const list = vi.fn(async () =>
    treeWithChapterTitle(saved ? renamedTitle : storedTitle),
  );
  const saveOutline = vi.fn(async () => {
    saved = true;
    return chapterFixture({ title: renamedTitle });
  });
  (window as { storyboard?: unknown }).storyboard = {
    outline: { list },
    chapters: { get: vi.fn(async () => chapterFixture()), saveOutline },
  };
  return { list, saveOutline };
}

/** Reads the chapter title the tree currently shows. */
function shownTitle(tree: OutlineTree): string {
  const chapter = tree.volumes[0]?.arcs[0]?.chapters[0];
  if (chapter === undefined) {
    throw new Error('the fixture tree must contain one chapter');
  }
  return chapter.title;
}

afterEach(() => {
  cleanup();
  delete (window as { storyboard?: unknown }).storyboard;
  vi.restoreAllMocks();
});

describe('saving an outline field from the editor', () => {
  it('shows the new title in the tree after a rename', async () => {
    const bridge = installBridge();
    const { result } = renderHook(() => useOutline(PROJECT_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(shownTitle(result.current.tree)).toBe('Untitled chapter');

    await act(async () => {
      await result.current.saveChapterOutline(CHAPTER_ID, { title: 'The Ash Gate Reborn' });
    });

    // The assertion that matters: the tree the author reads, not the bridge call.
    expect(shownTitle(result.current.tree)).toBe('The Ash Gate Reborn');
    expect(bridge.saveOutline).toHaveBeenCalledTimes(1);
  });

  it('sends only the fields the author changed', async () => {
    const bridge = installBridge();
    const { result } = renderHook(() => useOutline(PROJECT_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveChapterOutline(CHAPTER_ID, { status: 'done' });
    });

    // Prose, counts and timestamps are not outline fields; sending them would let a
    // title edit rewrite the body.
    expect(bridge.saveOutline).toHaveBeenCalledWith({ id: CHAPTER_ID, status: 'done' });
  });

  it('leaves the open chapter alone so unsaved prose is not overwritten', async () => {
    installBridge();
    const { result } = renderHook(() => useOutline(PROJECT_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.openChapter(CHAPTER_ID);
    });
    await waitFor(() => expect(result.current.chapter?.id).toBe(CHAPTER_ID));

    await act(async () => {
      await result.current.saveChapterOutline(CHAPTER_ID, { title: 'The Ash Gate Reborn' });
    });

    // The editor owns its draft and must not be handed a refetched chapter, or prose
    // the author has typed but not saved would revert.
    expect(result.current.chapter?.title).toBe('Untitled chapter');
  });

  it('surfaces a rejected save to the caller instead of swallowing it', async () => {
    (window as { storyboard?: unknown }).storyboard = {
      outline: { list: vi.fn(async () => treeWithChapterTitle('Untitled chapter')) },
      chapters: {
        get: vi.fn(async () => chapterFixture()),
        saveOutline: vi.fn(async () => {
          throw new Error('Could not save that title.');
        }),
      },
    };
    const { result } = renderHook(() => useOutline(PROJECT_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.saveChapterOutline(CHAPTER_ID, { title: 'The Ash Gate Reborn' }),
    ).rejects.toThrow(/title/i);
  });
});
