// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchDialog } from '../../src/features/search/search-dialog.js';
import type { SearchResult, StoryBoardBridge } from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * Recall.
 *
 * The behaviour worth testing is that a result carries enough to jump to the right
 * place: an entity to its tab, a fact to its chapter, a glossary term to the glossary.
 */

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

const RESULTS: SearchResult[] = [
  {
    kind: 'entity',
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Kaelith',
    detail: 'character · also Kael',
    chapterId: null,
    entityType: 'character',
  },
  {
    kind: 'fact',
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Kael burns the writ.',
    detail: 'The writ curled and went to ash in his hand.',
    chapterId: '40000000-0000-4000-8000-000000000001',
    entityType: null,
  },
];

function installBridge(): { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => RESULTS);
  (window as unknown as { storyboard: StoryBoardBridge }).storyboard = {
    search: { query },
  } as unknown as StoryBoardBridge;
  return { query };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { storyboard?: StoryBoardBridge }).storyboard;
});

describe('searching', () => {
  it('does not query until there are two characters', async () => {
    const { query } = installBridge();
    render(
      <SearchDialog isOpen projectId={PROJECT_ID} onClose={() => {}} onSelect={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'K' } });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(query).not.toHaveBeenCalled();
    expect(screen.getByText(/at least two characters/i)).toBeTruthy();
  });

  it('shows matches with their kind', async () => {
    const { query } = installBridge();
    render(
      <SearchDialog isOpen projectId={PROJECT_ID} onClose={() => {}} onSelect={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Kael' } });

    expect(await screen.findByText('Kaelith')).toBeTruthy();
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith({ projectId: PROJECT_ID, query: 'Kael' }),
    );
    expect(screen.getByText('Entity')).toBeTruthy();
    expect(screen.getByText('Fact')).toBeTruthy();
  });

  it('says plainly when nothing matches', async () => {
    installBridge();
    (window as unknown as { storyboard: StoryBoardBridge }).storyboard = {
      search: { query: vi.fn(async () => []) },
    } as unknown as StoryBoardBridge;

    render(
      <SearchDialog isOpen projectId={PROJECT_ID} onClose={() => {}} onSelect={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });

    expect(await screen.findByText('Nothing matches yet.')).toBeTruthy();
  });

  it('hands the whole result back, so the caller can navigate', async () => {
    installBridge();
    const onSelect = vi.fn();
    render(
      <SearchDialog
        isOpen
        projectId={PROJECT_ID}
        onClose={() => {}}
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Kael' } });
    fireEvent.click(await screen.findByText('Kael burns the writ.'));

    expect(onSelect).toHaveBeenCalledWith(RESULTS[1]);
  });

  it('selects the first result on Enter', async () => {
    installBridge();
    const onSelect = vi.fn();
    render(
      <SearchDialog
        isOpen
        projectId={PROJECT_ID}
        onClose={() => {}}
        onSelect={onSelect}
      />,
    );

    const input = screen.getByLabelText('Search');
    fireEvent.change(input, { target: { value: 'Kael' } });
    await screen.findByText('Kaelith');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(RESULTS[0]);
  });
});
