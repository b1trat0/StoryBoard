import { Trash, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { describeError } from '../../lib/bridge';
import type { Entity } from '../../lib/bridge';
import { TypeBadge } from './entity-type';

export interface EntityDetailProps {
  entity: Entity | null;
  isPending: boolean;
  onClose: () => void;
  onSave: (
    id: string,
    patch: Partial<
      Pick<Entity, 'summary' | 'appearance' | 'personality' | 'backstory'>
    >,
  ) => Promise<void>;
  onAddAlias: (id: string, alias: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface DraftFields {
  summary: string;
  appearance: string;
  personality: string;
  backstory: string;
}

/** Seeds the editable draft from a stored entity. */
function draftFrom(entity: Entity | null): DraftFields {
  if (entity === null) {
    return { summary: '', appearance: '', personality: '', backstory: '' };
  }
  return {
    summary: entity.summary,
    appearance: entity.appearance,
    personality: entity.personality,
    backstory: entity.backstory,
  };
}

/**
 * Detail and edit view for one entity.
 *
 * The caller keys this component on the entity id, so selecting a different entry
 * remounts it and the draft is seeded from that entry in the initialiser rather
 * than through an effect. That is what keeps a background refresh from silently
 * discarding half-typed edits, and it removes the stale-deps problem entirely.
 *
 * Fields are the four prose columns the database keeps. They are written on an
 * explicit Save, because autosaving every keystroke would turn a half-typed
 * sentence into canon the app then treats as fact.
 */
export function EntityDetail({
  entity,
  isPending,
  onClose,
  onSave,
  onAddAlias,
  onDelete,
}: EntityDetailProps) {
  const [draft, setDraft] = useState<DraftFields>(() => draftFrom(entity));
  const [aliasDraft, setAliasDraft] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  if (entity === null) {
    return null;
  }

  const isDirty =
    draft.summary !== entity.summary ||
    draft.appearance !== entity.appearance ||
    draft.personality !== entity.personality ||
    draft.backstory !== entity.backstory;

  const onSaveClick = async () => {
    setErrorMessage(null);
    try {
      await onSave(entity.id, draft);
    } catch (err) {
      setErrorMessage(describeError(err));
    }
  };

  const onAddAliasClick = async () => {
    const alias = aliasDraft.trim();
    if (alias.length === 0) {
      return;
    }
    setErrorMessage(null);
    try {
      await onAddAlias(entity.id, alias);
      setAliasDraft('');
    } catch (err) {
      setErrorMessage(describeError(err));
    }
  };

  const onDeleteClick = async () => {
    setErrorMessage(null);
    try {
      await onDelete(entity.id);
      setIsConfirmingDelete(false);
      onClose();
    } catch (err) {
      setErrorMessage(describeError(err));
      setIsConfirmingDelete(false);
    }
  };

  const fields: { key: keyof DraftFields; label: string; hint: string; rows: number }[] = [
    { key: 'summary', label: 'Summary', hint: 'one line, for lists', rows: 2 },
    { key: 'appearance', label: 'Appearance', hint: 'optional', rows: 3 },
    { key: 'personality', label: 'Personality', hint: 'optional', rows: 3 },
    { key: 'backstory', label: 'Backstory', hint: 'optional', rows: 5 },
  ];

  return (
    <aside
      className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface"
      aria-label={`${entity.canonicalName} details`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-semibold leading-snug text-ink">
            {entity.canonicalName}
          </h2>
          <TypeBadge type={entity.type} className="mt-2" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close details"
          className="-mr-1 shrink-0"
        >
          <X size={16} weight="bold" aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {/*
          Aliases are additive by design. Renaming a canonical name breaks every
          fact, relation and chapter pointing at it, so the only safe way to record
          a new name is to add it alongside the existing one.
        */}
        <section className="space-y-2">
          <Label htmlFor="entity-alias-add">Aliases</Label>
          {entity.aliases.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {entity.aliases.map((alias) => (
                <li
                  key={alias}
                  className="rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 font-serif text-[13px] italic text-ink-soft"
                >
                  {alias}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] italic text-ink-muted">
              No aliases recorded yet.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Input
              id="entity-alias-add"
              value={aliasDraft}
              onChange={(event) => setAliasDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onAddAliasClick();
                }
              }}
              placeholder="Add another name"
              autoComplete="off"
              className="h-8 text-[13px]"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onAddAliasClick()}
              disabled={aliasDraft.trim().length === 0 || isPending}
            >
              Add
            </Button>
          </div>
        </section>

        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`entity-${field.key}`} hint={field.hint}>
              {field.label}
            </Label>
            <Textarea
              id={`entity-${field.key}`}
              rows={field.rows}
              value={draft[field.key]}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={
                field.key === 'summary'
                  ? 'What the reader needs to know at a glance'
                  : 'Not written yet'
              }
              disabled={isPending}
            />
          </div>
        ))}

        {errorMessage !== null && (
          <div
            role="alert"
            className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5"
          >
            <p className="text-[13px] leading-relaxed text-danger">{errorMessage}</p>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        <Button
          variant="danger"
          size="sm"
          onClick={() => setIsConfirmingDelete(true)}
          disabled={isPending}
        >
          <Trash size={14} weight="bold" aria-hidden="true" />
          Delete
        </Button>
        <Button onClick={() => void onSaveClick()} disabled={!isDirty || isPending}>
          {isPending ? 'Saving...' : 'Save'}
        </Button>
      </footer>

      <Dialog
        isOpen={isConfirmingDelete}
        onClose={() => setIsConfirmingDelete(false)}
        title={`Delete ${entity.canonicalName}?`}
        description="Facts, relations and chapters that point at this entry will lose their reference. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsConfirmingDelete(false)}>
              Keep
            </Button>
            <Button variant="danger" onClick={() => void onDeleteClick()}>
              <Trash size={14} weight="bold" aria-hidden="true" />
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          If you only want to change the name the book uses, add an alias instead
          of deleting. Renaming in place breaks every fact recorded against it.
        </p>
      </Dialog>
    </aside>
  );
}