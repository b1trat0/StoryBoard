import type { CreateRelationInput, Entity, RelationCategory } from '../../lib/bridge';

/** Labels and display rules for the three relation categories. */
export const RELATION_CATEGORY_LABELS: Record<RelationCategory, string> = {
  social: 'Social',
  possession: 'Possession',
  membership: 'Membership',
};

/**
 * What each category means, in the author's terms.
 *
 * These are the only three shapes the schema allows, and the difference matters: an
 * arc of feeling belongs to a social relation, ownership does not have one, and rank
 * only exists inside a faction.
 */
export const RELATION_CATEGORY_HINTS: Record<RelationCategory, string> = {
  social: 'How two people feel about each other. Sentiment applies here only.',
  possession: 'Who or what holds an item, a place or a title.',
  membership: 'Who belongs to a faction, and at what rank.',
};

/** Relation types in the order the screen groups them. */
export const RELATION_CATEGORY_ORDER: RelationCategory[] = [
  'social',
  'possession',
  'membership',
];

/**
 * Renders sentiment as a signed number with a word, because -3 means nothing on its own.
 *
 * @param sentiment - Integer in -5..5, or null.
 * @returns e.g. `+3 warm`.
 */
export function describeSentiment(sentiment: number | null): string {
  if (sentiment === null) {
    return 'no sentiment';
  }
  const word =
    sentiment >= 4
      ? 'devoted'
      : sentiment >= 2
        ? 'warm'
        : sentiment === 1
          ? 'friendly'
          : sentiment === 0
            ? 'neutral'
            : sentiment === -1
              ? 'cool'
              : sentiment <= -4
                ? 'hostile'
                : 'strained';
  return `${sentiment > 0 ? '+' : ''}${sentiment} ${word}`;
}

/** Entity names for the selects, with the type so two similar names stay distinct. */
export function entityOptions(entities: Entity[]): { id: string; label: string }[] {
  return entities.map((entity) => ({
    id: entity.id,
    label: `${entity.canonicalName} (${entity.type})`,
  }));
}

/** Narrows a category change: fields that belong to another category are dropped. */
export function defaultRelationInput(projectId: string): CreateRelationInput {
  return {
    projectId,
    fromEntityId: '',
    toEntityId: '',
    category: 'social',
    typeLabel: '',
    sentiment: null,
    rank: null,
    validFromChapterId: null,
    validToChapterId: null,
    isSecret: false,
    notes: '',
    knownByEntityIds: [],
  };
}
