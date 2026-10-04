import { FloppyDisk } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/button';
import { EmptyState, Skeleton } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { describeError, getBridge } from '../../lib/bridge';
import type { Chapter, ChapterStatus, ChapterType } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import {
  CHAPTER_TYPES,
  STATUS_LABELS,
  STATUS_STYLES,
  typeDescription,
} from './chapter-labels';

export interface ChapterEditorProps {
  chapter: Chapter | null;
  isLoading: boolean;
  /**
   * Persists outline fields and refreshes the outline tree. Injected rather than
   * taken from the bridge here so the tree the author is looking at cannot fall out
   * of step with the chapter they just renamed.
   */
  onSaveOutline: (id: string, patch: Partial<Chapter>) => Promise<void>;
}

/**
 * The chapter editor.
 *
 * Two save paths, deliberately different. The outline fields (title, type, status,
 * POV, goal, conflict, outcome, beat) save when the author leaves a field, because
 * they are notes about a chapter that may not have prose yet. The prose does not:
 * it saves only on an explicit click, so a half-written thought is never silently
 * promoted to canon mid-sentence.
 *
 * body_md stays plain markdown, blank-line separated, so the same text is still
 * usable in Obsidian or any editor outside this app.
 *
 * The draft is seeded from props once and then owned by this component. App keys it
 * by chapter id, so switching chapters remounts it; a refetch of the chapter already
 * open does not, which is what keeps unsaved prose from being overwritten by a
 * background reload.
 */
