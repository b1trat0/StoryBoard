import { useCallback, useEffect, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { CreateRelationInput, RelationWithKnowledge } from '../../lib/bridge';

/**
 * Relations for one work.
 *
 * Loaded whole rather than per category: a serial's cast produces dozens of relations,
 * not thousands, and the screen groups them by category anyway. Filtering in the query
 * would mean a round trip per tab for a list that already fits in one response.
 */

export interface RelationsState {
  relations: RelationWithKnowledge[];
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  create: (input: CreateRelationInput) => Promise<RelationWithKnowledge>;
  remove: (id: string) => Promise<void>;
}

export function useRelations(projectId: string | null): RelationsState {
  const [relations, setRelations] = useState<RelationWithKnowledge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || projectId === null) {
      setRelations([]);
      setIsLoading(false);
      return;
    }

    try {
      const rows = await bridge.relations.list({ projectId });
      setRelations(rows);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await, so nothing cascades synchronously; the lint
    // rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const create = useCallback<RelationsState['create']>(
    async (input) => {
      const bridge = getBridge();
      if (bridge === null) {
        throw new Error('Not running inside the StoryBoard app');
      }
      const created = await bridge.relations.create(input);
      await reload();
      return created;
    },
    [reload],
  );

  const remove = useCallback(async (id: string) => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    await bridge.relations.remove({ id });
    setRelations((current) => current.filter((relation) => relation.id !== id));
  }, []);

  return { relations, isLoading, errorMessage, reload, create, remove };
}
