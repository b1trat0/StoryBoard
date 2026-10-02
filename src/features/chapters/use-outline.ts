import { useCallback, useEffect, useState } from 'react';
import { getBridge } from '../../lib/bridge';
import type {
  Arc,
  Chapter,
  OutlineNodeKind,
  OutlineTree,
  Volume,
} from '../../lib/bridge';

/**
 * Loads and mutates the outline: volumes, arcs and chapters.
 *
 * The tree and the open chapter are fetched separately on purpose. The tree omits
 * body_md so it stays cheap to redraw, and the editor holds the one chapter whose
 * prose is actually on screen. Saving prose therefore never has to reload the
 * whole outline.
 */

export interface OutlineState {
  tree: OutlineTree;
  isLoading: boolean;
  errorMessage: string | null;
  pendingKey: string | null;
  chapter: Chapter | null;
  isChapterLoading: boolean;
  reload: () => Promise<void>;
  openChapter: (chapterId: string) => Promise<void>;
  createVolume: (input: { title: string; summary?: string }) => Promise<Volume>;
  createArc: (input: { volumeId: string; title: string; summary?: string }) => Promise<Arc>;
  createChapter: (input: {
    arcId: string;
    title: string;
    type?: Chapter['type'];
    status?: Chapter['status'];
  }) => Promise<Chapter>;
  removeNode: (input: { kind: OutlineNodeKind; id: string }) => Promise<void>;
}

const EMPTY_TREE: OutlineTree = { volumes: [] };

export function useOutline(projectId: string): OutlineState {
  const [tree, setTree] = useState<OutlineTree>(EMPTY_TREE);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [isChapterLoading, setIsChapterLoading] = useState(false);

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null) {
      // The shell renders the no-bridge screen instead, so there is nothing to
      // load and nothing useful to say here.
      setIsLoading(false);
      return;
    }
    setErrorMessage(null);
    try {
      setTree(await bridge.outline.list({ projectId }));
    } catch (err) {
      setErrorMessage(messageOf(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await, so nothing cascades synchronously; the
    // lint rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const openChapter = useCallback(async (chapterId: string) => {
    const bridge = getBridge();
    if (bridge === null) {
      return;
    }
    setIsChapterLoading(true);
    try {
      setChapter(await bridge.chapters.get({ id: chapterId }));
    } catch (err) {
      setErrorMessage(messageOf(err));
    } finally {
      setIsChapterLoading(false);
    }
  }, []);

  /**
   * Every mutation reloads the tree afterwards rather than patching it locally.
   * Ordinals are assigned by the database, so a local guess would drift from the
   * real order the moment anything else changed it.
   */
  const runMutation = useCallback(
    async <T,>(key: string, work: (bridge: NonNullable<ReturnType<typeof getBridge>>) => Promise<T>) => {
      const bridge = getBridge();
      if (bridge === null) {
        throw new Error('The app is not connected to its database.');
      }
      setPendingKey(key);
      setErrorMessage(null);
      try {
        return await work(bridge);
      } finally {
        setPendingKey(null);
        await reload();
      }
    },
    [reload],
  );

  const createVolume: OutlineState['createVolume'] = useCallback(
    (input) => runMutation('volume', (bridge) => bridge.outline.createVolume({ projectId, ...input })),
    [runMutation, projectId],
  );

  const createArc: OutlineState['createArc'] = useCallback(
    (input) => runMutation(`arc:${input.volumeId}`, (bridge) => bridge.outline.createArc(input)),
    [runMutation],
  );

  const createChapter: OutlineState['createChapter'] = useCallback(
    (input) => runMutation(`chapter:${input.arcId}`, (bridge) => bridge.chapters.create(input)),
    [runMutation],
  );

  const removeNode: OutlineState['removeNode'] = useCallback(
    async ({ kind, id }) => {
      await runMutation(`remove:${id}`, async (bridge) => {
        if (kind === 'volume') {
          await bridge.outline.removeVolume({ id });
        } else if (kind === 'arc') {
          await bridge.outline.removeArc({ id });
        } else {
          await bridge.chapters.remove({ id });
        }
      });
      // The open chapter may have been the one deleted, or may have been deleted
      // from under the editor by removing its arc or volume.
      setChapter((current) => (current !== null && current.id === id ? null : current));
    },
    [runMutation],
  );

  return {
    tree,
    isLoading,
    errorMessage,
    pendingKey,
    chapter,
    isChapterLoading,
    reload,
    openChapter,
    createVolume,
    createArc,
    createChapter,
    removeNode,
  };
}

/** Narrows an unknown rejection to the message the author should read. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
