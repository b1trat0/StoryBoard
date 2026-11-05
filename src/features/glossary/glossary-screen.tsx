import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import type { GlossaryKind, GlossaryTerm } from '../../lib/bridge';
import { useGlossary } from './use-glossary';

export interface GlossaryScreenProps {
  projectId: string | null;
}

const KIND_LABELS: Record<GlossaryKind, string> = {
  name: 'Names',
  term: 'Terms',
  honorific: 'Honorifics',
  style: 'Styles',
};

const KIND_HINTS: Record<GlossaryKind, string> = {
  name: 'People, places, factions, items. Anything a spell-checker would underline.',
  term: 'Invented magic, technology and world vocabulary.',
  honorific: 'Titles and forms of address, with their exact spelling.',
  style: 'Formatting conventions the book keeps, such as how thoughts are set.',
};

const KIND_ORDER: GlossaryKind[] = ['name', 'term', 'honorific', 'style'];

/**
 * The glossary screen.
 *
 * Adding a term is an upsert: the same canonical form updates its notes rather than
 * creating a second entry, because two spellings of one invented word is exactly the
 * drift this table exists to prevent.
 */
export function GlossaryScreen({ projectId }: GlossaryScreenProps) {
  const glossary = useGlossary(projectId);
  const [canonicalForm, setCanonicalForm] = useState('');
  const [kind, setKind] = useState<GlossaryKind>('name');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function addTerm(): Promise<void> {
    const trimmed = canonicalForm.trim();
    if (trimmed.length === 0) {
      return;
    }
    setIsSaving(true);
    try {
      await glossary.save({ canonicalForm: trimmed, kind, notes: notes.trim() });
      setCanonicalForm('');
      setNotes('');
      toast.success(`${trimmed} added to the glossary`);
    } catch (err) {
      toast.error('Could not save the term', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }

  const grouped = new Map<GlossaryKind, GlossaryTerm[]>();
  for (const value of KIND_ORDER) {
    grouped.set(value, []);
  }
  for (const term of glossary.terms) {
    grouped.get(term.kind)?.push(term);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-line bg-surface px-6 py-3">
        <h1 className="font-serif text-[15px] font-semibold text-ink">Glossary</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          The book's invented vocabulary. Later this is the list the English checker is
          told never to touch.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto w-full max-w-3xl space-y-7">
          <section className="rounded-md border border-line bg-surface-sunken/50 px-3.5 py-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              Add a term
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
              <div className="space-y-1">
                <Label htmlFor="glossary-form">Canonical form</Label>
                <Input
                  id="glossary-form"
                  value={canonicalForm}
                  onChange={(event) => setCanonicalForm(event.target.value)}
                  placeholder="Kaelith"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addTerm();
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="glossary-kind">Kind</Label>
                <select
                  id="glossary-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as GlossaryKind)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
                >
                  {KIND_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {KIND_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-2 space-y-1">
              <Label htmlFor="glossary-notes" hint="optional">
                Notes
              </Label>
              <Textarea
                id="glossary-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Never written with an accent. Always two words."
                className="text-[13px]"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                onClick={() => void addTerm()}
                disabled={isSaving || canonicalForm.trim().length === 0}
              >
                {isSaving ? 'Saving…' : 'Add term'}
              </Button>
            </div>
          </section>

          {glossary.errorMessage !== null && (
            <div
              role="alert"
              className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            >
              {glossary.errorMessage}
            </div>
          )}

          {glossary.isLoading ? (
            <p className="text-[13px] text-ink-muted">Loading glossary…</p>
          ) : glossary.terms.length === 0 ? (
            <EmptyState
              title="Nothing pinned yet"
              body="Add every invented name and word. This is what stops a spell-checker from correcting your world into someone else's."
            />
          ) : (
            KIND_ORDER.map((value) => {
              const terms = grouped.get(value) ?? [];
              if (terms.length === 0) {
                return null;
              }
              return (
                <section key={value} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                      {KIND_LABELS[value]}
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                      {terms.length}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-muted">
                    {KIND_HINTS[value]}
                  </p>
                  <ul className="space-y-2">
                    {terms.map((term) => (
                      <TermRow key={term.id} term={term} onSave={glossary.save} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface TermRowProps {
  term: GlossaryTerm;
  onSave: (input: {
    canonicalForm: string;
    kind: GlossaryKind;
    notes: string;
  }) => Promise<GlossaryTerm>;
}

/**
 * One term, with notes that save on blur.
 *
 * Saving on blur keeps the canonical form and its notes together without a second
 * button per row, and it cannot rename the term: the upsert is keyed on the canonical
 * form, which is the identity every fact and chapter already refers to.
 */
function TermRow({ term, onSave }: TermRowProps) {
  const [notes, setNotes] = useState(term.notes);
  const [isSaving, setIsSaving] = useState(false);

  async function commit(): Promise<void> {
    if (notes === term.notes) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ canonicalForm: term.canonicalForm, kind: term.kind, notes });
    } catch (err) {
      toast.error('Could not save the note', {
        description: err instanceof Error ? err.message : undefined,
      });
      setNotes(term.notes);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[14px] text-ink">{term.canonicalForm}</span>
        {isSaving && (
          <span className="text-[11px] text-ink-muted">saving…</span>
        )}
      </div>
      <Textarea
        aria-label={`Notes for ${term.canonicalForm}`}
        rows={1}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => void commit()}
        placeholder="Add a note"
        className="mt-1.5 min-h-8 text-[12.5px]"
      />
    </li>
  );
}
