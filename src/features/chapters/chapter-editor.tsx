import { ArrowDown, ArrowUp, FloppyDisk, MagnifyingGlass, Sparkle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { EmptyState, Skeleton } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { FactsPanel } from '../facts/facts-panel';
import { AssistDialog } from '../assist/assist-dialog';
import { IllustrationsPanel } from '../illustrations/illustrations-panel';
import { countParagraphs } from '../../lib/chapter-text';
import type { Chapter, ChapterStatus, ChapterType, CrashDraft } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import {
  CHAPTER_TYPES,
  STATUS_LABELS,
  STATUS_STYLES,
  typeDescription,
} from './chapter-labels';

export interface ChapterEditorProps {
  /**
   * The chapter as typed, or null when none is open.
   *
   * Owned by `useChapterDraft` rather than by this component. The editor is unmounted
   * whenever the author visits another section, so state held here would not survive
   * the trip.
   */
  draft: Chapter | null;
  isLoading: boolean;
  /** True when prose or an author note differs from what was last written. */
  isDirty: boolean;
  /** Title as last written, so a blur can tell a real edit from a no-op commit. */
  savedTitle: string | null;
  isSavingProse: boolean;
  errorMessage: string | null;
  updateDraft: (patch: Partial<Chapter>) => void;
  /**
   * Persists outline fields and refreshes the outline tree. The hook owns the call so
   * the tree reloads with it; see `useChapterDraft`.
   */
  saveOutlineField: (patch: Partial<Chapter>) => Promise<void>;
  commitProse: () => Promise<boolean>;
  /** A crash-recovery copy that differs from the chapter in the database. */
  recoveredDraft: CrashDraft | null;
  onRestoreDraft: () => Promise<void>;
  onDiscardDraft: () => Promise<void>;
  /** Work the facts belong to. */
  projectId: string | null;
  /** Chapters available as a source for a fact about this chapter. */
  chapters: { id: string; title: string }[];
  /** Characters available as the point of view. */
  povOptions: { id: string; label: string }[];
  /** Moves this chapter one position within its arc. */
  onMoveChapter: (direction: 'up' | 'down') => Promise<void>;
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
 * Controlled, with no state of its own beyond the outline fields' local typing. The
 * buffer belongs to `useChapterDraft`, which lives above the section switch so that
 * looking at another section cannot destroy unsaved prose.
 */
export function ChapterEditor({
  draft,
  isLoading,
  isDirty,
  savedTitle,
  isSavingProse,
  errorMessage,
  updateDraft: onFieldChange,
  saveOutlineField: saveOutline,
  commitProse,
  recoveredDraft,
  onRestoreDraft,
  onDiscardDraft,
  projectId,
  chapters,
  povOptions,
  onMoveChapter,
}: ChapterEditorProps) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isAssistOpen, setIsAssistOpen] = useState(false);

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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        // Ctrl+S is the keystroke a writer presses without thinking. Here it does the
        // only sensible thing rather than opening a browser save dialog.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          if (isDirty && !isSavingProse) {
            void commitProse();
          }
        }
      }}
    >
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
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Writing assist"
                onClick={() => setIsAssistOpen(true)}
              >
                <Sparkle size={14} weight="bold" aria-hidden="true" />
                Assist
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Move chapter earlier"
                onClick={() => void onMoveChapter('up')}
              >
                <ArrowUp size={14} weight="bold" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Move chapter later"
                onClick={() => void onMoveChapter('down')}
              >
                <ArrowDown size={14} weight="bold" aria-hidden="true" />
              </Button>
            </div>
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
                if (trimmed.length > 0 && trimmed !== savedTitle) {
                  void saveOutline({ title: trimmed });
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
                  void saveOutline({ status });
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
                  void saveOutline({ type });
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
                  void saveOutline({ outlineGoal: value });
                }}
              />
              <OutlineField
                id="chapter-conflict"
                label="Conflict"
                value={draft.outlineConflict}
                onCommit={(value) => {
                  onFieldChange({ outlineConflict: value });
                  void saveOutline({ outlineConflict: value });
                }}
              />
              <OutlineField
                id="chapter-outcome"
                label="Outcome"
                value={draft.outlineOutcome}
                onCommit={(value) => {
                  onFieldChange({ outlineOutcome: value });
                  void saveOutline({ outlineOutcome: value });
                }}
              />
              <OutlineField
                id="chapter-beat"
                label="Beat"
                value={draft.outlineBeat}
                onCommit={(value) => {
                  onFieldChange({ outlineBeat: value });
                  void saveOutline({ outlineBeat: value });
                }}
              />
            </div>
          </section>

          <section className="mt-8 border-t border-line pt-6">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              Details
            </h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="chapter-pov">Point of view</Label>
                <select
                  id="chapter-pov"
                  value={draft.povEntityId ?? ''}
                  onChange={(event) =>
                    void saveOutline({
                      povEntityId: event.target.value === '' ? null : event.target.value,
                    })
                  }
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
                >
                  <option value="">Not set</option>
                  {povOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="chapter-rr-url" hint="optional">
                  Published URL
                </Label>
                <Input
                  key={`${draft.id}:${draft.rrUrl ?? ''}`}
                  id="chapter-rr-url"
                  defaultValue={draft.rrUrl ?? ''}
                  placeholder="https://www.royalroad.com/fiction/…"
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value !== (draft.rrUrl ?? '')) {
                      void saveOutline({ rrUrl: value === '' ? null : value });
                    }
                  }}
                  className="h-8 text-[12.5px]"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="chapter-published-at" hint="optional">
                  Published on
                </Label>
                <input
                  id="chapter-published-at"
                  type="date"
                  value={draft.publishedAt?.slice(0, 10) ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    void saveOutline({
                      publishedAt:
                        value === '' ? null : new Date(`${value}T00:00:00`).toISOString(),
                    });
                  }}
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
                />
              </div>
            </div>
          </section>

          {recoveredDraft != null && (
            <div
              role="status"
              className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-sunken px-3.5 py-2.5"
            >
              <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-soft">
                An unsaved draft from{' '}
                <span className="font-medium text-ink">
                  {new Date(recoveredDraft.savedAt).toLocaleString()}
                </span>{' '}
                was recovered from disk. It is not in the database until you restore
                and save it.
              </p>
              <Button size="sm" variant="secondary" onClick={() => void onRestoreDraft()}>
                Restore draft
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void onDiscardDraft()}>
                Discard
              </Button>
            </div>
          )}

          <section className="mt-8 border-t border-line pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-serif text-[15px] font-semibold text-ink">Prose</h2>
              <span className="font-mono text-xs tabular-nums text-ink-muted">
                {countWords(draft.bodyMd).toLocaleString()} words
                {isDirty && <span className="ml-1.5 text-accent">unsaved</span>}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFindOpen((current) => !current)}
                aria-expanded={isFindOpen}
              >
                <MagnifyingGlass size={14} aria-hidden="true" />
                Find &amp; replace
              </Button>
              {isFindOpen && (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <Input
                    aria-label="Find text"
                    value={findText}
                    onChange={(event) => setFindText(event.target.value)}
                    placeholder="Find"
                    className="h-8 w-40 text-[12.5px]"
                  />
                  <Input
                    aria-label="Replace with"
                    value={replaceText}
                    onChange={(event) => setReplaceText(event.target.value)}
                    placeholder="Replace with"
                    className="h-8 w-40 text-[12.5px]"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={findText.length === 0}
                    onClick={() => {
                      if (findText.length === 0) {
                        return;
                      }
                      // A literal replacement, not a regular expression: the author is
                      // fixing a name or a typo, and a stray bracket becoming a pattern
                      // would replace things they never selected.
                      onFieldChange({
                        bodyMd: draft.bodyMd.split(findText).join(replaceText),
                      });
                    }}
                  >
                    Replace all
                  </Button>
                  <span className="text-[11.5px] text-ink-muted">
                    {findText.length === 0
                      ? 'Type what to find'
                      : `${draft.bodyMd.split(findText).length - 1} matches`}
                  </span>
                </div>
              )}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Plain markdown, paragraphs separated by a blank line. Nothing is written
              until you save — press Ctrl+S, or use Save prose below.
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

          <section className="mt-8 border-t border-line pt-6">
            <IllustrationsPanel
              chapterId={draft.id}
              paragraphCount={countParagraphs(draft.bodyMd)}
            />
          </section>

          <section className="mt-8 border-t border-line pt-6">
            <FactsPanel
              projectId={projectId}
              scopeType="chapter"
              scopeId={draft.id}
              chapters={chapters}
              fixedChapterId={draft.id}
              emptyMessage="Nothing recorded for this chapter yet."
              hint="What happened here, so you do not have to reread it later. A fact without a quote cannot be checked."
            />
          </section>
        </div>
      </div>

      {isAssistOpen && (
        <AssistDialog
          chapterId={draft.id}
          projectId={projectId}
          bodyMd={draft.bodyMd}
          onApplySuggestion={(suggestion) => {
            // Applying is a plain splice at the offsets the model returned. The span
            // was verified against this exact text before it reached here, and the
            // author can still undo it with the buffer's own undo.
            onFieldChange({
              bodyMd:
                draft.bodyMd.slice(0, suggestion.start) +
                suggestion.suggestion +
                draft.bodyMd.slice(suggestion.end),
            });
          }}
          onClose={() => setIsAssistOpen(false)}
        />
      )}

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-surface px-6 py-3">
        <span className="mr-auto text-[12px] text-ink-muted">
          {isDirty ? 'Unsaved prose' : 'Everything saved'}
        </span>
        <Button onClick={() => void commitProse()} disabled={!isDirty || isSavingProse}>
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

  // A chapter switch no longer remounts the editor, because the buffer moved into
  // `useChapterDraft` so that it survives a section switch. This is what adopts the new
  // chapter's value now, and also covers the parent replacing the value underneath a
  // field the author was not editing.
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
