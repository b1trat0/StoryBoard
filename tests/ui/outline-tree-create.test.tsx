// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutlineTree } from '../../src/features/chapters/outline-tree.js';
import type { OutlineState } from '../../src/features/chapters/use-outline.js';
import type { Arc, Chapter, Volume } from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * Creating a volume and an arc from the tree.
 *
 * The submit button for these dialogs lives in the dialog footer, outside the
 * <form>, and is wired back to it with a form attribute. That indirection is easy
 * to break in a way that looks fine: the button renders, it is enabled, and
 * clicking it silently does nothing.
 */

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const VOLUME_ID = '20000000-0000-4000-8000-000000000001';

interface Stub {
  createVolume: ReturnType<typeof vi.fn>;
  createArc: ReturnType<typeof vi.fn>;
  createChapter: ReturnType<typeof vi.fn>;
}

function installBridge(): Stub {
  const stub: Stub = {
    createVolume: vi.fn(async () => ({
      id: VOLUME_ID,
      projectId: PROJECT_ID,
      title: 'The Ashen Crown',
      ordinal: 1,
      summary: '',
    }) as Volume),
    createArc: vi.fn(async () => ({
      id: '30000000-0000-4000-8000-000000000001',
      volumeId: VOLUME_ID,
      title: 'The Cinders',
      ordinal: 1,
      summary: '',
    }) as Arc),
    createChapter: vi.fn(async () => ({}) as Chapter),
  };
  (window as { storyboard?: unknown }).storyboard = {
    outline: {
      list: vi.fn(async () => ({ volumes: [] })),
      describeDeletion: vi.fn(),
      createVolume: stub.createVolume,
      updateVolume: vi.fn(),
      removeVolume: vi.fn(),
      createArc: stub.createArc,
      updateArc: vi.fn(),
      removeArc: vi.fn(),
    },
    chapters: {
      listByArc: vi.fn(),
      get: vi.fn(),
      create: stub.createChapter,
      remove: vi.fn(),
      saveBody: vi.fn(),
      saveOutline: vi.fn(),
    },
  };
  return stub;
}

function controller(overrides: Partial<OutlineState> = {}): OutlineState {
  return {
    tree: { volumes: [] },
    isLoading: false,
    errorMessage: null,
    pendingKey: null,
    chapter: null,
    isChapterLoading: false,
    reload: vi.fn(async () => undefined),
    openChapter: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => ({ id: VOLUME_ID }) as Volume),
    createArc: vi.fn(async () => ({ id: 'arc' }) as Arc),
    createChapter: vi.fn(async () => ({ id: 'chapter' }) as Chapter),
    removeNode: vi.fn(async () => undefined),
    ...overrides,
  };
}

function setValue(element: HTMLElement, value: string) {
  const input = element as HTMLInputElement | HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  installBridge();
});

afterEach(() => {
  cleanup();
  delete (window as { storyboard?: unknown }).storyboard;
  vi.restoreAllMocks();
});

describe('adding a volume', () => {
  it('opens the volume dialog from the empty state', async () => {
    render(<OutlineTree outline={controller()} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toMatch(/new volume/i);
  });

  it('opens the volume dialog from the toolbar once a volume exists', async () => {
    render(
      <OutlineTree
        outline={controller({
          tree: {
            volumes: [
              {
                id: VOLUME_ID,
                projectId: PROJECT_ID,
                title: 'Existing',
                ordinal: 1,
                summary: '',
                arcs: [],
              },
            ],
          },
        })}
        selectedChapterId={null}
        onSelectChapter={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^volume$/i }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('creates the volume when Add volume is pressed', async () => {
    const state = controller();
    render(<OutlineTree outline={state} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));
    setValue(await screen.findByLabelText('Title'), 'The Ashen Crown');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /add volume/i }));

    await waitFor(() => expect(state.createVolume).toHaveBeenCalledTimes(1));
    expect(state.createVolume).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'The Ashen Crown' }),
    );
  });

  it('closes the dialog after a volume is created', async () => {
    const state = controller();
    render(<OutlineTree outline={state} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));
    setValue(await screen.findByLabelText('Title'), 'The Ashen Crown');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /add volume/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('submits when the author presses Enter in the title field', async () => {
    const state = controller();
    render(<OutlineTree outline={state} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));
    const title = await screen.findByLabelText('Title');
    setValue(title, 'The Ashen Crown');
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    await waitFor(() => expect(state.createVolume).toHaveBeenCalledTimes(1));
  });

  it('keeps the submit button disabled until a title is typed', async () => {
    render(<OutlineTree outline={controller()} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: /add volume/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    setValue(screen.getByLabelText('Title'), 'X');

    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it('does not create anything from a whitespace-only title', async () => {
    const state = controller();
    render(<OutlineTree outline={state} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));
    setValue(await screen.findByLabelText('Title'), '   ');
    fireEvent.submit(screen.getByLabelText('Title').closest('form') as HTMLFormElement);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(state.createVolume).not.toHaveBeenCalled();
  });

  it('shows the reason when the database refuses the volume', async () => {
    const state = controller({
      createVolume: vi.fn(async () => {
        throw new Error('Give it a title first.');
      }),
    });
    render(<OutlineTree outline={state} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add volume/i }));
    setValue(await screen.findByLabelText('Title'), 'The Ashen Crown');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /add volume/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/title/i));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/title/i));
    // The dialog stays open with the typed title so the author does not retype it.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('The Ashen Crown');
  });
});

describe('adding an arc', () => {
  const treeWithVolume = {
    volumes: [
      {
        id: VOLUME_ID,
        projectId: PROJECT_ID,
        title: 'Existing',
        ordinal: 1,
        summary: '',
        arcs: [],
      },
    ],
  };

  it('creates an arc under the volume it was launched from', async () => {
    const state = controller({ tree: treeWithVolume });
    render(<OutlineTree outline={state} selectedChapterId={null} onSelectChapter={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add arc to Existing' }));
    setValue(await screen.findByLabelText('Title'), 'The Cinders');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /add arc/i }));

    await waitFor(() => expect(state.createArc).toHaveBeenCalledTimes(1));
    expect(state.createArc).toHaveBeenCalledWith(
      expect.objectContaining({ volumeId: VOLUME_ID, title: 'The Cinders' }),
    );
  });
});
