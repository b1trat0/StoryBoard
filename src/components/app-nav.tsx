import { SECTIONS } from '../lib/sections';
import type { SectionId } from '../lib/sections';
import { cn } from '../lib/utils';

export interface AppNavProps {
  activeSection: SectionId;
  onSelectSection: (section: SectionId) => void;
}

/**
 * The section switcher in the header.
 *
 * Sections without a screen are rendered disabled rather than hidden, so the shape
 * of the app is visible while it is being built. Clicking one is a no-op, not a
 * route to an empty page.
 */
export function AppNav({ activeSection, onSelectSection }: AppNavProps) {
  return (
    <nav aria-label="Sections" className="flex items-center gap-0.5">
      {SECTIONS.map((section) => {
        const isActive = section.id === activeSection;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => {
              if (section.isBuilt) {
                onSelectSection(section.id);
              }
            }}
            disabled={!section.isBuilt}
            aria-current={isActive ? 'page' : undefined}
            title={
              section.isBuilt
                ? section.label
                : `${section.label} is not built yet`
            }
            className={cn(
              'rounded-md px-2.5 py-1 text-[13px] transition-colors',
              isActive
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink-soft',
              !section.isBuilt && 'cursor-default opacity-45 hover:bg-transparent',
            )}
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );
}
