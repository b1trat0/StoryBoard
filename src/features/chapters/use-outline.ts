import { useCallback, useEffect, useState } from 'react';
import { getBridge } from '../../lib/bridge';
import type {
  Arc,
  Chapter,
  OutlineNodeKind,
  OutlineTree,
  SaveChapterOutlineInput,
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
  /** The highlighted chapter in the tree, which may not be loaded. */
  selectedChapterId: string | null;
  isChapterLoading: boolean;
  reload: () => Promise<void>;
  /**
   * Moves the selection without reading the chapter.
   *
   * The export preview needs to know which chapter is selected but does not need
   * its prose, and making it wait on `openChapter` would read the same row twice.
   */
  selectChapter: (chapterId: string) => void;
  /** Selects a chapter and loads it, for the editor. */
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
  /**
   * Persist outline fields of a chapter the editor has open, then refresh the tree.
   *
   * The editor cannot do this itself. It holds the chapter as its own state and the
   * tree is a separate snapshot taken at load time, so a title saved in the editor
   * was written to the database and then stayed invisible in the outline: the
   * chapter kept showing the placeholder name it was created with, which reads as
   * "my title did not save".
   */
  saveChapterOutline: (id: string, patch: Partial<Chapter>) => Promise<void>;
}

const EMPTY_TREE: OutlineTree = { volumes: [] };

export function useOutline(projectId: string): OutlineState {
  const [tree, setTree] = useState<OutlineTree>(EMPTY_TREE);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
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

  const selectChapter = useCallback((chapterId: string) => {
    setSelectedChapterId(chapterId);
  }, []);

  const openChapter = useCallback(async (chapterId: string) => {
    setSelectedChapterId(chapterId);
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

  const saveChapterOutline: OutlineState['saveChapterOutline'] = useCallback(
    async (id, patch) => {
      await runMutation(`outline:${id}`, (bridge) =>
        bridge.chapters.saveOutline({ id, ...toOutlinePatch(patch) }),
      );
    },
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
      setSelectedChapterId((current) => (current === id ? null : current));
    },
    [runMutation],
  );

  return {
    tree,
    isLoading,
    errorMessage,
    pendingKey,
    chapter,
    selectedChapterId,
    isChapterLoading,
    reload,
    selectChapter,
    openChapter,
    createVolume,
    createArc,
    createChapter,
    saveChapterOutline,
    removeNode,
  };
}

/** Narrows an unknown rejection to the message the author should read. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Reduce a chapter edit to the outline fields the author actually touched.
 *
 * `Partial<Chapter>` is the editor's internal shape and carries prose, counts and
 * timestamps; `saveOutline` accepts none of those. Copying known keys explicitly
 * means a new column on `Chapter` is never sent by accident, and an absent field
 * stays absent rather than becoming an empty string that would erase the value the
 * author saved earlier.
 */
function toOutlinePatch(
  patch: Partial<Chapter>,
): Omit<SaveChapterOutlineInput, 'id'> {
  const wire: Omit<SaveChapterOutlineInput, 'id'> = {};
  if (patch.title !== undefined) wire.title = patch.title;
  if (patch.type !== undefined) wire.type = patch.type;
  if (patch.status !== undefined) wire.status = patch.status;
  if (patch.povEntityId !== undefined) wire.povEntityId = patch.povEntityId;
  if (patch.outlineGoal !== undefined) wire.outlineGoal = patch.outlineGoal;
  if (patch.outlineConflict !== undefined) wire.outlineConflict = patch.outlineConflict;
  if (patch.outlineOutcome !== undefined) wire.outlineOutcome = patch.outlineOutcome;
  if (patch.outlineBeat !== undefined) wire.outlineBeat = patch.outlineBeat;
  return wire;
}
