import { BookOpen, CaretRight, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { EmptyState, Skeleton } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { describeError, getBridge } from '../../lib/bridge';
import type { OutlineDeletionImpact, OutlineNodeKind, OutlineTree } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import type { OutlineState } from './use-outline';
import { STATUS_STYLES, typeLabel } from './chapter-labels';

export interface OutlineTreeProps {
  outline: OutlineState;
  selectedChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
}

/** What the author is about to create. Drives which dialog opens. */
type DraftKind = 'volume' | 'arc';

interface PendingDelete {
  kind: OutlineNodeKind;
  id: string;
  title: string;
}

/**
 * The outline: volumes, arcs and chapters, nested.
 *
 * Collapsed by default at volume level. A serial novel has hundreds of chapters,
 * and opening every level at once turns navigation into a wall of text; the author
 * expands the volume they are working in.
 */
export function OutlineTree({
  outline,
  selectedChapterId,
  onSelectChapter,
}: OutlineTreeProps) {
  const { tree, isLoading, pendingKey, createVolume, createArc, createChapter, removeNode } =
    outline;

  const [expandedVolumes, setExpandedVolumes] = useState<ReadonlySet<string>>(new Set());
  const [expandedArcs, setExpandedArcs] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<{ kind: DraftKind; parentId: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const toggle = useCallback(
    (set: ReadonlySet<string>, id: string) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-36" />
      </div>
    );
  }

  /*
   * One return, with the empty state folded into it, because the create and delete
   * dialogs must render on every branch. An early return for the empty tree put the
   * dialogs out of reach of the only button that could open them: on a fresh
   * database, Add volume set state that nothing displayed. The tree looked fine with
   * chapters in it and silently did nothing with none.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tree.volumes.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={<BookOpen size={22} />}
            title="No outline yet"
            body="A volume holds arcs, an arc holds chapters. Start with the volume your first arc lives in."
            action={
              <Button size="sm" onClick={() => setDraft({ kind: 'volume', parentId: null })}>
                <Plus size={14} weight="bold" />
                Add volume
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="px-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Outline
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDraft({ kind: 'volume', parentId: null })}
        >
          <Plus size={14} weight="bold" />
          Volume
        </Button>
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {tree.volumes.map((volume) => {
          const isVolumeOpen = expandedVolumes.has(volume.id);
          const chapterTotal = volume.arcs.reduce((sum, arc) => sum + arc.chapters.length, 0);

          return (
            <li key={volume.id}>
              <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-surface-sunken">
                <button
                  type="button"
                  onClick={() => setExpandedVolumes(toggle(expandedVolumes, volume.id))}
                  aria-expanded={isVolumeOpen}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left"
                >
                  <CaretRight
                    size={13}
                    weight="bold"
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-ink-muted transition-transform',
                      isVolumeOpen && 'rotate-90',
                    )}
                  />
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {volume.title}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                    {chapterTotal}
                  </span>
                </button>

                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Add arc to ${volume.title}`}
                    title="Add arc"
                    onClick={() => setDraft({ kind: 'arc', parentId: volume.id })}
                  >
                    <Plus size={13} weight="bold" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${volume.title}`}
                    title="Delete volume"
                    onClick={() =>
                      setPendingDelete({ kind: 'volume', id: volume.id, title: volume.title })
                    }
                  >
                    <Trash size={13} />
                  </Button>
                </span>
              </div>

              {isVolumeOpen && (
                <ul className="ml-3.5 space-y-0.5 border-l border-line pl-1.5">
                  {volume.arcs.length === 0 && (
                    <li className="px-2.5 py-1.5 text-[13px] text-ink-muted">
                      No arcs yet
                    </li>
                  )}

                  {volume.arcs.map((arc) => {
                    const isArcOpen = expandedArcs.has(arc.id);

                    return (
                      <li key={arc.id}>
                        <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-surface-sunken">
                          <button
                            type="button"
                            onClick={() => setExpandedArcs(toggle(expandedArcs, arc.id))}
                            aria-expanded={isArcOpen}
                            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left"
                          >
                            <CaretRight
                              size={12}
                              weight="bold"
                              aria-hidden="true"
                              className={cn(
                                'shrink-0 text-ink-muted transition-transform',
                                isArcOpen && 'rotate-90',
                              )}
                            />
                            <span className="truncate text-[13px] text-ink-soft">{arc.title}</span>
                            <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                              {arc.chapters.length}
                            </span>
                          </button>

                          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Add chapter to ${arc.title}`}
                              title="Add chapter"
                              onClick={() => void addChapter(arc.id)}
                            >
                              <Plus size={13} weight="bold" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Delete ${arc.title}`}
                              title="Delete arc"
                              onClick={() =>
                                setPendingDelete({ kind: 'arc', id: arc.id, title: arc.title })
                              }
                            >
                              <Trash size={13} />
                            </Button>
                          </span>
                        </div>

                        {isArcOpen && (
                          <ul className="ml-3.5 space-y-0.5 border-l border-line pl-1.5">
                            {arc.chapters.length === 0 && (
                              <li className="px-2 py-1.5 text-[13px] text-ink-muted">
                                No chapters yet
                              </li>
                            )}

                            {arc.chapters.map((chapter) => {
                              const isSelected = chapter.id === selectedChapterId;
                              return (
                                <li
                                  key={chapter.id}
                                  className="group flex items-center rounded-md pr-1 hover:bg-surface-sunken"
                                >
                                  <button
                                    type="button"
                                    onClick={() => onSelectChapter(chapter.id)}
                                    aria-current={isSelected ? 'true' : undefined}
                                    className={cn(
                                      'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                                      isSelected
                                        ? 'bg-accent-soft text-accent'
                                        : 'text-ink-soft hover:bg-surface-sunken',
                                    )}
                                  >
                                    <span className="truncate font-serif text-[13px]">
                                      {chapter.title}
                                    </span>
                                    <span
                                      className={cn(
                                        'ml-auto shrink-0 rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide',
                                        STATUS_STYLES[chapter.status],
                                      )}
                                    >
                                      {chapter.status}
                                    </span>
                                    {chapter.type !== 'chapter' && (
                                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">
                                        {typeLabel(chapter.type)}
                                      </span>
                                    )}
                                  </button>

                                  {/*
                                    A chapter is where the prose and every fact sourced
                                    from it live, so this is the delete that most needs its
                                    confirmation dialog.
                                  */}
                                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      aria-label={`Delete ${chapter.title}`}
                                      title="Delete chapter"
                                      onClick={() =>
                                        setPendingDelete({
                                          kind: 'chapter',
                                          id: chapter.id,
                                          title: chapter.title,
                                        })
                                      }
                                    >
                                      <Trash size={13} />
                                    </Button>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
        </>
      )}

      {draft !== null && (
        <NameNodeDialog
          kind={draft.kind}
          isSaving={pendingKey !== null}
          onClose={() => setDraft(null)}
          onSubmit={async (input) => {
            if (draft.kind === 'volume') {
              const created = await createVolume(input);
              // Open the new volume so the arc button is one click away rather than
              // three.
              setExpandedVolumes(toggle(expandedVolumes, created.id));
            } else if (draft.parentId !== null) {
              const created = await createArc({ volumeId: draft.parentId, ...input });
              setExpandedArcs(toggle(expandedArcs, created.id));
            }
            setDraft(null);
          }}
        />
      )}

      {pendingDelete !== null && (
        <DeleteNodeDialog
          pending={pendingDelete}
          isDeleting={pendingKey !== null}
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            await removeNode({ kind: pendingDelete.kind, id: pendingDelete.id });
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );

  /**
   * Chapters get a one-tap path rather than a dialog: they are created constantly
   * while outlining, and a named placeholder title can be renamed in the editor a
   * moment later.
   */
  async function addChapter(arcId: string): Promise<void> {
    const created = await createChapter({ arcId, title: 'Untitled chapter' });
    setExpandedArcs(toggle(expandedArcs, arcId));
    onSelectChapter(created.id);
  }
}

