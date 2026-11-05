import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import type {
  CreateRelationInput,
  Entity,
  RelationCategory,
} from '../../lib/bridge';
import {
  RELATION_CATEGORY_HINTS,
  RELATION_CATEGORY_LABELS,
  RELATION_CATEGORY_ORDER,
} from './relation-labels';

export interface RelationCreateDialogProps {
  isOpen: boolean;
  projectId: string;
  entities: Entity[];
  chapters: { id: string; title: string }[];
  onClose: () => void;
  onSubmit: (input: CreateRelationInput) => Promise<void>;
}

/**
 * Recording a relation.
 *
 * The form changes shape with the category rather than showing every column and
 * disabling half of it: sentiment is a property of a social relation, rank only exists
 * inside a faction, and a form that offers them elsewhere teaches the author to ignore
 * fields that do nothing.
 */
export function RelationCreateDialog({
  isOpen,
  projectId,
  entities,
  chapters,
  onClose,
  onSubmit,
}: RelationCreateDialogProps) {
  const [category, setCategory] = useState<RelationCategory>('social');
  const [fromEntityId, setFromEntityId] = useState('');
  const [toEntityId, setToEntityId] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [sentiment, setSentiment] = useState(0);
  const [rank, setRank] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [notes, setNotes] = useState('');
  const [knownBy, setKnownBy] = useState<string[]>([]);
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSelfRelation = fromEntityId !== '' && fromEntityId === toEntityId;
  const canSubmit =
    fromEntityId !== '' &&
    toEntityId !== '' &&
    !isSelfRelation &&
    typeLabel.trim().length > 0 &&
    !isSubmitting;

  function reset(): void {
    setCategory('social');
    setFromEntityId('');
    setToEntityId('');
    setTypeLabel('');
    setSentiment(0);
    setRank('');
    setIsSecret(false);
    setNotes('');
    setKnownBy([]);
    setValidFrom('');
    setValidTo('');
    setErrorMessage(null);
  }

  function close(): void {
    reset();
    onClose();
  }

  async function submit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSubmit({
        projectId,
        fromEntityId,
        toEntityId,
        category,
        typeLabel: typeLabel.trim(),
        sentiment: category === 'social' ? sentiment : null,
        rank: category === 'membership' && rank.trim().length > 0 ? rank.trim() : null,
        validFromChapterId: validFrom === '' ? null : validFrom,
        validToChapterId: validTo === '' ? null : validTo,
        isSecret,
        notes,
        knownByEntityIds: knownBy,
      });
      reset();
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'The relation was not saved.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="New relation"
      description="How two things in the story stand to each other, and who knows it."
      className="w-[min(640px,calc(100vw-48px))]"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {isSubmitting ? 'Saving…' : 'Add relation'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="relation-from">From</Label>
            <select
              id="relation-from"
              value={fromEntityId}
              onChange={(event) => setFromEntityId(event.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value="">Choose…</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.canonicalName} ({entity.type})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-to">To</Label>
            <select
              id="relation-to"
              value={toEntityId}
              onChange={(event) => setToEntityId(event.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value="">Choose…</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.canonicalName} ({entity.type})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="relation-category">Category</Label>
            <select
              id="relation-category"
              value={category}
              onChange={(event) => {
                const next = event.target.value as RelationCategory;
                setCategory(next);
                if (next !== 'social') setSentiment(0);
                if (next !== 'membership') setRank('');
              }}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              {RELATION_CATEGORY_ORDER.map((value) => (
                <option key={value} value={value}>
                  {RELATION_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
            <p className="text-[11.5px] leading-relaxed text-ink-muted">
              {RELATION_CATEGORY_HINTS[category]}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-label">Label</Label>
            <Input
              id="relation-label"
              value={typeLabel}
              onChange={(event) => setTypeLabel(event.target.value)}
              placeholder={category === 'membership' ? 'Sworn to' : 'Sister'}
            />
          </div>
        </div>

        {category === 'social' && (
          <div className="space-y-1.5">
            <Label htmlFor="relation-sentiment">Sentiment</Label>
            <div className="flex items-center gap-3">
              <input
                id="relation-sentiment"
                type="range"
                min={-5}
                max={5}
                step={1}
                value={sentiment}
                onChange={(event) => setSentiment(Number(event.target.value))}
                className="flex-1 accent-[var(--color-accent)]"
              />
              <span className="w-24 text-right font-mono text-[12px] text-ink-soft">
                {sentiment > 0 ? `+${sentiment}` : sentiment}
              </span>
            </div>
          </div>
        )}

        {category === 'membership' && (
          <div className="space-y-1.5">
            <Label htmlFor="relation-rank" hint="optional">
              Rank
            </Label>
            <Input
              id="relation-rank"
              value={rank}
              onChange={(event) => setRank(event.target.value)}
              placeholder="Captain"
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="relation-valid-from" hint="optional">
              True from chapter
            </Label>
            <select
              id="relation-valid-from"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value="">From the beginning</option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-valid-to" hint="optional">
              True until chapter
            </Label>
            <select
              id="relation-valid-to"
              value={validTo}
              onChange={(event) => setValidTo(event.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value="">Still true</option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="relation-known-by" hint="who has been told">
            Known by
          </Label>
          <select
            id="relation-known-by"
            multiple
            size={Math.min(Math.max(entities.length, 2), 5)}
            value={knownBy}
            onChange={(event) =>
              setKnownBy(Array.from(event.target.selectedOptions, (option) => option.value))
            }
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink"
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.canonicalName}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="relation-notes" hint="optional">
            Notes
          </Label>
          <Textarea
            id="relation-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What the reader should notice later."
          />
        </div>

        <label className="flex items-center gap-2 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={isSecret}
            onChange={(event) => setIsSecret(event.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          This relation is a secret in the story
        </label>

        {isSelfRelation && (
          <p role="alert" className="text-[12.5px] text-danger">
            An entity cannot have a relation with itself.
          </p>
        )}
        {errorMessage !== null && (
          <p role="alert" className="text-[12.5px] text-danger">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}
