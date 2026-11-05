import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import type { FactKind } from '../../lib/bridge';
import { FACT_KIND_LABELS, FACT_KIND_ORDER } from './fact-labels';

export interface FactComposerProps {
  /** Chapters available as a source, oldest first. */
  chapters: { id: string; title: string }[];
  /** When set, the source chapter is fixed and the selector is hidden. */
  fixedChapterId?: string;
  onSubmit: (input: {
    kind: FactKind;
    content: string;
    sourceChapterId: string;
    sourceQuote: string;
  }) => Promise<void>;
}

/**
 * Recording one fact.
 *
 * The source quote is a required field, not an optional note. The database refuses a
 * fact without one, and asking here means the author sees why before the write fails:
 * a fact with no quote cannot be checked against the chapter later, which is the only
 * thing that keeps this tab trustworthy.
 */
export function FactComposer({
  chapters = [],
  fixedChapterId,
  onSubmit,
}: FactComposerProps) {
  const [kind, setKind] = useState<FactKind>('event');
  const [content, setContent] = useState('');
  const [sourceQuote, setSourceQuote] = useState('');
  const [sourceChapterId, setSourceChapterId] = useState(
    fixedChapterId ?? chapters[0]?.id ?? '',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit =
    content.trim().length > 0 &&
    sourceQuote.trim().length > 0 &&
    sourceChapterId.length > 0 &&
    !isSubmitting;

  async function submit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSubmit({
        kind,
        content: content.trim(),
        sourceChapterId,
        sourceQuote: sourceQuote.trim(),
      });
      setContent('');
      setSourceQuote('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'The fact was not saved.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface-sunken/50 px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="fact-kind">Kind</Label>
          <select
            id="fact-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as FactKind)}
            className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
          >
            {FACT_KIND_ORDER.map((value) => (
              <option key={value} value={value}>
                {FACT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {fixedChapterId === undefined && (
          <div className="space-y-1">
            <Label htmlFor="fact-source-chapter">Source chapter</Label>
            <select
              id="fact-source-chapter"
              value={sourceChapterId}
              onChange={(event) => setSourceChapterId(event.target.value)}
              className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
            >
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="fact-content">What happened</Label>
        <Textarea
          id="fact-content"
          rows={2}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Kael burns the writ instead of reading it."
          className="text-[13px]"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="fact-quote" hint="word for word, from the chapter">
          Source quote
        </Label>
        <Input
          id="fact-quote"
          value={sourceQuote}
          onChange={(event) => setSourceQuote(event.target.value)}
          placeholder="The writ curled and went to ash in his hand."
          className="h-8 text-[13px]"
        />
      </div>

      {errorMessage !== null && (
        <p role="alert" className="text-[12px] text-danger">
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
          {isSubmitting ? 'Saving…' : 'Add fact'}
        </Button>
      </div>
    </div>
  );
}
