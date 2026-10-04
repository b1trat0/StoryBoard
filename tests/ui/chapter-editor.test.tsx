// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterEditor } from '../../src/features/chapters/chapter-editor.js';
import type { Chapter } from '../../src/lib/bridge.js';

/**
 * The chapter editor's save rules, in the renderer.
 *
 * The whole reason the editor exists as two paths is that prose must not be written
 * while it is being typed, while the author's own outline notes should not need a
 * button. That is behaviour no repository or service test can see, and it is the
 * kind of rule that quietly regresses: someone tidies the onChange handlers, every
 * keystroke starts hitting Postgres, and nothing fails.
 *
 * No testing-library/user-event here, so interaction goes through fireEvent on the
 * real elements. That keeps the suite on the dependencies already in the manifest.
 */

const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: '30000000-0000-4000-8000-000000000001',
    title: 'The Ash Gate',
    ordinal: 1,
    type: 'chapter',
    status: 'outline',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: '',
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 0,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface BridgeStub {
  saveProse: ReturnType<typeof vi.fn>;
  saveOutline: ReturnType<typeof vi.fn>;
}

/** Installs a minimal window.storyboard. getBridge reads it off the window object. */
function installBridge(): BridgeStub {
  // Mirrors the real service: word_count comes from the body only. Royal Road's page
  // wordcount is computed from chapter content, so counting the author notes here
  // would over-report every chapter that has them.
  const saveProse = vi.fn(async (input: {
    id: string;
    bodyMd: string;
    authorNotePre: string;
    authorNotePost: string;
  }) =>
    chapterFixture({
      bodyMd: input.bodyMd,
      authorNotePre: input.authorNotePre,
      authorNotePost: input.authorNotePost,
      wordCount: input.bodyMd.split(/\s+/).filter(Boolean).length,
    }),
  );
  const saveOutline = vi.fn(async (input: { id: string }) => chapterFixture({ ...input, id: CHAPTER_ID }));
  (window as { storyboard?: unknown }).storyboard = {
    chapters: { saveProse, saveOutline },
  };
  return { saveProse, saveOutline };
}

function setValue(element: HTMLElement, value: string) {
  const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  // React tracks the previous value on the DOM node; without this it treats the
  // change as a no-op and never fires onChange.
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  // A <select> reports through change, not input, so a select-only handler would
  // never fire here.
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Fires React's onBlur.
 *
 * React has delegated onBlur to the native focusout event since v17, so dispatching
 * a plain blur event reaches the DOM listener and nothing else.
 */
function blur(element: HTMLElement) {
  element.dispatchEvent(new Event('focusout', { bubbles: true }));
}

/**
 * Renders the editor the way App does: outline saves leave through the injected
 * function, which is where the outline tree refresh lives.
 *
 * The stub is called through the installed bridge rather than captured in a closure
 * so that the spy a test grabbed from `installBridge` is the same one the editor
 * reaches. A test that stubs the bridge and bypasses this wiring would keep passing
 * after the editor stopped refreshing the tree, which is exactly the regression
 * these tests exist to catch.
 */
function renderEditor(props: { chapter: Chapter | null; isLoading: boolean }) {
  const onSaveOutline = async (id: string, patch: Partial<Chapter>) => {
    const bridge = (
      window as {
        storyboard?: { chapters: { saveOutline: (input: unknown) => Promise<unknown> } };
      }
    ).storyboard;
    await bridge?.chapters.saveOutline({ id, ...patch });
  };
  return render(<ChapterEditor {...props} onSaveOutline={onSaveOutline} />);
}

beforeEach(() => {
  installBridge();
});

afterEach(() => {
  cleanup();
  delete (window as { storyboard?: unknown }).storyboard;
  vi.restoreAllMocks();
});

describe('prose is never written while it is being typed', () => {
  it('sends nothing to the database while the author types', () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    setValue(screen.getByLabelText('Chapter prose'), 'The first sentence of a chapter.');

    expect(stub.saveProse).not.toHaveBeenCalled();
  });

  it('writes the prose only when Save is pressed', async () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    setValue(screen.getByLabelText('Chapter prose'), 'The first sentence.');
    (screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement).click();

    await waitFor(() => expect(stub.saveProse).toHaveBeenCalledTimes(1));
    expect(stub.saveProse).toHaveBeenCalledWith({
      id: CHAPTER_ID,
      bodyMd: 'The first sentence.',
      authorNotePre: '',
      authorNotePost: '',
    });
  });

  it('marks the prose unsaved while it differs from what is stored', () => {
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    expect(screen.getByText('Everything saved')).toBeTruthy();

    setValue(screen.getByLabelText('Chapter prose'), 'Something new.');

    // Named exactly, because the word-count line carries its own lowercase
    // "unsaved" marker and a loose matcher would find two elements.
    expect(screen.getByText('Unsaved prose')).toBeTruthy();
  });

  it('leaves Save disabled when there is nothing to save', () => {
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    const button = screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it('shows a word count that matches what the main process will store', () => {
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    setValue(screen.getByLabelText('Chapter prose'), 'one two three four five');

    expect(screen.getByText('5 words')).toBeTruthy();
  });

  it('keeps unsaved prose on screen when the save fails, so nothing is lost', async () => {
    const stub = installBridge();
    stub.saveProse.mockRejectedValueOnce(new Error('the database is away'));
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    setValue(screen.getByLabelText('Chapter prose'), 'Precious unsaved words.');
    (screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement).click();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/database is away/i));
    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'Precious unsaved words.',
    );
  });
});

