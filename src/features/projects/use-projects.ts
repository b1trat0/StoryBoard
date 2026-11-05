import { useCallback, useEffect, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { Project, ProjectKind } from '../../lib/bridge';

/**
 * The works this app holds, and which one is open.
 *
 * The active work is remembered by the main process, not by renderer storage: the
 * renderer is sandboxed and owns no durable state, and a work chosen yesterday must
 * survive the window being reopened.
 *
 * Nothing here writes to a work's data. Switching asks the main process to remember
 * the choice; the loaders keyed on `activeProject.id` then refetch for the new work.
 */

export interface ProjectsState {
  projects: Project[];
  activeProject: Project | null;
  isLoading: boolean;
  errorMessage: string | null;
  selectProject: (projectId: string) => Promise<void>;
  createProject: (input: {
    title: string;
    kind: ProjectKind;
    exportProfile: 'royal_road' | 'plain';
  }) => Promise<Project>;
  refresh: () => Promise<void>;
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null) {
      setIsLoading(false);
      return;
    }

    try {
      const [list, active] = await Promise.all([
        bridge.projects.list({}),
        bridge.projects.getActive({}),
      ]);
      setProjects(list);
      setActiveId(active.projectId);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Reading the work list is the legitimate reason for an effect here. Every
    // setState runs after an await, so nothing cascades synchronously; the lint rule
    // cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const selectProject = useCallback(async (projectId: string) => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    await bridge.projects.setActive({ projectId });
    setActiveId(projectId);
  }, []);

  const createProject = useCallback(
    async (input: {
      title: string;
      kind: ProjectKind;
      exportProfile: 'royal_road' | 'plain';
    }): Promise<Project> => {
      const bridge = getBridge();
      if (bridge === null) {
        throw new Error('Not running inside the StoryBoard app');
      }
      const created = await bridge.projects.create(input);
      // Creating a work is an intent to work on it, so it becomes the open one.
      await bridge.projects.setActive({ projectId: created.id });
      setActiveId(created.id);
      setProjects((current) => [...current, created]);
      return created;
    },
    [],
  );

  const activeProject =
    projects.find((project) => project.id === activeId) ?? projects[0] ?? null;

  return {
    projects,
    activeProject,
    isLoading,
    errorMessage,
    selectProject,
    createProject,
    refresh,
  };
}
