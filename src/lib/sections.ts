/**
 * The screens this app has.
 *
 * Centralised so the header navigation, the left pane and the placeholder states
 * all agree on what exists. A section is listed here the moment it has a screen,
 * and `isBuilt` is the only thing that changes when it gets one, which means the
 * app can never advertise a screen that does not open.
 */
export const SECTIONS = [
  { id: 'storybook', label: 'Storybook', isBuilt: true },
  { id: 'chapters', label: 'Chapters', isBuilt: true },
  { id: 'glossary', label: 'Glossary', isBuilt: false },
  { id: 'relations', label: 'Relations', isBuilt: false },
  { id: 'illustrations', label: 'Illustrations', isBuilt: false },
  { id: 'export', label: 'Royal Road export', isBuilt: true },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export type Section = (typeof SECTIONS)[number];

/** Narrows an arbitrary string to a section id, for restoring nothing in particular. */
export function isSectionId(value: string): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

export function sectionLabel(id: SectionId): string {
  const found = SECTIONS.find((section) => section.id === id);
  // Every id in SectionId has a label by construction, so this branch is only
  // reachable if the two lists drift apart.
  if (found === undefined) {
    throw new Error(`No section is registered with the id ${id}`);
  }
  return found.label;
}
