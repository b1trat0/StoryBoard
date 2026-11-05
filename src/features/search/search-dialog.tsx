import { MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { getBridge } from '../../lib/bridge';
import type { SearchResult } from '../../lib/bridge';

export interface SearchDialogProps {
  isOpen: boolean;
  projectId: string | null;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  entity: 'Entity',
  glossary: 'Glossary',
  fact: 'Fact',
};

/**
 * Recall, one keystroke away.
 *
 * The question this answers is "where was that thing?" — a name, an invented word, or
 * something that happened. It searches one work at a time, because a result from
 * another manuscript is never the answer.
 *
 * Querying is debounced and cancellable-by-staleness: the last query to resolve wins,
 * so typing quickly cannot show results for a prefix the author has moved past.
 */
export function SearchDialog({
  isOpen,
  projectId,
  onClose,
  onSelect,
}: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (projectId === null || query.trim().length < 2) {
      // Nothing to ask. Setting state after the early return would be a synchronous
      // write in an effect, so the empty list is cleared below on the next tick.
      const timer = setTimeout(() => {
        setResults([]);
        setErrorMessage(null);
      }, 0);
      return () => clearTimeout(timer);
    }

    let isCurrent = true;
    const timer = setTimeout(() => {
      const bridge = getBridge();
      if (bridge === null) {
        return;
      }
      void bridge.search
        .query({ projectId, query: query.trim() })
        .then((rows) => {
          if (isCurrent) {
            setResults(rows);
            setErrorMessage(null);
          }
        })
        .catch((err: unknown) => {
          if (isCurrent) {
            setErrorMessage(
              err instanceof Error ? err.message : 'The search failed.',
            );
          }
        });
    }, 150);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [isOpen, projectId, query]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        setQuery('');
        setResults([]);
        onClose();
      }}
      title="Search this work"
      description="Names, aliases, glossary terms, and what happened."
      className="w-[min(620px,calc(100vw-48px))]"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5">
          <MagnifyingGlass size={15} aria-hidden="true" className="text-ink-muted" />
          <Input
            aria-label="Search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0] !== undefined) {
                onSelect(results[0]);
              }
            }}
            placeholder="Kael, ash gate, the writ…"
            className="h-9 border-0 px-0 focus-visible:outline-none"
          />
        </div>

        {errorMessage !== null && (
          <p role="alert" className="text-[12.5px] text-danger">
            {errorMessage}
          </p>
        )}

        {query.trim().length < 2 ? (
          <p className="text-[12.5px] italic text-ink-muted">
            Type at least two characters.
          </p>
        ) : results.length === 0 ? (
          <p className="text-[12.5px] italic text-ink-muted">Nothing matches yet.</p>
        ) : (
          <ul className="max-h-[45vh] space-y-1 overflow-y-auto" role="listbox">
            {results.map((result) => (
              <li key={`${result.kind}:${result.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onSelect(result)}
                  className="w-full rounded-md px-2.5 py-2 text-left hover:bg-surface-sunken"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {result.title}
                    </span>
                    <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                      {KIND_LABELS[result.kind]}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                    {result.detail}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
