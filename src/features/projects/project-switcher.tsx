import { Plus } from '@phosphor-icons/react';
import { Button } from '../../components/ui/button';
import type { Project } from '../../lib/bridge';

export interface ProjectSwitcherProps {
  projects: Project[];
  activeProjectId: string | null;
  isLoading: boolean;
  /** True while prose is unsaved, so switching cannot silently drop it. */
  isDisabled: boolean;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
}

/**
 * The work switcher.
 *
 * A native select rather than a custom menu: it is keyboard navigable, screen-reader
 * correct and free. With one work it is still shown, because an author who does not
 * know a second work is possible will never look for the feature.
 */
export function ProjectSwitcher({
  projects,
  activeProjectId,
  isLoading,
  isDisabled,
  onSelect,
  onCreate,
}: ProjectSwitcherProps) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="work-switcher" className="sr-only">
        Work
      </label>
      <select
        id="work-switcher"
        value={activeProjectId ?? ''}
        disabled={isLoading || isDisabled || projects.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        title={isDisabled ? 'Save your prose before switching works' : 'Switch work'}
        className="h-8 max-w-[220px] rounded-md border border-line bg-surface px-2 text-[13px] text-ink-soft disabled:cursor-not-allowed disabled:opacity-55"
      >
        {projects.length === 0 && <option value="">No work yet</option>}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="sm" onClick={onCreate} aria-label="Create a new work">
        <Plus size={14} weight="bold" aria-hidden="true" />
        New work
      </Button>
    </div>
  );
}
