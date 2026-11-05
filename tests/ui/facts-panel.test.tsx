// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FactsPanel } from '../../src/features/facts/facts-panel.js';
import type { Fact, StoryBoardBridge } from '../../src/lib/bridge.js';

/**
 * The facts panel.
 *
 * Two guarantees are tested here because both are what make the panel trustworthy:
 * every fact shows the line it came from, and a fact cannot be added without one.
 * The database enforces the second too; the form has to explain it before the write.
 */

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    projectId: PROJECT_ID,
    scopeType: 'chapter',
    scopeId: CHAPTER_ID,
    kind: 'event',
    content: 'Kael burns the writ.',
    sourceChapterId: CHAPTER_ID,
    sourceQuote: 'The writ curled and went to ash in his hand.',
    status: 'draft',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function installBridge(facts: Fact[]): {
  create: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => fact());
  const setStatus = vi.fn(async () => fact({ status: 'approved' }));
  const remove = vi.fn(async () => undefined);

  (window as unknown as { storyboard: StoryBoardBridge }).storyboard = {
    facts: {
      list: vi.fn(async () => facts),
      create,
      setStatus,
      remove,
    },
  } as unknown as StoryBoardBridge;

  return { create, setStatus, remove };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { storyboard?: StoryBoardBridge }).storyboard;
});

const panel = (
  <FactsPanel
    projectId={PROJECT_ID}
    scopeType="chapter"
    scopeId={CHAPTER_ID}
    chapters={[{ id: CHAPTER_ID, title: 'The Seal' }]}
    fixedChapterId={CHAPTER_ID}
    emptyMessage="Nothing recorded for this chapter yet."
  />
);

describe('reading facts', () => {
  it('shows the fact and the quote it came from', async () => {
    installBridge([fact()]);
    render(panel);

    expect(await screen.findByText('Kael burns the writ.')).toBeTruthy();
    expect(
      screen.getByText('“The writ curled and went to ash in his hand.”'),
    ).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('says what is missing without pretending the list failed', async () => {
    installBridge([]);
    render(panel);

    expect(
      await screen.findByText('Nothing recorded for this chapter yet.'),
    ).toBeTruthy();
  });
});

describe('changing a fact', () => {
  it('approves a draft', async () => {
    const { setStatus } = installBridge([fact()]);
    render(panel);

    fireEvent.click(await screen.findByRole('button', { name: /approve: kael burns/i }));

    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({
        id: '55555555-5555-4555-8555-555555555555',
        status: 'approved',
      }),
    );
  });
});

describe('adding a fact', () => {
  it('will not submit without a source quote', async () => {
    const { create } = installBridge([]);
    render(panel);

    fireEvent.change(await screen.findByLabelText('What happened'), {
      target: { value: 'Kael burns the writ.' },
    });

    const addButton = screen.getByRole('button', { name: /add fact/i });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(addButton);

    expect(create).not.toHaveBeenCalled();
  });

  it('records the fact against the chapter it was written in', async () => {
    const { create } = installBridge([]);
    render(panel);

    fireEvent.change(await screen.findByLabelText('What happened'), {
      target: { value: 'Kael burns the writ.' },
    });
    fireEvent.change(screen.getByLabelText(/source quote/i), {
      target: { value: 'The writ curled and went to ash in his hand.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add fact/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        scopeType: 'chapter',
        scopeId: CHAPTER_ID,
        kind: 'event',
        content: 'Kael burns the writ.',
        sourceChapterId: CHAPTER_ID,
        sourceQuote: 'The writ curled and went to ash in his hand.',
        status: 'draft',
      }),
    );
  });
});