describe('the outline commits without a button', () => {
  it('writes an outline field once, when it loses focus', async () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    const goal = screen.getByLabelText('Goal');
    setValue(goal, 'Kael breaks the seal.');
    blur(goal);

    await waitFor(() => expect(stub.saveOutline).toHaveBeenCalledTimes(1));
    expect(stub.saveOutline).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAPTER_ID, outlineGoal: 'Kael breaks the seal.' }),
    );
  });

  it('does not write an outline field on every keystroke', () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    setValue(screen.getByLabelText('Goal'), 'K');
    setValue(screen.getByLabelText('Goal'), 'Ka');
    setValue(screen.getByLabelText('Goal'), 'Kael');

    expect(stub.saveOutline).not.toHaveBeenCalled();
  });

  it('does not rewrite an outline field the author typed nothing into', () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    const goal = screen.getByLabelText('Goal');
    blur(goal);

    expect(stub.saveOutline).not.toHaveBeenCalled();
  });

  it('writes the title on blur, trimmed', async () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    const title = screen.getByLabelText('Chapter title');
    setValue(title, '  The Second Gate  ');
    blur(title);

    await waitFor(() =>
      expect(stub.saveOutline).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'The Second Gate' }),
      ),
    );
  });

  it('never writes a blank title, since the column forbids one', () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    const title = screen.getByLabelText('Chapter title');
    setValue(title, '   ');
    blur(title);

    expect(stub.saveOutline).not.toHaveBeenCalled();
  });

  it('writes a status change immediately, because a dropdown has no blur of its own', async () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    const status = screen.getByLabelText('Status') as HTMLSelectElement;
    setValue(status, 'done');

    await waitFor(() =>
      expect(stub.saveOutline).toHaveBeenCalledWith(
        expect.objectContaining({ id: CHAPTER_ID, status: 'done' }),
      ),
    );
  });

  it('leaves the prose untouched when only the outline changes', async () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture({ bodyMd: 'Original prose.' }), isLoading: false });

    const status = screen.getByLabelText('Status') as HTMLSelectElement;
    setValue(status, 'draft');

    await waitFor(() => expect(stub.saveOutline).toHaveBeenCalled());
    expect(stub.saveProse).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'Original prose.',
    );
  });
});

describe('author notes', () => {
  it('saves both notes together with the body', async () => {
    const stub = installBridge();
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    setValue(screen.getByLabelText('Pre-chapter note'), 'Next update on Thursday.');
    setValue(screen.getByLabelText('Post-chapter note'), 'Discord: https://example.invalid');
    (screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement).click();

    await waitFor(() => expect(stub.saveProse).toHaveBeenCalledTimes(1));
    expect(stub.saveProse).toHaveBeenCalledWith({
      id: CHAPTER_ID,
      bodyMd: '',
      authorNotePre: 'Next update on Thursday.',
      authorNotePost: 'Discord: https://example.invalid',
    });
  });

  it('enables Save for a note typed without touching the prose', async () => {
    renderEditor({ chapter: chapterFixture(), isLoading: false });

    // The button is keyed on the prose alone, so editing only a note would leave the
    // author with a note they cannot save.
    setValue(screen.getByLabelText('Pre-chapter note'), 'A note.');

    const button = screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shows both notes as stored when the chapter is reopened', () => {
    renderEditor({
      chapter: chapterFixture({
        authorNotePre: 'Start at book one.',
        authorNotePost: 'Thanks for reading.',
      }),
      isLoading: false,
    });

    expect((screen.getByLabelText('Pre-chapter note') as HTMLTextAreaElement).value).toBe(
      'Start at book one.',
    );
    expect((screen.getByLabelText('Post-chapter note') as HTMLTextAreaElement).value).toBe(
      'Thanks for reading.',
    );
  });
});

describe('a renamed chapter does not leave the outline showing the old name', () => {
  /**
   * The chapter is created with the placeholder title "Untitled chapter". If the
   * editor saves the title without refreshing the tree, the outline keeps rendering
   * the placeholder forever even though the database holds the real title, and the
   * author has no way to tell a saved rename from a lost one. The save must therefore
   * go through the injected function that the outline hook owns.
   */
  it('refreshes the outline after a title is written', async () => {
    const stub = installBridge();
    let reloadCount = 0;
    const onSaveOutline = async (id: string, patch: Partial<Chapter>) => {
      await stub.saveOutline({ id, ...patch });
      reloadCount += 1;
    };
    render(
      <ChapterEditor
        chapter={chapterFixture({ title: 'Untitled chapter' })}
        isLoading={false}
        onSaveOutline={onSaveOutline}
      />,
    );

    const title = screen.getByLabelText('Chapter title');
    setValue(title, 'The Ash Gate Reborn');
    blur(title);

    await waitFor(() => expect(stub.saveOutline).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reloadCount).toBe(1));
  });

  it('reports a failed title save instead of claiming the rename worked', async () => {
    installBridge();
    const onSaveOutline = async () => {
      throw new Error('Could not save that title.');
    };
    render(
      <ChapterEditor
        chapter={chapterFixture({ title: 'Untitled chapter' })}
        isLoading={false}
        onSaveOutline={onSaveOutline}
      />,
    );

    const title = screen.getByLabelText('Chapter title');
    setValue(title, 'The Ash Gate Reborn');
    blur(title);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/title/i));
  });
});

describe('no chapter selected', () => {
  it('asks for a chapter instead of showing an empty editor', () => {
    renderEditor({ chapter: null, isLoading: false });

    expect(screen.getByText(/pick a chapter/i)).toBeTruthy();
    expect(screen.queryByLabelText('Chapter prose')).toBeNull();
  });

  it('shows a placeholder rather than the editor while the chapter loads', () => {
    renderEditor({ chapter: null, isLoading: true });

    expect(screen.queryByText(/pick a chapter/i)).toBeNull();
    expect(screen.queryByLabelText('Chapter prose')).toBeNull();
  });
});
