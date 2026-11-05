import { Check, Trash, X } from '@phosphor-icons/react';
import { Button } from '../../components/ui/button';
import type { Fact, FactStatus } from '../../lib/bridge';
import {
  FACT_KIND_LABELS,
  FACT_STATUS_CLASSES,
  FACT_STATUS_LABELS,
} from './fact-labels';

export interface FactListProps {
  facts: Fact[];
  emptyMessage: string;
  onSetStatus: (id: string, status: FactStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

/**
 * Facts, with their source.
 *
 * Every row shows the quote it came from, because a fact you cannot check is a fact
 * you will eventually stop believing. Approving is one click; deleting is one click
 * too, because a fact is a note about prose that still exists.
 */
export function FactList({
  facts,
  emptyMessage,
  onSetStatus,
  onRemove,
}: FactListProps) {
  if (facts.length === 0) {
    return <p className="text-[12.5px] italic text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2">
      {facts.map((fact) => (
        <li
          key={fact.id}
          className="rounded-md border border-line bg-surface px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-surface-sunken px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">
              {FACT_KIND_LABELS[fact.kind]}
            </span>
            <span
              className={`rounded px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide ${FACT_STATUS_CLASSES[fact.status]}`}
            >
              {FACT_STATUS_LABELS[fact.status]}
            </span>
          </div>

          <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{fact.content}</p>
          <p className="mt-1 border-l-2 border-line pl-2 font-serif text-[12px] italic leading-relaxed text-ink-muted">
            “{fact.sourceQuote}”
          </p>

          <div className="mt-2 flex items-center gap-1">
            {fact.status !== 'approved' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onSetStatus(fact.id, 'approved')}
                aria-label={`Approve: ${fact.content}`}
              >
                <Check size={13} weight="bold" aria-hidden="true" />
                Approve
              </Button>
            )}
            {fact.status !== 'rejected' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onSetStatus(fact.id, 'rejected')}
                aria-label={`Reject: ${fact.content}`}
              >
                <X size={13} weight="bold" aria-hidden="true" />
                Reject
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-ink-muted"
              onClick={() => void onRemove(fact.id)}
              aria-label={`Delete: ${fact.content}`}
            >
              <Trash size={13} aria-hidden="true" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
