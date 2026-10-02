// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlineTree } from '../../src/features/chapters/outline-tree.js';
import type { OutlineState } from '../../src/features/chapters/use-outline.js';
import type { Arc, Chapter, OutlineTree as OutlineTreeData, Volume } from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * The outline tree.
 *
 * Focus is on the deletion path, because it is the only place the renderer can
 * destroy the author's work. The rule under test: the Delete button stays disabled
 * until the database has reported what the cascade would take. A tree that enabled
 * Delete optimistically would let one stray click destroy a volume of chapters and
 * every fact sourced from them, which is the failure this whole app exists to
 * prevent.
 *
 * The bug this file was written after: describeDeletion was handed a chapter id
 * through a query that filtered on arc_id, so it always answered "that chapter no
 * longer exists" and the author could never delete a chapter at all.
 */

const VOLUME_ID = '20000000-0000-4000-8000-000000000001';
const ARC_ID = '30000000-0000-4000-8000-000000000001';
const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

function treeFixture(): OutlineTreeData {
  return {
    volumes: [
      {
        id: VOLUME_ID,
        projectId: '10000000-0000-4000-8000-000000000001',
        title: 'Volume One',
        ordinal: 1,
        summary: '',
        arcs: [
          {
            id: ARC_ID,
            volumeId: VOLUME_ID,
            title: 'The Ash Gate',
            ordinal: 1,
            summary: '',
            chapters: [
              {
                id: CHAPTER_ID,
                arcId: ARC_ID,
                title: 'The Seal',
                ordinal: 1,
                type: 'chapter',
                status: 'draft',
                povEntityId: null,
                wordCount: 1200,
                publishedAt: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

interface Stub {
  describeDeletion: ReturnType<typeof vi.fn>;
  removeVolume: ReturnType<typeof vi.fn>;
  removeArc: ReturnType<typeof vi.fn>;
  removeChapter: ReturnType<typeof vi.fn>;
  openChapter: ReturnType<typeof vi.fn>;
}

function installBridge(overrides: Partial<Stub> = {}): Stub {
  const stub: Stub = {
    describeDeletion: vi.fn(async ({ kind }: { kind: string }) => ({
      kind,
      id: 'x',
      title: 'x',
      childCount: kind === 'chapter' ? 0 : 2,
      factCount: 3,
      illustrationCount: 1,
      wordCount: 1200,
    })),
    removeVolume: vi.fn(async () => undefined),
    removeArc: vi.fn(async () => undefined),
    removeChapter: vi.fn(async () => undefined),
    openChapter: vi.fn(async () => undefined),
    ...overrides,
  };
  (window as { storyboard?: unknown }).storyboard = {
    outline: {
      describeDeletion: stub.describeDeletion,
      createVolume: vi.fn(),
      updateVolume: vi.fn(),
      removeVolume: stub.removeVolume,
      createArc: vi.fn(),
      updateArc: vi.fn(),
      removeArc: stub.removeArc,
    },
    chapters: {
      listByArc: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      remove: stub.removeChapter,
      saveBody: vi.fn(),
      saveOutline: vi.fn(),
    },
  };
  return stub;
}

function outlineStub(overrides: Partial<OutlineState> = {}): OutlineState {
  return {
    tree: treeFixture(),
    isLoading: false,
    errorMessage: null,
    pendingKey: null,
    chapter: null,
    isChapterLoading: false,
    reload: vi.fn(async () => undefined),
    openChapter: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => ({}) as Volume),
    createArc: vi.fn(async () => ({}) as Arc),
    createChapter: vi.fn(async () => ({}) as Chapter),
    removeNode: vi.fn(async () => undefined),
    ...overrides,
  };
}

/**
 * Everything the tree renders is behind collapsed parents until they are opened.
 *
 * The names are anchored because each row also carries "Add arc to Volume One" and
 * "Delete Volume One" buttons, which a loose matcher would also match.
 */
async function expandAll() {
  for (const label of [/^Volume One/, /^The Ash Gate/]) {
    const toggle = screen.getByRole('button', { name: label });
    if (toggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(toggle);
    }
  }
}

function renderTree(
  stub: Stub = installBridge(),
  overrides: Partial<OutlineState> = {},
): { stub: Stub; controller: OutlineState } {
  const controller = outlineStub(overrides);
  render(
    <OutlineTree
      outline={controller}
      selectedChapterId={null}
      onSelectChapter={() => undefined}
    />,
  );
  return { stub, controller };
}

afterEach(() => {
  cleanup();
  delete (window as { storyboard?: unknown }).storyboard;
  vi.restoreAllMocks();
});

describe('navigation', () => {
  it('shows nothing but the add button until a volume is opened', async () => {
    installBridge();
    renderTree();

    expect(screen.getByText('Volume One')).toBeTruthy();
    expect(screen.queryByText('The Seal')).toBeNull();
  });

  it('reveals arcs and chapters as the author opens them', async () => {
    installBridge();
    renderTree();
    await expandAll();

    expect(screen.getByText('The Seal')).toBeTruthy();
  });

  it('reports the chapter count per volume', async () => {
    installBridge();
    renderTree();

    expect(screen.getByText('Volume One').parentElement?.textContent).toContain('1');
  });

  it('tells the author to start with a volume when there is no outline', () => {
    renderTree(installBridge(), { tree: { volumes: [] } });

    expect(screen.getByText(/no outline yet/i)).toBeTruthy();
  });
});

describe('deleting', () => {
  it('keeps the delete button disabled until the impact is known', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stub = installBridge();
    stub.describeDeletion.mockImplementationOnce(async () => {
      await gate;
      return { kind: 'chapter', id: CHAPTER_ID, title: 'The Seal', childCount: 0, factCount: 0, illustrationCount: 0, wordCount: 0 };
    });
    renderTree(stub);
    await expandAll();

    fireEvent.click(screen.getByRole('button', { name: 'Delete The Seal' }));

    // While the count is unknown the button must not be armed.
    const confirm = await screen.findByRole('button', { name: /delete chapter/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    release?.();
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  });

  it('shows the fact and word counts before asking for confirmation', async () => {
    const stub = installBridge();
    renderTree(stub);
    await expandAll();

    fireEvent.click(screen.getByRole('button', { name: 'Delete The Seal' }));

    // Read as textContent rather than through getByText: each number sits inside a
    // <strong>, and the default matcher only looks at an element's direct text nodes.
    await waitFor(() => {
      const summary = document.body.textContent ?? '';
      expect(summary).toMatch(/3 facts sourced from those chapters/);
      expect(summary).toMatch(/1 illustration/);
      // The whole reason this dialog exists: the author sees the prose at stake.
      expect(summary).toMatch(/1,200 words/);
    });
  });

  it('asks the database about a chapter with the chapter kind, not the arc kind', async () => {
    // The regression: a chapter id routed through an arc filter answers "not found"
    // and the author is stuck.
    const stub = installBridge();
    renderTree(stub);
    await expandAll();

    fireEvent.click(screen.getByRole('button', { name: 'Delete The Seal' }));

    await waitFor(() => expect(stub.describeDeletion).toHaveBeenCalledTimes(1));
    expect(stub.describeDeletion).toHaveBeenCalledWith({ kind: 'chapter', id: CHAPTER_ID });
  });

  it('does not delete anything if the author changes their mind', async () => {
    const stub = installBridge();
    const { controller } = renderTree(stub);
    await expandAll();

    fireEvent.click(screen.getByRole('button', { name: 'Delete The Seal' }));
    const keep = await screen.findByRole('button', { name: /keep it/i });
    fireEvent.click(keep);

    await waitFor(() => expect(screen.queryByRole('button', { name: /keep it/i })).toBeNull());
    expect(controller.removeNode).not.toHaveBeenCalled();
  });

  it('refuses to arm the delete button when the impact cannot be read', async () => {
    const stub = installBridge();
    stub.describeDeletion.mockRejectedValueOnce(new Error('that chapter no longer exists'));
    renderTree(stub);
    await expandAll();

    fireEvent.click(screen.getByRole('button', { name: 'Delete The Seal' }));

    // If the count is unreadable the dialog says so and stays disarmed, rather than
    // inviting a click on a number it never got.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const confirm = screen.getByRole('button', { name: /delete chapter/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });
});
