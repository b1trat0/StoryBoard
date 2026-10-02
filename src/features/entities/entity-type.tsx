import { UserCircle, MapPin, Shield, Sword, Scroll } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { EntityType } from '../../lib/bridge';
import { ENTITY_TYPES } from './use-entities';
import { cn } from '../../lib/utils';

/**
 * Icons for each entity type.
 *
 * Defined once here rather than imported per screen, so a type can never end up
 * drawn as a different symbol in two places.
 */
export const TYPE_ICONS: Record<EntityType, Icon> = {
  character: UserCircle,
  place: MapPin,
  faction: Shield,
  item: Sword,
  rule: Scroll,
};

/** Short label shown as a chip beside a name. */
export const TYPE_LABELS: Record<EntityType, string> = {
  character: 'Character',
  place: 'Place',
  faction: 'Faction',
  item: 'Item',
  rule: 'Rule',
};

/** Human plural for a type, used in headings and empty states. */
export const TYPE_PLURALS: Record<EntityType, string> = Object.fromEntries(
  ENTITY_TYPES.map((option) => [option.value, option.plural]),
) as Record<EntityType, string>;

/** Small uppercase label for an entity's type. */
export function TypeBadge({ type, className }: { type: EntityType; className?: string }) {
  const IconComponent = TYPE_ICONS[type];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft',
        className,
      )}
    >
      <IconComponent size={12} weight="bold" aria-hidden="true" />
      {TYPE_LABELS[type]}
    </span>
  );
}