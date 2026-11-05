import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { getBridge } from '../../lib/bridge';
import type { AiFactProposal, AiSuggestion } from '../../lib/bridge';

export interface AssistDialogProps {
  chapterId: string;
  projectId: string | null;
  bodyMd: string;
  onApplySuggestion: (suggestion: AiSuggestion) => void;
  onClose: () => void;
}

/**
 * AI assist, on demand.
 *
 * The chapter is sent to DeepSeek only when a button here is pressed; nothing runs
 * automatically on save or on open. Suggestions are applied one at a time by the
 * author, and proposed facts are created as drafts — the same state a fact typed by
 * hand starts in.
 */
export function AssistDialog({
  chapterId,
  projectId,
  bodyMd,
  onApplySuggestion,
  onClose,
}: AssistDialogProps) {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [isEncryptionAvailable, setIsEncryptionAvailable] = useState(true);
  const [keyDraft, setKeyDraft] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null);
  const [proposals, setProposals] = useState<AiFactProposal[] | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const bridge = getBridge();

  useEffect(() => {
    if (bridge === null) {
      return;
    }
    void bridge.ai
      .status({})
      .then((status) => {
        setIsConfigured(status.isConfigured);
        setIsEncryptionAvailable(status.isEncryptionAvailable);
      })
      .catch(() => setIsConfigured(false));
  }, [bridge]);

  async function run(kind: 'check' | 'facts'): Promise<void> {
    if (bridge === null) {
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);
    try {
      if (kind === 'check') {
        const result = await bridge.ai.checkChapter({ chapterId });
        setSuggestions(result.suggestions);
        if (result.suggestions.length === 0) {
          setErrorMessage('No problems found in this chapter.');
        }
      } else {
        const result = await bridge.ai.proposeFacts({ chapterId });
        setProposals(result.proposals);
        if (result.proposals.length === 0) {
          setErrorMessage('No verifiable facts found in this chapter.');
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'The request failed.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Writing assist"
      description="Read-only analysis of this chapter. Nothing is applied or saved without you."
      className="w-[min(680px,calc(100vw-48px))]"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            DeepSeek key
          </h3>
          {!isEncryptionAvailable ? (
            <p role="alert" className="text-[12.5px] text-danger">
              This machine cannot encrypt a key, so nothing can be stored. AI features
              stay off.
            </p>
          ) : isConfigured === true ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[12.5px] text-ink-soft">
                A key is stored, encrypted by the operating system.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void bridge?.ai.clearKey({}).then(() => {
                    setIsConfigured(false);
                    setSuggestions(null);
                    setProposals(null);
                  });
                }}
              >
                Remove key
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="ai-key">API key</Label>
                <Input
                  id="ai-key"
                  type="password"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </div>
              <Button
                size="sm"
                disabled={keyDraft.trim().length === 0}
                onClick={() => {
                  setIsBusy(true);
                  setErrorMessage(null);
                  void bridge?.ai
                    .setKey({ apiKey: keyDraft.trim() })
                    .then(() => {
                      setIsConfigured(true);
                      setKeyDraft('');
                    })
                    .catch((err: unknown) =>
                      setErrorMessage(
                        err instanceof Error ? err.message : 'The key was not stored.',
                      ),
                    )
                    .finally(() => setIsBusy(false));
                }}
              >
                Save key
              </Button>
            </div>
          )}
        </section>

        <section className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={isConfigured !== true || isBusy}
            onClick={() => void run('check')}
          >
            {isBusy ? 'Working…' : 'Check English'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={isConfigured !== true || isBusy}
            onClick={() => void run('facts')}
          >
            Propose facts
          </Button>
          <span className="self-center text-[11.5px] text-ink-muted">
            {bodyMd.trim().length} characters sent for this one request.
          </span>
        </section>

        {errorMessage !== null && (
          <p role="alert" className="text-[12.5px] text-danger">
            {errorMessage}
          </p>
        )}

        {suggestions !== null && suggestions.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              Suggestions ({suggestions.length})
            </h3>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <li
                  key={`${suggestion.start}-${suggestion.end}-${suggestion.original}`}
                  className="rounded-md border border-line bg-surface px-3 py-2"
                >
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted">
                    {suggestion.kind}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">
                    <span className="line-through decoration-danger/60">
                      {suggestion.original}
                    </span>{' '}
                    → <span className="text-ink">{suggestion.suggestion}</span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <p className="flex-1 text-[11.5px] text-ink-muted">
                      {suggestion.message}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        onApplySuggestion(suggestion);
                        setSuggestions(
                          (current) =>
                            current?.filter((item) => item !== suggestion) ?? null,
                        );
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {proposals !== null && proposals.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              Proposed facts ({proposals.length})
            </h3>
            <p className="text-[11.5px] text-ink-muted">
              Each one quotes the chapter. Accepting creates a draft you still have to
              approve on the chapter's facts list.
            </p>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {proposals.map((proposal) => (
                <li
                  key={`${proposal.kind}-${proposal.sourceQuote}`}
                  className="rounded-md border border-line bg-surface px-3 py-2"
                >
                  <p className="text-[12.5px] text-ink">{proposal.content}</p>
                  <p className="mt-0.5 border-l-2 border-line pl-2 font-serif text-[11.5px] italic text-ink-muted">
                    “{proposal.sourceQuote}”
                  </p>
                  <div className="mt-1.5 flex justify-end">
                    <Button
                      size="sm"
                      disabled={projectId === null}
                      onClick={() => {
                        if (bridge === null || projectId === null) {
                          return;
                        }
                        void bridge.facts
                          .create({
                            projectId,
                            scopeType: 'chapter',
                            scopeId: chapterId,
                            kind: proposal.kind,
                            content: proposal.content,
                            sourceChapterId: chapterId,
                            sourceQuote: proposal.sourceQuote,
                            status: 'draft',
                          })
                          .then(() => {
                            setProposals(
                              (current) =>
                                current?.filter((item) => item !== proposal) ?? null,
                            );
                          })
                          .catch((err: unknown) =>
                            setErrorMessage(
                              err instanceof Error ? err.message : 'The fact was not saved.',
                            ),
                          );
                      }}
                    >
                      Create draft fact
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
