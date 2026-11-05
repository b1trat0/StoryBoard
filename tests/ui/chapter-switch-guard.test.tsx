// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.js';
import type { Chapter, OutlineTree } from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * Switching chapters with unsaved prose.
 *
 * The buffer no longer dies when the author looks at another section, but switching
 * chapters still replaces it: that one is a genuine move away from the text. So the
 * shell asks first.
 *
 * This is an App test on purpose. The guard is four lines in the shell and nothing at
 * all in the editor, so a test of either half on its own would pass whether or not the
 * guard was wired up at all — which is the regression worth catching.
 */

const ARC_ID = '30000000-0000-4000-8000-000000000001';
const FIRST_ID = '40000000-0000-4000-8000-000000000001';
const SECOND_ID = '40000000-0000-4000-8000-000000000002';

function chapter(id: string, title: string, bodyMd = ''): Chapter {
  return {
    id,
    arcId: ARC_ID,
    title,
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd,
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 0,
    publishedAt: null,
    rrUrl: null,
  };
}

function treeFixture(): OutlineTree {
  return {
    volumes: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        projectId: '00000000-0000-4000-8000-000000000001',
        title: 'Volume One',
        ordinal: 1,
        summary: '',
        arcs: [
          {
            id: ARC_ID,
            volumeId: '20000000-0000-4000-8000-000000000001',
            title: 'The Ash Gate',
            ordinal: 1,
            summary: '',
            chapters: [
              {
                id: FIRST_ID,
                arcId: ARC_ID,
                title: 'The Seal',
                ordinal: 1,
                type: 'chapter',
                status: 'draft',
                povEntityId: null,
                wordCount: 0,
                publishedAt: null,
              },
              {
                id: SECOND_ID,
                arcId: ARC_ID,
                title: 'The bargain',
                ordinal: 2,
                type: 'chapter',
                status: 'draft',
                povEntityId: null,
                wordCount: 0,
                publishedAt: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

function installBridge() {
  const byId = new Map<string, Chapter>([
    [FIRST_ID, chapter(FIRST_ID, 'The Seal')],
    [SECOND_ID, chapter(SECOND_ID, 'The bargain')],
  ]);
  const get = vi.fn(async ({ id }: { id: string }) => byId.get(id) ?? null);
  const saveProse = vi.fn(async (input: { id: string }) => byId.get(input.id) ?? null);
  const setDirty = vi.fn(async () => undefined);
  const confirmQuit = vi.fn(async () => undefined);
  const setActive = vi.fn(async () => undefined);

  (window as { storyboard?: unknown }).storyboard = {
    entities: { list: vi.fn(async () => []) },
    outline: { list: vi.fn(async () => treeFixture()) },
    chapters: { get, saveProse },
    projects: {
      list: vi.fn(async () => [
        {
          id: '00000000-0000-4000-8000-000000000001',
          title: 'My Serial',
          kind: 'light_novel',
          exportProfile: 'royal_road',
          summary: '',
          archivedAt: null,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          title: 'Second Work',
          kind: 'novel',
          exportProfile: 'plain',
          summary: '',
          archivedAt: null,
          createdAt: '2026-11-02T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
      ]),
      getActive: vi.fn(async () => ({
        projectId: '00000000-0000-4000-8000-000000000001',
      })),
      setActive,
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
    },
    editorSafety: {
      setDirty,
      confirmQuit,
      onSaveAndQuit: vi.fn(() => () => undefined),
    },
    drafts: {
      save: vi.fn(async () => undefined),
      read: vi.fn(async () => null),
      clear: vi.fn(async () => undefined),
    },
  };
  return { get, saveProse, setDirty, confirmQuit, setActive };
}

function setValue(element: HTMLElement, value: string) {
  const input = element as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Opens the Chapters section and selects the first chapter, as an author would. */
async function openFirstChapter(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Chapters' }));
  // Volumes and arcs start collapsed, so the walk down to a chapter is real.
  fireEvent.click(await screen.findByText('Volume One'));
  fireEvent.click(await screen.findByText('The Ash Gate'));
  fireEvent.click(await screen.findByText('The Seal'));
  await screen.findByLabelText('Chapter prose');
}

let bridge: ReturnType<typeof installBridge>;

beforeEach(() => {
  bridge = installBridge();
  render(<App />);
});

afterEach(() => {
  cleanup();
  delete (window as { storyboard?: unknown }).storyboard;
  vi.restoreAllMocks();
});

describe('leaving a chapter with unsaved prose', () => {
  it('asks before switching, rather than discarding silently', async () => {
    installBridge();
    await openFirstChapter();

    setValue(screen.getByLabelText('Chapter prose'), 'A sentence I have not saved.');
    fireEvent.click(screen.getByText('The bargain'));

    // The guard names the chapter the prose belongs to, so the choice is concrete.
    expect(
      await screen.findByText(/"The Seal" has prose you have not saved\./),
    ).toBeTruthy();
  });

  it('keeps the prose when the author backs out', async () => {
    const { get } = installBridge();
    await openFirstChapter();

    setValue(screen.getByLabelText('Chapter prose'), 'A sentence I have not saved.');
    fireEvent.click(screen.getByText('The bargain'));
    fireEvent.click(await screen.findByRole('button', { name: /keep writing/i }));

    // Still on the first chapter, still holding the words.
    expect(screen.queryByLabelText('Chapter prose')).toBeTruthy();
    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'A sentence I have not saved.',
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('switches chapters when the author chooses to discard', async () => {
    const { get } = installBridge();
    await openFirstChapter();

    setValue(screen.getByLabelText('Chapter prose'), 'A sentence I have not saved.');
    fireEvent.click(screen.getByText('The bargain'));
    fireEvent.click(await screen.findByRole('button', { name: /discard and switch/i }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    // The editor is now showing the chapter that was switched to.
    await waitFor(() =>
      expect((screen.getByLabelText('Chapter title') as HTMLInputElement).value).toBe(
        'The bargain',
      ),
    );
  });

  it('does not interrupt a switch when nothing is unsaved', async () => {
    const { get } = installBridge();
    await openFirstChapter();

    fireEvent.click(screen.getByText('The bargain'));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Unsaved prose')).toBeNull();
  });
});

describe('switching works', () => {
  it('blocks the switch while prose is unsaved', async () => {
    await openFirstChapter();
    setValue(screen.getByLabelText('Chapter prose'), 'Only on screen so far.');

    // Disabled is the honest signal: there is no chapter buffer to move to another work.
    await waitFor(() =>
      expect((screen.getByLabelText('Work') as HTMLSelectElement).disabled).toBe(true),
    );
    expect(bridge.setActive).not.toHaveBeenCalled();
  });

  it('allows the switch once the prose is saved, and remembers the choice', async () => {
    await openFirstChapter();
    setValue(screen.getByLabelText('Chapter prose'), 'Saved before switching.');
    fireEvent.click(screen.getByRole('button', { name: /save prose/i }));

    await waitFor(() =>
      expect((screen.getByLabelText('Work') as HTMLSelectElement).disabled).toBe(false),
    );

    fireEvent.change(screen.getByLabelText('Work'), {
      target: { value: '00000000-0000-4000-8000-000000000002' },
    });

    await waitFor(() =>
      expect(bridge.setActive).toHaveBeenCalledWith({
        projectId: '00000000-0000-4000-8000-000000000002',
      }),
    );
  });
});

describe('closing the window', () => {
  it('tells the main process that prose is unsaved, so the close can be intercepted', async () => {
    await openFirstChapter();

    // App mounts with a clean buffer.
    await waitFor(() => expect(bridge.setDirty).toHaveBeenCalledWith({ isDirty: false }));

    setValue(screen.getByLabelText('Chapter prose'), 'Words that exist only on screen.');
    await waitFor(() => expect(bridge.setDirty).toHaveBeenCalledWith({ isDirty: true }));

    fireEvent.click(screen.getByRole('button', { name: /save prose/i }));
    await waitFor(() => expect(bridge.setDirty).toHaveBeenCalledWith({ isDirty: false }));
  });
});