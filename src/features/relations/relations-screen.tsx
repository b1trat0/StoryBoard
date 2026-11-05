import { Trash, UsersThree } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import type { Entity, RelationCategory } from '../../lib/bridge';
import { RelationCreateDialog } from './relation-create-dialog';
import {
  RELATION_CATEGORY_HINTS,
  RELATION_CATEGORY_LABELS,
  RELATION_CATEGORY_ORDER,
  describeSentiment,
} from './relation-labels';
import { useRelations } from './use-relations';

export interface RelationsScreenProps {
  projectId: string | null;
  entities: Entity[];
  chapters: { id: string; title: string }[];
}

/**
 * Relations: how the cast stands to each other, and who knows it.
 *
 * Grouped by category because the three categories answer different questions and
 * cannot share columns: a social relation has a sentiment, a possession does not, and
 * rank only exists inside a faction. One flat list with half the fields blank is how a
 * relations screen becomes unreadable.
 */
export function RelationsScreen({
  projectId,
  entities,
  chapters,
}: RelationsScreenProps) {
  const relations = useRelations(projectId);
  const [filter, setFilter] = useState<'all' | RelationCategory>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const relationRows = relations.relations;

  const grouped = useMemo(() => {
    const byCategory = new Map<RelationCategory, typeof relationRows>();
    for (const category of RELATION_CATEGORY_ORDER) {
      byCategory.set(category, []);
    }
    for (const relation of relationRows) {
      if (filter !== 'all' && relation.category !== filter) {
        continue;
      }
      byCategory.get(relation.category)?.push(relation);
    }
    return byCategory;
  }, [relationRows, filter]);

  const visibleCount =
    filter === 'all'
      ? relations.relations.length
      : (grouped.get(filter)?.length ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-3">
        <h1 className="mr-auto font-serif text-[15px] font-semibold text-ink">
          Relations
        </h1>
        <div className="flex items-center gap-0.5" role="group" aria-label="Category filter">
          {(['all', ...RELATION_CATEGORY_ORDER] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={
                filter === value
                  ? 'rounded-md bg-accent-soft px-2.5 py-1 text-[12.5px] font-medium text-accent'
                  : 'rounded-md px-2.5 py-1 text-[12.5px] text-ink-muted hover:bg-surface-sunken hover:text-ink-soft'
              }
            >
              {value === 'all' ? 'All' : RELATION_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          onClick={() => setIsCreateOpen(true)}
          disabled={projectId === null || entities.length < 2}
        >
          New relation
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {relations.errorMessage !== null && (
            <div
              role="alert"
              className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            >
              {relations.errorMessage}
            </div>
          )}

          {relations.isLoading ? (
            <p className="text-[13px] text-ink-muted">Loading relations…</p>
          ) : visibleCount === 0 ? (
            <EmptyState
              title="No relations yet"
              body={
                entities.length < 2
                  ? 'Add at least two entities in the Storybook first, then describe how they stand to each other.'
                  : 'Describe who knows whom, who holds what, and who belongs where. Every relation can be marked secret and track who has learned it.'
              }
            />
          ) : (
            RELATION_CATEGORY_ORDER.map((category) => {
              const rows = grouped.get(category) ?? [];
              if (rows.length === 0) {
                return null;
              }
              return (
                <section key={category} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                      {RELATION_CATEGORY_LABELS[category]}
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                      {rows.length}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-muted">
                    {RELATION_CATEGORY_HINTS[category]}
                  </p>

                  <ul className="space-y-2">
                    {rows.map((relation) => (
                      <li
                        key={relation.id}
                        className="rounded-md border border-line bg-surface px-3.5 py-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="font-serif text-[14px] text-ink">
                            {relation.fromName}
                          </span>
                          <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                            →
                          </span>
                          <span className="font-serif text-[14px] text-ink">
                            {relation.toName}
                          </span>
                          <span className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-[11.5px] text-ink-soft">
                            {relation.typeLabel}
                          </span>
                          {relation.isSecret && (
                            <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-danger">
                              Secret
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto text-ink-muted"
                            onClick={() => {
                              void relations
                                .remove(relation.id)
                                .catch((err: unknown) => {
                                  toast.error('Could not delete the relation', {
                                    description:
                                      err instanceof Error ? err.message : undefined,
                                  });
                                });
                            }}
                            aria-label={`Delete relation ${relation.fromName} to ${relation.toName}`}
                          >
                            <Trash size={13} aria-hidden="true" />
                          </Button>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-soft">
                          {relation.category === 'social' && (
                            <span>{describeSentiment(relation.sentiment)}</span>
                          )}
                          {relation.rank !== null && <span>Rank: {relation.rank}</span>}
                          <span>
                            {relation.knownBy.length === 0
                              ? 'Known by nobody recorded'
                              : `Known by ${relation.knownBy
                                  .map((entity) => entity.canonicalName)
                                  .join(', ')}`}
                          </span>
                        </div>

                        {relation.notes.trim().length > 0 && (
                          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
                            {relation.notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          {entities.length > 0 && entities.length < 2 && (
            <p className="flex items-start gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-[12.5px] text-ink-soft">
              <UsersThree size={15} aria-hidden="true" className="mt-px shrink-0" />
              A relation needs two different entities. Add another character, place or
              faction in the Storybook to start linking them.
            </p>
          )}
        </div>
      </div>

      {isCreateOpen && projectId !== null && (
        <RelationCreateDialog
          isOpen
          projectId={projectId}
          entities={entities}
          chapters={chapters}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (input) => {
            await relations.create(input);
            toast.success('Relation added');
          }}
        />
      )}
    </div>
  );
}
