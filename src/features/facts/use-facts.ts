import { useCallback, useEffect, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type {
  Fact,
  FactKind,
  FactScopeType,
  FactStatus,
} from '../../lib/bridge';

/**
 * Facts for one scope: a chapter, an entity, or a relation.
 *
 * One table, several lenses. The filter is part of the hook rather than of the
 * component so a panel cannot accidentally show another scope's facts, which is how
 * two "views" of the same data start disagreeing.
 */

export interface FactsFilter {
  projectId: string | null;
  scopeType: FactScopeType;
  scopeId: string | null;
}

export interface FactsState {
  facts: Fact[];
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  create: (input: {
    kind: FactKind;
    content: string;
    sourceChapterId: string;
    sourceQuote: string;
  }) => Promise<Fact>;
  setStatus: (id: string, status: FactStatus) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * @param filter - Which scope's facts to load. All fields are required so a panel
 *   cannot render unscoped rows.
 */
export function useFacts(filter: FactsFilter): FactsState {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { projectId, scopeType, scopeId } = filter;

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || projectId === null || scopeId === null) {
      setFacts([]);
      setIsLoading(false);
      return;
    }

    try {
      const rows = await bridge.facts.list({ projectId, scopeType, scopeId });
      setFacts(rows);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, scopeType, scopeId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await, so nothing cascades synchronously; the lint
    // rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const create = useCallback<FactsState['create']>(
    async (input) => {
      const bridge = getBridge();
      if (bridge === null || projectId === null || scopeId === null) {
        throw new Error('Open a work before recording a fact.');
      }
      const created = await bridge.facts.create({
        projectId,
        scopeType,
        scopeId,
        kind: input.kind,
        content: input.content,
        sourceChapterId: input.sourceChapterId,
        sourceQuote: input.sourceQuote,
        status: 'draft',
      });
      await reload();
      return created;
    },
    [projectId, scopeType, scopeId, reload],
  );

  const setStatus = useCallback(async (id: string, status: FactStatus) => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    const updated = await bridge.facts.setStatus({ id, status });
    setFacts((current) =>
      current.map((fact) => (fact.id === id ? updated : fact)),
    );
  }, []);

  const remove = useCallback(async (id: string) => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    await bridge.facts.remove({ id });
    setFacts((current) => current.filter((fact) => fact.id !== id));
  }, []);

  return { facts, isLoading, errorMessage, reload, create, setStatus, remove };
}
