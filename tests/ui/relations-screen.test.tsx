// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationsScreen } from '../../src/features/relations/relations-screen.js';
import type {
  Entity,
  RelationWithKnowledge,
  StoryBoardBridge,
} from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * The relations screen.
 *
 * The three categories do not share columns, so the screen has to show sentiment only
 * where it exists, rank only for membership, and the knowledge list everywhere. Those
 * are the assertions, not "it renders".
 */

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const KAEL = '11111111-1111-4111-8111-111111111111';
const MIRA = '22222222-2222-4222-8222-222222222222';

function entity(id: string, name: string): Entity {
  return {
    id,
    projectId: PROJECT_ID,
    type: 'character',
    canonicalName: name,
    aliases: [],
    summary: '',
    appearance: '',
    personality: '',
    backstory: '',
    originEntityId: null,
    metadata: {},
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function relation(overrides: Partial<RelationWithKnowledge> = {}): RelationWithKnowledge {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: PROJECT_ID,
    fromEntityId: KAEL,
    toEntityId: MIRA,
    fromName: 'Kael',
    toName: 'Mira',
    category: 'social',
    typeLabel: 'Sister',
    sentiment: 4,
    rank: null,
    validFromChapterId: null,
    validToChapterId: null,
    isSecret: false,
    notes: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    knownBy: [{ id: MIRA, canonicalName: 'Mira' }],
    ...overrides,
  };
}

function installBridge(relations: RelationWithKnowledge[]): {
  remove: ReturnType<typeof vi.fn>;
} {
  const remove = vi.fn(async () => undefined);
  (window as unknown as { storyboard: StoryBoardBridge }).storyboard = {
    relations: {
      list: vi.fn(async () => relations),
      create: vi.fn(),
      remove,
    },
  } as unknown as StoryBoardBridge;
  return { remove };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { storyboard?: StoryBoardBridge }).storyboard;
});

describe('showing relations', () => {
  it('names both ends, the label, the sentiment and who knows', async () => {
    installBridge([relation()]);
    render(
      <RelationsScreen
        projectId={PROJECT_ID}
        entities={[entity(KAEL, 'Kael'), entity(MIRA, 'Mira')]}
        chapters={[]}
      />,
    );

    expect(await screen.findByText('Kael')).toBeTruthy();
    expect(screen.getByText('Mira')).toBeTruthy();
    expect(screen.getByText('Sister')).toBeTruthy();
    expect(screen.getByText('+4 devoted')).toBeTruthy();
    expect(screen.getByText(/Known by Mira/)).toBeTruthy();
  });

  it('shows rank for membership and no sentiment', async () => {
    installBridge([
      relation({
        id: '44444444-4444-4444-8444-444444444444',
        category: 'membership',
        typeLabel: 'Sworn to',
        sentiment: null,
        rank: 'Captain',
      }),
    ]);
    render(
      <RelationsScreen
        projectId={PROJECT_ID}
        entities={[entity(KAEL, 'Kael'), entity(MIRA, 'Mira')]}
        chapters={[]}
      />,
    );

    expect(await screen.findByText('Rank: Captain')).toBeTruthy();
    expect(screen.queryByText(/devoted/)).toBeNull();
  });

  it('marks a secret relation', async () => {
    installBridge([relation({ isSecret: true })]);
    render(
      <RelationsScreen
        projectId={PROJECT_ID}
        entities={[entity(KAEL, 'Kael'), entity(MIRA, 'Mira')]}
        chapters={[]}
      />,
    );

    expect(await screen.findByText('Secret')).toBeTruthy();
  });

  it('deletes the relation the author chose', async () => {
    const { remove } = installBridge([relation()]);
    render(
      <RelationsScreen
        projectId={PROJECT_ID}
        entities={[entity(KAEL, 'Kael'), entity(MIRA, 'Mira')]}
        chapters={[]}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: /delete relation kael to mira/i,
      }),
    );

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({
        id: '33333333-3333-4333-8333-333333333333',
      }),
    );
  });

  it('explains the empty state when there is nothing to relate yet', async () => {
    installBridge([]);
    render(
      <RelationsScreen projectId={PROJECT_ID} entities={[]} chapters={[]} />,
    );

    expect(await screen.findByText('No relations yet')).toBeTruthy();
    expect(screen.getByText(/at least two entities/i)).toBeTruthy();
  });
});
