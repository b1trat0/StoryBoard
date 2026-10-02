import type { ChapterStatus, ChapterType } from '../../lib/bridge';

/**
 * Presentation for chapter status and type.
 *
 * Shared by the outline tree and the editor so a chapter cannot be one colour in
 * the tree and another colour on the page. Kept apart from the components because
 * it is data about labels, not a component.
 */

/** Status is the author's own progress marker, so it stays low-contrast. */
export const STATUS_STYLES: Record<ChapterStatus, string> = {
  outline: 'bg-surface-sunken text-ink-muted',
  draft: 'bg-accent-soft text-accent',
  done: 'bg-success-soft text-success',
};

export const STATUS_LABELS: Record<ChapterStatus, string> = {
  outline: 'Outline',
  draft: 'Draft',
  done: 'Done',
};

export const CHAPTER_TYPES: ChapterType[] = ['chapter', 'prologue', 'epilogue', 'interlude'];

export function typeLabel(type: ChapterType): string {
  return type === 'chapter' ? 'Ch' : type.slice(0, 4);
}

/** Prose kind in the author's own words. Interludes are not chapters. */
export function typeDescription(type: ChapterType): string {
  switch (type) {
    case 'prologue':
      return 'Opens the book, before the main story.';
    case 'epilogue':
      return 'Closes the book, after the main story.';
    case 'interlude':
      return 'Stays on the same timeline but sits outside the main arc.';
    case 'chapter':
      return 'Part of the main arc.';
  }
}
