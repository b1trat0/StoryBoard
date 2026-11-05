// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterEditor } from '../../src/features/chapters/chapter-editor.js';
import { useChapterDraft } from '../../src/features/chapters/use-chapter-draft.js';
import type { Chapter } from '../../src/lib/bridge.js';

/**
 * The chapter buffer.
 *
 * This file exists because of a bug the author would have hit constantly: unsaved
 * prose was destroyed by navigating away. The editor was unmounted whenever another
 * section was showing, and it owned the buffer itself, so the prose went with it —
 * silently, while the word counter still claimed it was unsaved.
 *
 * The rule under test is that the buffer's lifetime is the shell's, not the editor's.
 * Moving between sections must be a redraw. Switching chapters is different: that one
 * genuinely replaces the buffer, and the shell asks first, so it is covered in
 * `chapter-switch-guard.test.tsx`.
 */

const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_CHAPTER_ID = '40000000-0000-4000-8000-000000000002';

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: '30000000-0000-4000-8000-000000000001',
    title: 'The Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: 'The gate was already open.',
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 5,
    publishedAt: null,
    rrUrl: null,
    ...overrides,
  };
}

function installBridge() {
  const saveProse = vi.fn(
    async (input: { id: string; bodyMd: string; authorNotePre: string; authorNotePost: string }) =>
      chapterFixture({
        id: input.id,
        bodyMd: input.bodyMd,
        authorNotePre: input.authorNotePre,
        authorNotePost: input.authorNotePost,
      }),
  );
  (window as { storyboard?: unknown }).storyboard = {
    chapters: { saveProse },
    facts: { list: vi.fn(async () => []) },
    illustrations: { listByChapter: vi.fn(async () => []) },
  };
  return { saveProse };
}

function setValue(element: HTMLElement, value: string) {
  const input = element as HTMLInputElement | HTMLTextAreaElement;
  // React tracks the previous value on the DOM node; without this it treats the
  // change as a no-op and never fires onChange.
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Stands in for the shell: the hook is called above the section switch, and the editor
 * below it can be unmounted and remounted without the hook ever being torn down.
 *
 * That is the whole shape of the bug. Reproducing it needs the hook above the
 * conditional and the editor below it, which is why this is a component test and not a
 * direct `renderHook` call.
 */
function Shell({ chapter }: { chapter: Chapter | null }) {
  const draft = useChapterDraft(chapter, async () => {});
  const [isEditorMounted, setIsEditorMounted] = useState(true);

  return (
    <>
      <button type="button" onClick={() => setIsEditorMounted((current) => !current)}>
        switch section
      </button>
      {isEditorMounted && (
        <ChapterEditor
          draft={draft.draft}
          isLoading={false}
          isDirty={draft.isProseDirty}
          savedTitle={draft.savedTitle}
          isSavingProse={draft.isSavingProse}
          errorMessage={draft.errorMessage}
          updateDraft={draft.updateDraft}
          saveOutlineField={draft.saveOutlineField}
          commitProse={draft.commitProse}
          recoveredDraft={null}
          onRestoreDraft={async () => undefined}
          onDiscardDraft={async () => undefined}
          projectId="00000000-0000-4000-8000-000000000001"
          chapters={[]}
          povOptions={[]}
          onMoveChapter={async () => undefined}
        />
      )}
    </>
  );
}

beforeEach(() => {
  installBridge();
});

afterEach(() => {
  cleanup();
  delete (window as { storyboard?: unknown }).storyboard;
  vi.restoreAllMocks();
});

describe('the buffer outlives the editor', () => {
  it('still holds the prose after the editor unmounts and comes back', () => {
    render(<Shell chapter={chapterFixture()} />);

    setValue(screen.getByLabelText('Chapter prose'), 'A sentence typed but not saved.');
    expect(screen.getByText('Unsaved prose')).toBeTruthy();

    // Leave the section and come back. The editor is destroyed and rebuilt; the
    // buffer is not.
    fireEvent.click(screen.getByRole('button', { name: /switch section/i }));
    expect(screen.queryByLabelText('Chapter prose')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /switch section/i }));

    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'A sentence typed but not saved.',
    );
    expect(screen.getByText('Unsaved prose')).toBeTruthy();
  });

  it('keeps a typed author note across the same trip', () => {
    render(<Shell chapter={chapterFixture()} />);

    setValue(screen.getByLabelText('Pre-chapter note'), 'Start at book one.');

    fireEvent.click(screen.getByRole('button', { name: /switch section/i }));
    fireEvent.click(screen.getByRole('button', { name: /switch section/i }));

    expect((screen.getByLabelText('Pre-chapter note') as HTMLTextAreaElement).value).toBe(
      'Start at book one.',
    );
  });
});

describe('unsaved is honest', () => {
  it('starts clean for a chapter straight from the database', () => {
    render(<Shell chapter={chapterFixture()} />);

    expect(screen.getByText('Everything saved')).toBeTruthy();
  });

  it('clears unsaved once the prose has been written', async () => {
    const { saveProse } = installBridge();
    render(<Shell chapter={chapterFixture()} />);

    setValue(screen.getByLabelText('Chapter prose'), 'A sentence typed but not saved.');
    fireEvent.click(screen.getByRole('button', { name: /save prose/i }));

    await waitFor(() => expect(saveProse).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Everything saved')).toBeTruthy());
  });

  it('still says unsaved when the write fails', async () => {
    (window as { storyboard?: unknown }).storyboard = {
      chapters: {
        saveProse: vi.fn(async () => {
          throw new Error('The database is not reachable.');
        }),
      },
      facts: { list: vi.fn(async () => []) },
      illustrations: { listByChapter: vi.fn(async () => []) },
    };
    render(<Shell chapter={chapterFixture()} />);

    setValue(screen.getByLabelText('Chapter prose'), 'A sentence typed but not saved.');
    fireEvent.click(screen.getByRole('button', { name: /save prose/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not reachable/i));
    expect(screen.getByText('Unsaved prose')).toBeTruthy();
  });
});

describe('adopting a chapter', () => {
  it('shows a different chapter when the id changes', () => {
    const { rerender } = render(<Shell chapter={chapterFixture()} />);

    rerender(
      <Shell
        chapter={chapterFixture({
          id: OTHER_CHAPTER_ID,
          title: 'The Ash Gate',
          bodyMd: 'A different chapter entirely.',
        })}
      />,
    );

    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'A different chapter entirely.',
    );
    expect(screen.getByText('Everything saved')).toBeTruthy();
  });

  it('does not let a refetch of the open chapter overwrite the draft', () => {
    const { rerender } = render(<Shell chapter={chapterFixture()} />);

    setValue(screen.getByLabelText('Chapter prose'), 'Half a sentence I have not finished');

    // Same id, fresh object: what a background reload looks like. Resetting on object
    // identity rather than on id would wipe the draft here.
    rerender(<Shell chapter={chapterFixture({ bodyMd: 'Stale database copy.' })} />);

    expect((screen.getByLabelText('Chapter prose') as HTMLTextAreaElement).value).toBe(
      'Half a sentence I have not finished',
    );
    expect(screen.getByText('Unsaved prose')).toBeTruthy();
  });

  it('forgets the buffer when the open chapter is deleted', () => {
    const { rerender } = render(<Shell chapter={chapterFixture()} />);

    setValue(screen.getByLabelText('Chapter prose'), 'Doomed prose.');
    rerender(<Shell chapter={null} />);

    expect(screen.queryByLabelText('Chapter prose')).toBeNull();
  });
});