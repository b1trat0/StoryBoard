// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlossaryScreen } from '../../src/features/glossary/glossary-screen.js';
import type { GlossaryTerm, StoryBoardBridge } from '../../src/lib/bridge.js';

/**
 * The glossary screen.
 *
 * Two behaviours matter: a term is added with the form the author actually uses, and
 * saving a term is an upsert on the canonical form rather than a second spelling of the
 * same invented word.
 */

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function term(overrides: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    projectId: PROJECT_ID,
    canonicalForm: 'Kaelith',
    kind: 'name',
    notes: 'Never written with an accent.',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function installBridge(terms: GlossaryTerm[]): {
  save: ReturnType<typeof vi.fn>;
} {
  const save = vi.fn(async (input: { canonicalForm: string }) => term(input));
  (window as unknown as { storyboard: StoryBoardBridge }).storyboard = {
    glossary: {
      list: vi.fn(async () => terms),
      save,
    },
  } as unknown as StoryBoardBridge;
  return { save };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { storyboard?: StoryBoardBridge }).storyboard;
});

describe('reading the glossary', () => {
  it('groups terms and shows their notes', async () => {
    installBridge([term()]);
    render(<GlossaryScreen projectId={PROJECT_ID} />);

    expect(await screen.findByText('Kaelith')).toBeTruthy();
    expect(
      (screen.getByLabelText('Notes for Kaelith') as HTMLTextAreaElement).value,
    ).toBe('Never written with an accent.');
    expect(screen.getAllByText('Names').length).toBeGreaterThan(0);
  });

  it('explains an empty glossary', async () => {
    installBridge([]);
    render(<GlossaryScreen projectId={PROJECT_ID} />);

    expect(await screen.findByText('Nothing pinned yet')).toBeTruthy();
  });
});

describe('adding a term', () => {
  it('saves the trimmed canonical form, kind and notes', async () => {
    const { save } = installBridge([]);
    render(<GlossaryScreen projectId={PROJECT_ID} />);

    fireEvent.change(await screen.findByLabelText('Canonical form'), {
      target: { value: '  Ash Gate  ' },
    });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'term' } });
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'Capitalised as a place.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add term/i }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        canonicalForm: 'Ash Gate',
        kind: 'term',
        notes: 'Capitalised as a place.',
      }),
    );
  });

  it('will not add an empty term', async () => {
    const { save } = installBridge([]);
    render(<GlossaryScreen projectId={PROJECT_ID} />);

    const button = await screen.findByRole('button', { name: /add term/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);

    expect(save).not.toHaveBeenCalled();
  });
});

describe('editing notes', () => {
  it('saves on blur, keyed on the canonical form', async () => {
    const { save } = installBridge([term()]);
    render(<GlossaryScreen projectId={PROJECT_ID} />);

    const notes = await screen.findByLabelText('Notes for Kaelith');
    fireEvent.change(notes, { target: { value: 'Two syllables, hard K.' } });
    fireEvent.blur(notes);

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        canonicalForm: 'Kaelith',
        kind: 'name',
        notes: 'Two syllables, hard K.',
      }),
    );
  });
});
