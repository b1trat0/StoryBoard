import { useCallback, useEffect, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { GlossaryKind, GlossaryTerm } from '../../lib/bridge';

/**
 * The glossary: the project's invented vocabulary.
 *
 * It exists because the author is not a native English speaker and the book is full of
 * names a spell-checker wants to "fix". Later it becomes the never-touch list handed
 * to the English checker, which is why the canonical form is separate from the notes.
 */

export interface GlossaryState {
  terms: GlossaryTerm[];
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  save: (input: {
    canonicalForm: string;
    kind: GlossaryKind;
    notes: string;
  }) => Promise<GlossaryTerm>;
}

export function useGlossary(projectId: string | null): GlossaryState {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || projectId === null) {
      setTerms([]);
      setIsLoading(false);
      return;
    }

    try {
      setTerms(await bridge.glossary.list({ projectId }));
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await; the lint rule cannot see the boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const save = useCallback<GlossaryState['save']>(
    async (input) => {
      const bridge = getBridge();
      if (bridge === null || projectId === null) {
        throw new Error('Open a work before adding a glossary term.');
      }
      const saved = await bridge.glossary.save({ projectId, ...input });
      await reload();
      return saved;
    },
    [projectId, reload],
  );

  return { terms, isLoading, errorMessage, reload, save };
}
