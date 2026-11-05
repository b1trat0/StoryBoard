import { useCallback, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { Chapter } from '../../lib/bridge';

/**
 * Owns the chapter the author is typing into.
 *
 * This lives above the section switch on purpose. The editor is only mounted while
 * the Chapters section is showing, so a buffer held inside the editor is destroyed
 * the moment the author glances at the export preview or the storybook — silently,
 * and while the word counter still claims the prose is unsaved. Hoisting the buffer
 * into a hook the shell always calls makes moving between sections a redraw rather
 * than a loss.
 *
 * Two save paths, deliberately different, matching what the editor always did. The
 * outline fields (title, type, status, POV, goal, conflict, outcome, beat) save when
 * the author leaves the field, because they are notes about a chapter that may have no
 * prose yet. The prose does not: it saves only on an explicit call, so a half-written
 * thought is never silently promoted to canon mid-sentence.
 */

/** The chapter as typed, plus the last copy known to be in the database. */
interface DraftRecord {
  /** Which chapter this buffer belongs to. Identity, not object reference. */
  chapterId: string;
  /** What is on screen. */
  draft: Chapter;
  /** What has been written. Comparing the two is what makes "unsaved" honest. */
  saved: Chapter;
}

export interface ChapterDraftState {
  /** The chapter being edited, or null when none is open. */
  draft: Chapter | null;
  /** Title as last written, so a blur can tell a real edit from a no-op commit. */
  savedTitle: string | null;
  /** True when prose or an author note differs from what was last written. */
  isProseDirty: boolean;
  isSavingProse: boolean;
  /** Covers both save paths, because the editor shows one error line for them. */
  errorMessage: string | null;
  updateDraft: (patch: Partial<Chapter>) => void;
  saveOutlineField: (patch: Partial<Chapter>) => Promise<void>;
  /**
   * Writes the prose buffer.
   *
   * @returns True when the database accepted the write. The close guard depends on
   *   knowing the difference: "the write was attempted" is not permission to close a
   *   window on prose that was never stored.
   */
  commitProse: () => Promise<boolean>;
  clearError: () => void;
}

/**
 * Buffers the chapter prose across section switches and chapter switches.
 *
 * @param chapter - The chapter the outline hook has open, or null.
 * @param onSaveOutline - Persists outline fields and refreshes the tree. Injected
 *   because the outline is a separate snapshot: the editor cannot reload it itself,
 *   and a title written here would otherwise never appear in the tree.
 */
export function useChapterDraft(
  chapter: Chapter | null,
  onSaveOutline: (id: string, patch: Partial<Chapter>) => Promise<void>,
): ChapterDraftState {
  const [record, setRecord] = useState<DraftRecord | null>(null);
  const [isSavingProse, setIsSavingProse] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /*
   * Adopting a chapter during render rather than in an effect.
   *
   * The reset is keyed on the chapter id, never on object identity: reopening the
   * same chapter produces a fresh object, and comparing references would let a
   * background reload overwrite prose the author has typed but not saved. Keying on
   * the id means a chapter switch resets, and a refetch of the open chapter does not.
   *
   * Doing this during render is React's documented alternative to an effect. An
   * effect would paint one frame holding the previous chapter's prose before the
   * reset, so the author would see a flash of the wrong chapter's words.
   */
  if (chapter !== null && (record === null || record.chapterId !== chapter.id)) {
    setRecord({ chapterId: chapter.id, draft: chapter, saved: chapter });
  } else if (chapter === null && record !== null) {
    // The open chapter was deleted from under the editor.
    setRecord(null);
  }

  const draft = record?.draft ?? null;

  const isProseDirty =
    draft !== null &&
    (draft.bodyMd !== record?.saved.bodyMd ||
      draft.authorNotePre !== record?.saved.authorNotePre ||
      draft.authorNotePost !== record?.saved.authorNotePost);

  const updateDraft = useCallback((patch: Partial<Chapter>) => {
    setRecord((current) =>
      current === null ? null : { ...current, draft: { ...current.draft, ...patch } },
    );
  }, []);

  const saveOutlineField = useCallback(
    async (patch: Partial<Chapter>) => {
      if (record === null) {
        return;
      }
      setErrorMessage(null);
      try {
        await onSaveOutline(record.draft.id, patch);
        // The saved copy moves with the field, so the title blur guard can tell a
        // real edit from re-committing what the database already holds.
        setRecord((current) =>
          current === null ? null : { ...current, saved: { ...current.saved, ...patch } },
        );
      } catch (err) {
        setErrorMessage(describeError(err));
      }
    },
    [onSaveOutline, record],
  );

  const commitProse = useCallback(async (): Promise<boolean> => {
    const bridge = getBridge();
    if (bridge === null || record === null) {
      return false;
    }
    setIsSavingProse(true);
    setErrorMessage(null);
    try {
      const current = record.draft;
      const persisted = await bridge.chapters.saveProse({
        id: current.id,
        bodyMd: current.bodyMd,
        authorNotePre: current.authorNotePre,
        authorNotePost: current.authorNotePost,
      });
      // Both copies become what the database now holds, which is what clears "unsaved".
      setRecord((current2) =>
        current2 === null ? null : { chapterId: current2.chapterId, draft: persisted, saved: persisted },
      );
      return true;
    } catch (err) {
      setErrorMessage(describeError(err));
      return false;
    } finally {
      setIsSavingProse(false);
    }
  }, [record]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  return {
    draft,
    savedTitle: record?.saved.title ?? null,
    isProseDirty,
    isSavingProse,
    errorMessage,
    updateDraft,
    saveOutlineField,
    commitProse,
    clearError,
  };
}