interface NameNodeDialogProps {
  kind: DraftKind;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; summary: string }) => Promise<void>;
}

function NameNodeDialog({ kind, isSaving, onClose, onSubmit }: NameNodeDialogProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isVolume = kind === 'volume';

  const onFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0 || isSaving) {
      return;
    }
    setErrorMessage(null);
    try {
      await onSubmit({ title: title.trim(), summary });
    } catch (err) {
      setErrorMessage(describeError(err));
    }
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={isVolume ? 'New volume' : 'New arc'}
      description={
        isVolume
          ? 'A volume is one book-length stretch of the story. Arcs live inside it.'
          : 'An arc is a run of chapters that moves one strand of the story forward.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="outline-node-form" disabled={title.trim().length === 0}>
            {isSaving ? 'Adding...' : `Add ${kind}`}
          </Button>
        </>
      }
    >
      <form id="outline-node-form" onSubmit={onFormSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="outline-node-title">Title</Label>
          <Input
            id="outline-node-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={isVolume ? 'The Ashen Crown' : 'The Cinders'}
            autoFocus
            autoComplete="off"
            isInvalid={errorMessage !== null}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="outline-node-summary" hint="optional">
            Summary
          </Label>
          <Textarea
            id="outline-node-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder="What this stretch of the story is for."
          />
        </div>

        {errorMessage !== null && <InlineError message={errorMessage} />}

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1}>
          <Plus size={1} />
        </button>
      </form>
    </Dialog>
  );
}

