import { toast } from 'sonner';
import type { FactScopeType } from '../../lib/bridge';
import { FactComposer } from './fact-composer';
import { FactList } from './fact-list';
import { useFacts } from './use-facts';

export interface FactsPanelProps {
  projectId: string | null;
  scopeType: FactScopeType;
  scopeId: string | null;
  /** Chapters available as a source for a fact recorded here. */
  chapters: { id: string; title: string }[];
  /** Fixed when the panel already sits inside that chapter. */
  fixedChapterId?: string;
  emptyMessage: string;
  /** Optional note shown under the heading. */
  hint?: string;
}

/**
 * One lens over the facts table.
 *
 * The same component renders a chapter's facts, an entity's facts and later a
 * relation's, because the tabs are views of one store rather than separate stores.
 * Separate components would eventually disagree about status or ordering, and the
 * whole point of a single facts table is that they cannot.
 */
export function FactsPanel({
  projectId,
  scopeType,
  scopeId,
  chapters = [],
  fixedChapterId,
  emptyMessage,
  hint,
}: FactsPanelProps) {
  const { facts, isLoading, errorMessage, create, setStatus, remove } = useFacts({
    projectId,
    scopeType,
    scopeId,
  });

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Facts
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">
          {facts.length}
        </span>
      </div>
      {hint !== undefined && (
        <p className="text-[12px] leading-relaxed text-ink-muted">{hint}</p>
      )}

      {errorMessage !== null && (
        <p role="alert" className="text-[12px] text-danger">
          {errorMessage}
        </p>
      )}

      {isLoading ? (
        <p className="text-[12.5px] text-ink-muted">Loading facts…</p>
      ) : (
        <FactList
          facts={facts}
          emptyMessage={emptyMessage}
          onSetStatus={async (id, status) => {
            try {
              await setStatus(id, status);
            } catch (err) {
              toast.error('Could not change the fact', {
                description: err instanceof Error ? err.message : undefined,
              });
            }
          }}
          onRemove={async (id) => {
            try {
              await remove(id);
            } catch (err) {
              toast.error('Could not delete the fact', {
                description: err instanceof Error ? err.message : undefined,
              });
            }
          }}
        />
      )}

      <FactComposer
        chapters={chapters}
        fixedChapterId={fixedChapterId}
        onSubmit={async (input) => {
          await create(input);
        }}
      />
    </section>
  );
}