export function ChapterEditor({ chapter, isLoading, onSaveOutline }: ChapterEditorProps) {
  // Owned from first render, not synced from props: see the note above.
  const [draft, setDraft] = useState<Chapter | null>(chapter);
  // What the database currently holds. `draft` is what is on screen; this is what
  // has been written. Comparing the two is what makes "unsaved" honest, because the
  // incoming prop is the chapter as it was fetched and does not change after a save.
  const [saved, setSaved] = useState<Chapter | null>(chapter);
  const [isSavingProse, setIsSavingProse] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onFieldChange = useCallback((patch: Partial<Chapter>) => {
    setDraft((current) => (current === null ? null : { ...current, ...patch }));
  }, []);

  const saveOutlineField = useCallback(
    async (patch: Partial<Chapter>) => {
      const current = draft;
      if (current === null) {
        return;
      }
      setErrorMessage(null);
      try {
        // The hook owns this call so the tree reloads with it; see onSaveOutline.
        await onSaveOutline(current.id, patch);
        setSaved((previous) => (previous === null ? null : { ...previous, ...patch }));
      } catch (err) {
        setErrorMessage(describeError(err));
      }
    },
    [draft, onSaveOutline],
  );

  const commitProse = useCallback(async () => {
    const bridge = getBridge();
    const current = draft;
    if (bridge === null || current === null) {
      return;
    }
    setIsSavingProse(true);
    setErrorMessage(null);
    try {
      const persisted = await bridge.chapters.saveProse({
        id: current.id,
        bodyMd: current.bodyMd,
        authorNotePre: current.authorNotePre,
        authorNotePost: current.authorNotePost,
      });
      setDraft(persisted);
      setSaved(persisted);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsSavingProse(false);
    }
  }, [draft]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-8">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (draft === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <EmptyState
            title="Pick a chapter"
            body="Choose a chapter from the outline to read or write it. Prose is saved only when you press Save."
          />
        </div>
      </div>
    );
  }

  const isProseDirty =
    draft.bodyMd !== (saved?.bodyMd ?? '') ||
    draft.authorNotePre !== (saved?.authorNotePre ?? '') ||
    draft.authorNotePost !== (saved?.authorNotePost ?? '');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 pb-10 pt-7">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide',
                STATUS_STYLES[draft.status],
              )}
            >
              {STATUS_LABELS[draft.status]}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-ink-muted">
              {typeDescription(draft.type)}
            </span>
          </div>

          <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-ink">
            <Label htmlFor="chapter-title" className="sr-only">
              Chapter title
            </Label>
            <Input
              id="chapter-title"
              value={draft.title}
              onChange={(event) => onFieldChange({ title: event.target.value })}
              onBlur={() => {
                const trimmed = draft.title.trim();
                if (trimmed.length > 0 && trimmed !== saved?.title) {
                  void saveOutlineField({ title: trimmed });
                }
              }}
              className="h-auto border-0 bg-transparent px-0 py-1 font-serif text-2xl font-semibold shadow-none focus-visible:ring-0"
            />
          </h1>

          {errorMessage !== null && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger"
            >
              {errorMessage}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="chapter-status">Status</Label>
              <select
                id="chapter-status"
                value={draft.status}
                onChange={(event) => {
                  const status = event.target.value as ChapterStatus;
                  onFieldChange({ status });
                  void saveOutlineField({ status });
                }}
                className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {(Object.keys(STATUS_LABELS) as ChapterStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="chapter-type">Kind</Label>
              <select
                id="chapter-type"
                value={draft.type}
                onChange={(event) => {
                  const type = event.target.value as ChapterType;
                  onFieldChange({ type });
                  void saveOutlineField({ type });
                }}
                className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {CHAPTER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <section className="mt-8 border-t border-line pt-6">
            <h2 className="font-serif text-[15px] font-semibold text-ink">
              The outline
              <span className="ml-2 font-sans text-[11px] font-normal uppercase tracking-wider text-ink-muted">
                one line is the floor
              </span>
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Goal, conflict and outcome are for chapters the structure depends on.
              Leave them empty for the ones that only need to exist.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <OutlineField
                id="chapter-goal"
                label="Goal"
                value={draft.outlineGoal}
                onCommit={(value) => {
                  onFieldChange({ outlineGoal: value });
                  void saveOutlineField({ outlineGoal: value });
                }}
              />
              <OutlineField
                id="chapter-conflict"
                label="Conflict"
                value={draft.outlineConflict}
                onCommit={(value) => {
                  onFieldChange({ outlineConflict: value });
                  void saveOutlineField({ outlineConflict: value });
                }}
              />
              <OutlineField
                id="chapter-outcome"
                label="Outcome"
                value={draft.outlineOutcome}
                onCommit={(value) => {
                  onFieldChange({ outlineOutcome: value });
                  void saveOutlineField({ outlineOutcome: value });
                }}
              />
              <OutlineField
                id="chapter-beat"
                label="Beat"
                value={draft.outlineBeat}
                onCommit={(value) => {
                  onFieldChange({ outlineBeat: value });
                  void saveOutlineField({ outlineBeat: value });
                }}
              />
            </div>
          </section>

          <section className="mt-8 border-t border-line pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-serif text-[15px] font-semibold text-ink">Prose</h2>
              <span className="font-mono text-xs tabular-nums text-ink-muted">
                {countWords(draft.bodyMd).toLocaleString()} words
                {isProseDirty && <span className="ml-1.5 text-accent">unsaved</span>}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Plain markdown, paragraphs separated by a blank line. Saved only when you
              press Save.
            </p>

            <Label htmlFor="chapter-body" className="sr-only">
              Chapter prose
            </Label>
            <Textarea
              id="chapter-body"
              value={draft.bodyMd}
              onChange={(event) => onFieldChange({ bodyMd: event.target.value })}
              rows={22}
              placeholder="The prose goes here."
              className="mt-3 font-serif text-[15px] leading-[1.75]"
            />
          </section>

          {/*
            Royal Road's chapter form is Title, Author Notes, Chapter Content. The
            notes are two separate boxes that render above and below the prose, so they
            are two fields here rather than one. They sit below the prose because that
            is the order the eye needs them in while writing: the chapter is the work,
            the notes are the footnote. Kept inside the same explicit save so a note
            cannot be typed and left behind.
          */}
          <section className="mt-8 border-t border-line pt-6">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              Author notes
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Shown on Royal Road outside the chapter text, and left out of its RSS feed.
              Pre sits above the prose, post sits below it.
            </p>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="chapter-note-pre">Pre-chapter note</Label>
                <Textarea
                  id="chapter-note-pre"
                  value={draft.authorNotePre}
                  onChange={(event) => onFieldChange({ authorNotePre: event.target.value })}
                  rows={4}
                  placeholder="Optional. Schedule, a reminder, a shout-out."
                />
              </div>
              <div>
                <Label htmlFor="chapter-note-post">Post-chapter note</Label>
                <Textarea
                  id="chapter-note-post"
                  value={draft.authorNotePost}
                  onChange={(event) => onFieldChange({ authorNotePost: event.target.value })}
                  rows={4}
                  placeholder="Optional. Links, thanks, housekeeping."
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-surface px-6 py-3">
        <span className="mr-auto text-[12px] text-ink-muted">
          {isProseDirty ? 'Unsaved prose' : 'Everything saved'}
        </span>
        <Button onClick={() => void commitProse()} disabled={!isProseDirty || isSavingProse}>
          <FloppyDisk size={15} weight="bold" />
          {isSavingProse ? 'Saving...' : 'Save prose'}
        </Button>
      </footer>
    </div>
  );
}

interface OutlineFieldProps {
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
}

/**
 * An outline field that saves when it loses focus.
 *
 * Saving on every keystroke would write a row per character; saving only on an
 * explicit button would mean six buttons. Blur is the moment the author has
 * finished typing a thought.
 *
 * The local value is what makes this work: the parent only learns the new text on
 * blur, so typing stays local and the commit is one write.
 */
function OutlineField({ id, label, value, onCommit }: OutlineFieldProps) {
  const [text, setText] = useState(value);

  // A chapter switch remounts the whole editor, so this only covers the case where
  // the parent replaced the value underneath a field the author was not editing.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== value) {
            onCommit(text);
          }
        }}
        rows={2}
        placeholder="Optional"
      />
    </div>
  );
}

/** Mirrors the main process word count so the number does not jump on save. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