interface DeleteNodeDialogProps {
  pending: PendingDelete;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Asks the database what the cascade would take before offering the button.
 *
 * A volume can be holding dozens of chapters and the facts sourced from them. The
 * numbers are read fresh rather than taken from the tree, so what is confirmed is
 * what happens.
 */
function DeleteNodeDialog({ pending, isDeleting, onClose, onConfirm }: DeleteNodeDialogProps) {
  const [impact, setImpact] = useState<OutlineDeletionImpact | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (bridge === null) {
      return;
    }
    let isCurrent = true;
    void bridge.outline
      .describeDeletion({ kind: pending.kind, id: pending.id })
      .then((result) => {
        if (isCurrent) setImpact(result);
      })
      .catch((err: unknown) => {
        if (isCurrent) setErrorMessage(describeError(err));
      });
    // The dialog is destroyed on close, and a late answer for a node the author has
    // already moved on from must not be applied to the next one.
    return () => {
      isCurrent = false;
    };
  }, [pending.kind, pending.id]);

  const noun = pending.kind === 'volume' ? 'volume' : pending.kind === 'arc' ? 'arc' : 'chapter';

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Delete ${noun} "${pending.title}"?`}
      description="This cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isDeleting}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => void onConfirm()}
            disabled={isDeleting || impact === null}
          >
            {isDeleting ? 'Deleting...' : `Delete ${noun}`}
          </Button>
        </>
      }
    >
      {errorMessage !== null && <InlineError message={errorMessage} />}

      {impact === null && errorMessage === null && (
        <p className="text-[13px] text-ink-muted">Checking what this would remove...</p>
      )}

      {impact !== null && (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Deleting this {noun} also deletes everything under it.
          </p>
          <ul className="space-y-1.5 text-[13px] text-ink-soft">
            <li>
              <strong className="font-mono tabular-nums text-danger">{impact.childCount}</strong>{' '}
              {impact.childCount === 1 ? 'child' : 'children'} directly beneath it
            </li>
            <li>
              <strong className="font-mono tabular-nums text-danger">{impact.factCount}</strong>{' '}
              {impact.factCount === 1 ? 'fact' : 'facts'} sourced from those chapters
            </li>
            <li>
              <strong className="font-mono tabular-nums text-danger">
                {impact.wordCount.toLocaleString()}
              </strong>{' '}
              words of prose
            </li>
            {impact.illustrationCount > 0 && (
              <li>
                <strong className="font-mono tabular-nums text-danger">
                  {impact.illustrationCount}
                </strong>{' '}
                {impact.illustrationCount === 1 ? 'illustration' : 'illustrations'}
              </li>
            )}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5"
    >
      <WarningCircle
        size={15}
        weight="bold"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-danger"
      />
      <p className="text-[13px] leading-relaxed text-danger">{message}</p>
    </div>
  );
}
