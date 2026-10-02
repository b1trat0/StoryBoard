import type { EntityType } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { ENTITY_TYPES } from './use-entities';
import { TYPE_ICONS } from './entity-type';

export interface EntitySidebarProps {
  activeType: EntityType;
  counts: Record<EntityType, number>;
  onSelectType: (type: EntityType) => void;
}

/**
 * Type navigation.
 *
 * Counts sit beside each label because the number is the answer to "did I already
 * add the dragon", which is the question this screen is usually opened to ask.
 * A zero count is dimmed rather than hidden so the tab's existence is constant.
 */
export function EntitySidebar({
  activeType,
  counts,
  onSelectType,
}: EntitySidebarProps) {
  return (
    <nav
      aria-label="Entity types"
      className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-sunken/70"
    >
      <ul className="flex flex-1 flex-col gap-0.5 p-3">
        {ENTITY_TYPES.map((option) => {
          const IconComponent = TYPE_ICONS[option.value];
          const isActive = option.value === activeType;
          const count = counts[option.value];

          return (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => onSelectType(option.value)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150',
                  isActive
                    ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(27_27_25/0.06)]'
                    : 'text-ink-soft hover:bg-surface/70 hover:text-ink',
                )}
              >
                <IconComponent
                  size={16}
                  weight={isActive ? 'fill' : 'regular'}
                  aria-hidden="true"
                  className={isActive ? 'text-accent' : 'text-ink-muted'}
                />
                <span className="flex-1 text-left">{option.plural}</span>
                <span
                  className={cn(
                    'font-mono text-xs tabular-nums',
                    isActive ? 'text-ink-soft' : 'text-ink-muted',
                    count === 0 && 'opacity-50',
                  )}
                >
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        Sections that exist in the database but have no screen yet. Listing them
        greyed out is more honest than omitting them: the outline, glossary and
        export pipeline are all built, and pretending the app is one screen long
        misrepresents where the project actually is.
      */}
      <div className="border-t border-line p-3">
        <p className="px-2.5 pb-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Not built yet
        </p>
        <ul className="space-y-0.5">
          {['Chapters', 'Glossary', 'Relations', 'Illustrations', 'Royal Road export'].map(
            (label) => (
              <li
                key={label}
                className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted/60"
              >
                {label}
              </li>
            ),
          )}
        </ul>
      </div>
    </nav>
  );
}