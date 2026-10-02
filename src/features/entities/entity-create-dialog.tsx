import { Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { describeError } from '../../lib/bridge';
import type { EntityType } from '../../lib/bridge';
import { TYPE_PLURALS } from './entity-type';

export interface EntityCreateDialogProps {
  type: EntityType;
  onClose: () => void;
  onSubmit: (input: { canonicalName: string; aliases: string[] }) => Promise<void>;
}

/**
 * Create-entity form.
 *
 * Mounted only while open, so its fields start empty every time without an effect
 * that clears them. Remounting is the honest way to express "a new form", and it
 * removes the whole class of bug where a previous failed attempt leaks into the
 * next one.
 *
 * Aliases are collected as one comma-separated field rather than a chip editor.
 * A single field is entered once and read once, which is what the author is
 * actually doing; a chip editor is a better fit for a tag that is re-arranged
 * repeatedly, and this is not that.
 */
export function EntityCreateDialog({
  type,
  onClose,
  onSubmit,
}: EntityCreateDialogProps) {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isSaving;

  const onFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    const aliasList = aliases
      .split(',')
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onSubmit({ canonicalName: trimmedName, aliases: aliasList });
      onClose();
    } catch (err) {
      // Shown verbatim: the service explains which alias collided and with whom,
      // which is the only information that makes the fix obvious.
      setErrorMessage(describeError(err));
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`New ${type}`}
      description={`Add a ${type} to ${TYPE_PLURALS[type].toLowerCase()}. You can fill in the details afterwards.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="entity-create-form" disabled={!canSubmit}>
            {isSaving ? 'Adding...' : `Add ${type}`}
          </Button>
        </>
      }
    >
      <form id="entity-create-form" onSubmit={onFormSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="entity-name">
            Name
            <span className="text-danger"> *</span>
          </Label>
          <Input
            id="entity-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kael"
            autoFocus
            autoComplete="off"
            isInvalid={errorMessage !== null}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="entity-aliases" hint="optional">
            Aliases
          </Label>
          <Input
            id="entity-aliases"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            placeholder="The Ash Blade, Heir of Cinder"
            autoComplete="off"
            isInvalid={errorMessage !== null}
          />
          <p className="text-xs leading-relaxed text-ink-muted">
            Separate with commas. Other names the book uses for this {type}.
          </p>
        </div>

        {errorMessage !== null && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5"
          >
            <X
              size={15}
              weight="bold"
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-danger"
            />
            <p className="text-[13px] leading-relaxed text-danger">{errorMessage}</p>
          </div>
        )}

        {/*
          The footer button lives in the dialog chrome, so it needs a real submit
          target. Submitting from here also keeps Enter working inside the inputs,
          which a footer-only button would break.
        */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1}>
          <Plus size={1} />
        </button>
      </form>
    </Dialog>
  );
}