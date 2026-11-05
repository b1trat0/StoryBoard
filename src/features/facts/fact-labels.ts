/**
 * Display labels for fact kinds and statuses.
 *
 * The database enums are terse and technical on purpose; the author needs words that
 * mean something while writing. Kept in one file so a label cannot drift between the
 * chapter panel and the entity sheet.
 */

import type { FactKind, FactStatus } from '../../lib/bridge';

export const FACT_KIND_LABELS: Record<FactKind, string> = {
  event: 'Event',
  character_fact: 'Character fact',
  new_entity: 'New entity',
  relation_shift: 'Relation shift',
  open_promise: 'Open promise',
  unresolved: 'Unresolved',
};

export const FACT_STATUS_LABELS: Record<FactStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** The kinds that matter most while writing are listed first. */
export const FACT_KIND_ORDER: FactKind[] = [
  'event',
  'character_fact',
  'open_promise',
  'relation_shift',
  'new_entity',
  'unresolved',
];

/** Status chip colours: approved is the only state that counts as canon. */
export const FACT_STATUS_CLASSES: Record<FactStatus, string> = {
  draft: 'bg-surface-sunken text-ink-muted',
  approved: 'bg-accent-soft text-accent',
  rejected: 'bg-danger-soft text-danger',
};
