import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { EmptyState, Skeleton } from '../../components/ui/empty-state';
import type { Entity, EntityType } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { TYPE_ICONS, TYPE_PLURALS } from './entity-type';

export interface EntityListProps {
  entities: Entity[];
  type: EntityType;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (entity: Entity) => void;
  onCreate: () => void;
  canCreate: boolean;
}

/**
 * The list of entities of the active type, with search.
 *
 * Search matches the canonical name and every alias, because the author
 * remembers a character by whichever name appeared on the page they are thinking
 * of. Matching aliases is the difference between finding them and concluding
 * they are missing.
 */
export function EntityList({
  entities,
  type,
  isLoading,
  selectedId,
  onSelect,
  onCreate,
  canCreate,
}: EntityListProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return entities;
    }
    return entities.filter(
      (entity) =>
        entity.canonicalName.toLowerCase().includes(needle) ||
        entity.aliases.some((alias) => alias.toLowerCase().includes(needle)),
    );
  }, [entities, query]);

  const plural = TYPE_PLURALS[type];
  const IconComponent = TYPE_ICONS[type];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{plural}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {isLoading
              ? 'Loading...'
              : entities.length === 0
                ? 'None yet'
                : `${entities.length} in this project`}
          </p>
        </div>

        <Button onClick={onCreate} disabled={!canCreate}>
          <Plus size={15} weight="bold" aria-hidden="true" />
          Add {type}
        </Button>
      </header>

      <div className="flex items-center gap-3 px-6 py-3">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or alias"
            aria-label={`Search ${plural.toLowerCase()}`}
            className="pl-9 pr-9"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          // Skeletons shaped like the rows they stand in for, so the list does not
          // jump when the real rows arrive.
          <ul className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="rounded-lg border border-line bg-surface p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-56" />
              </li>
            ))}
          </ul>
        ) : entities.length === 0 ? (
          <EmptyState
            icon={<IconComponent size={28} weight="light" />}
            title={`No ${plural.toLowerCase()} yet`}
            body={`Every ${type} you write down belongs here, with the name the book uses for it.`}
            action={
              canCreate ? (
                <Button onClick={onCreate} size="sm">
                  <Plus size={14} weight="bold" aria-hidden="true" />
                  Add the first one
                </Button>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<MagnifyingGlass size={26} weight="light" />}
            title="Nothing matches that search"
            body={`No ${type} name or alias contains "${query.trim()}".`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => onSelect(entity)}
                  aria-current={entity.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-lg border bg-surface px-4 py-3.5 text-left transition-colors duration-150',
                    entity.id === selectedId
                      ? 'border-accent ring-1 ring-accent/25'
                      : 'border-line hover:border-line-strong hover:bg-surface-sunken/40',
                  )}
                >
                  <p className="font-serif text-[15px] font-medium text-ink">
                    {entity.canonicalName}
                  </p>
                  {entity.aliases.length > 0 ? (
                    <p className="mt-1 text-[13px] italic text-ink-muted">
                      {entity.aliases.join(' · ')}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] italic text-ink-muted/60">
                      No aliases yet
                    </p>
                  )}
                  {entity.summary.length > 0 && (
                    <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
                      {entity.summary}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}