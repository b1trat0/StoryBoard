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
    wordCount: 0,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface BridgeStub {
  saveBody: ReturnType<typeof vi.fn>;
  saveOutline: ReturnType<typeof vi.fn>;
}

/** Installs a minimal window.storyboard. getBridge reads it off the window object. */
function installBridge(): BridgeStub {
  const saveBody = vi.fn(async (input: { id: string; bodyMd: string }) =>
    chapterFixture({ bodyMd: input.bodyMd, wordCount: input.bodyMd.split(/\s+/).filter(Boolean).length }),
  );
  const saveOutline = vi.fn(async (input: { id: string }) => chapterFixture({ ...input, id: CHAPTER_ID }));
  (window as { storyboard?: unknown }).storyboard = {
    chapters: { saveBody, saveOutline },
  };
  return { saveBody, saveOutline };
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
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    setValue(screen.getByLabelText('Chapter prose'), 'The first sentence of a chapter.');

    expect(stub.saveBody).not.toHaveBeenCalled();
  });

  it('writes the prose only when Save is pressed', async () => {
    const stub = installBridge();
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    setValue(screen.getByLabelText('Chapter prose'), 'The first sentence.');
    (screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement).click();

    await waitFor(() => expect(stub.saveBody).toHaveBeenCalledTimes(1));
    expect(stub.saveBody).toHaveBeenCalledWith({
      id: CHAPTER_ID,
      bodyMd: 'The first sentence.',
    });
  });

  it('marks the prose unsaved while it differs from what is stored', () => {
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    expect(screen.getByText('Everything saved')).toBeTruthy();

    setValue(screen.getByLabelText('Chapter prose'), 'Something new.');

    // Named exactly, because the word-count line carries its own lowercase
    // "unsaved" marker and a loose matcher would find two elements.
    expect(screen.getByText('Unsaved prose')).toBeTruthy();
  });

  it('leaves Save disabled when there is nothing to save', () => {
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    const button = screen.getByRole('button', { name: /save prose/i }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it('shows a word count that matches what the main process will store', () => {
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    setValue(screen.getByLabelText('Chapter prose'), 'one two three four five');

    expect(screen.getByText('5 words')).toBeTruthy();
  });

  it('keeps unsaved prose on screen when the save fails, so nothing is lost', async () => {
    const stub = installBridge();
    stub.saveBody.mockRejectedValueOnce(new Error('the database is away'));
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

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
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

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
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    setValue(screen.getByLabelText('Goal'), 'K');
    setValue(screen.getByLabelText('Goal'), 'Ka');
    setValue(screen.getByLabelText('Goal'), 'Kael');

    expect(stub.saveOutline).not.toHaveBeenCalled();
  });

  it('does not rewrite an outline field the author typed nothing into', () => {
    const stub = installBridge();
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    const goal = screen.getByLabelText('Goal');
    blur(goal);

    expect(stub.saveOutline).not.toHaveBeenCalled();
  });

  it('writes the title on blur, trimmed', async () => {
    const stub = installBridge();
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

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
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

    const title = screen.getByLabelText('Chapter title');
    setValue(title, '   ');
    blur(title);

    expect(stub.saveOutline).not.toHaveBeenCalled();
  });

  it('writes a status change immediately, because a dropdown has no blur of its own', async () => {
    const stub = installBridge();
    render(<ChapterEditor chapter={chapterFixture()} isLoading={false} />);

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
    render(<ChapterEditor chapter={chapterFixture({ bodyMd: 'Original prose.' })} isLoading={false} />);

    const status = screen.getByLabelText('Status') as HTMLSelectElement;
    setValue(status, 'draft');

    await waitFor(() => expect(stub.saveOutline).toHaveBeenCalled());
    expect(stub.saveBody).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'Original prose.',
    );
  });
});

describe('no chapter selected', () => {
  it('asks for a chapter instead of showing an empty editor', () => {
    render(<ChapterEditor chapter={null} isLoading={false} />);

    expect(screen.getByText(/pick a chapter/i)).toBeTruthy();
    expect(screen.queryByLabelText('Chapter prose')).toBeNull();
  });

  it('shows a placeholder rather than the editor while the chapter loads', () => {
    render(<ChapterEditor chapter={null} isLoading={true} />);

    expect(screen.queryByText(/pick a chapter/i)).toBeNull();
    expect(screen.queryByLabelText('Chapter prose')).toBeNull();
  });
});
