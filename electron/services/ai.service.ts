import { z } from 'zod';
import { RuleViolationError } from '../lib/errors.js';
import type { FactKind } from '../ipc/contract.js';
import type { ChapterRepository } from '../repositories/chapter.repository.js';
import type { GlossaryRepository } from '../repositories/glossary.repository.js';
import type { AiProvider } from '../interfaces/ai-provider.interface.js';
import type { AiKeyStore } from './ai-key.service.js';

/**
 * The AI layer's rules.
 *
 * Three things define it, and none of them are negotiable:
 *
 *   1. **Proposal only.** A suggestion carries a character span; the author applies it
 *      or does not. Nothing here returns prose to paste, and nothing writes to
 *      `body_md`.
 *   2. **Attribution.** A proposed fact must quote the chapter word for word. The model
 *      is not trusted to do that, so the quote is checked against the text and dropped
 *      if it is not there.
 *   3. **One chapter at a time.** The model sees a chapter and the glossary. It never
 *      sees the whole manuscript, so it cannot invent a memory of it.
 *
 * The glossary goes in as a never-touch list: invented names are the exact thing a
 * general model wants to "correct".
 */

export type SuggestionKind = 'grammar' | 'spelling' | 'style' | 'clarity' | 'tense' | 'pov';

export interface AiSuggestion {
  start: number;
  end: number;
  original: string;
  suggestion: string;
  kind: SuggestionKind;
  message: string;
}

export interface AiFactProposal {
  kind: FactKind;
  content: string;
  sourceQuote: string;
}

export interface AiService {
  status(): Promise<{ isConfigured: boolean; isEncryptionAvailable: boolean }>;
  setKey(apiKey: string): Promise<void>;
  clearKey(): Promise<void>;
  checkChapter(input: { chapterId: string }): Promise<{ suggestions: AiSuggestion[] }>;
  proposeFacts(input: { chapterId: string }): Promise<{ proposals: AiFactProposal[] }>;
}

const MAX_SUGGESTIONS = 50;
const MAX_PROPOSALS = 25;

const SUGGESTION_KINDS: SuggestionKind[] = [
  'grammar',
  'spelling',
  'style',
  'clarity',
  'tense',
  'pov',
];

const FACT_KINDS: FactKind[] = [
  'event',
  'character_fact',
  'new_entity',
  'relation_shift',
  'open_promise',
  'unresolved',
];

const responseSchema = z.object({
  suggestions: z.array(
    z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      original: z.string(),
      suggestion: z.string(),
      kind: z.string(),
      message: z.string(),
    }),
  ),
});

const proposalSchema = z.object({
  facts: z.array(
    z.object({
      kind: z.string(),
      content: z.string(),
      sourceQuote: z.string(),
    }),
  ),
});

const CHECK_SYSTEM = `You are a line editor for a fantasy light novel. You do not rewrite prose.

Return JSON only, with this shape:
{"suggestions":[{"start":<character index>,"end":<character index>,"original":"<exact text>","suggestion":"<replacement text>","kind":"grammar|spelling|style|clarity|tense|pov","message":"<one short sentence>"}]}

Rules:
- "original" must be an exact substring of the chapter, and start/end must be the
  character offsets of that substring. The app rejects anything that does not match.
- Suggest the smallest change that fixes the problem. Never restyle a sentence.
- Do not flag the glossary terms listed by the user, or any proper noun.
- Do not suggest changes to punctuation style that is consistent.
- Report at most 50 problems, most important first. If the prose is fine, return
  {"suggestions":[]}.`;

const FACTS_SYSTEM = `You extract continuity facts from a chapter of a fantasy light novel.

Return JSON only, with this shape:
{"facts":[{"kind":"event|character_fact|new_entity|relation_shift|open_promise|unresolved","content":"<one sentence, what is now true>","sourceQuote":"<exact sentence from the chapter>"}]}

Rules:
- "sourceQuote" must be copied word for word from the chapter. The app verifies it and
  rejects the fact if it is not present.
- content states what changed or what is now established; it is not a summary.
- open_promise is for a hook the reader now expects: a threat, a vow, a mystery.
- Do not invent anything that is not in the text. Return at most 25 facts.`;

/**
 * @param deps - Chapter and glossary access, the key store, and a provider factory.
 */
export function createAiService(deps: {
  chapters: ChapterRepository;
  glossary: GlossaryRepository;
  keys: AiKeyStore;
  makeProvider: (apiKey: string) => AiProvider;
  /** Resolve which work a chapter belongs to, for the glossary list. */
  resolveProjectId?: (chapter: { arcId: string }) => Promise<string | null>;
}): AiService {
  async function providerFor(): Promise<AiProvider> {
    const key = await deps.keys.get();
    if (key === null) {
      throw new RuleViolationError(
        'No DeepSeek key is stored yet. Open AI settings and paste one.',
      );
    }
    return deps.makeProvider(key);
  }

  async function chapterFor(chapterId: string) {
    const chapter = await deps.chapters.findById(chapterId);
    if (chapter === null) {
      throw new RuleViolationError('That chapter no longer exists.');
    }
    return chapter;
  }

  /**
   * The never-touch list.
   *
   * A general model wants to "correct" invented names; naming them explicitly is the
   * difference between useful suggestions and a chapter full of flagged proper nouns.
   * When the work cannot be resolved, the list is simply absent.
   */
  async function glossaryList(chapter: { arcId: string }): Promise<string> {
    if (deps.resolveProjectId === undefined) {
      return '(none)';
    }
    const projectId = await deps.resolveProjectId(chapter);
    if (projectId === null) {
      return '(none)';
    }
    const terms = await deps.glossary.list(projectId);
    return terms.length === 0
      ? '(none)'
      : terms.map((term) => term.canonicalForm).join(', ');
  }

  return {
    status: () => deps.keys.status(),
    setKey: (apiKey) => deps.keys.set(apiKey),
    clearKey: () => deps.keys.clear(),

    async checkChapter(input) {
      const chapter = await chapterFor(input.chapterId);
      const provider = await providerFor();
      const glossaryText = await glossaryList(chapter);

      const raw = await provider.complete({
        system: CHECK_SYSTEM,
        user: `Glossary terms to leave untouched:\n${glossaryText}\n\nChapter:\n${chapter.bodyMd}`,
        json: true,
      });

      const parsed = responseSchema.safeParse(parseJson(raw));
      if (!parsed.success) {
        throw new RuleViolationError(
          'The model returned something that is not a list of suggestions. Nothing was changed.',
        );
      }

      const suggestions: AiSuggestion[] = [];
      for (const candidate of parsed.data.suggestions) {
        if (
          candidate.start >= candidate.end ||
          candidate.end > chapter.bodyMd.length ||
          chapter.bodyMd.slice(candidate.start, candidate.end) !== candidate.original ||
          candidate.suggestion === candidate.original ||
          !SUGGESTION_KINDS.includes(candidate.kind as SuggestionKind)
        ) {
          continue;
        }
        suggestions.push({
          start: candidate.start,
          end: candidate.end,
          original: candidate.original,
          suggestion: candidate.suggestion,
          kind: candidate.kind as SuggestionKind,
          message: candidate.message,
        });
      }

      suggestions.sort((a, b) => a.start - b.start);
      return { suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
    },

    async proposeFacts(input) {
      const chapter = await chapterFor(input.chapterId);
      const provider = await providerFor();

      const raw = await provider.complete({
        system: FACTS_SYSTEM,
        user: `Chapter:\n${chapter.bodyMd}`,
        json: true,
      });

      const parsed = proposalSchema.safeParse(parseJson(raw));
      if (!parsed.success) {
        throw new RuleViolationError(
          'The model returned something that is not a list of facts. Nothing was saved.',
        );
      }

      const normalizedBody = normalizeWhitespace(chapter.bodyMd);
      const proposals: AiFactProposal[] = [];
      for (const candidate of parsed.data.facts) {
        if (!FACT_KINDS.includes(candidate.kind as FactKind)) {
          continue;
        }
        const quote = candidate.sourceQuote.trim();
        if (
          quote.length === 0 ||
          candidate.content.trim().length === 0 ||
          !normalizedBody.includes(normalizeWhitespace(quote))
        ) {
          // No verified quote, no fact. This is the same rule the database enforces.
          continue;
        }
        proposals.push({
          kind: candidate.kind as FactKind,
          content: candidate.content.trim(),
          sourceQuote: quote,
        });
      }

      return { proposals: proposals.slice(0, MAX_PROPOSALS) };
    },
  };
}

/**
 * Parses the provider's text as JSON.
 *
 * Models occasionally wrap JSON in a fenced code block even when asked not to; that is
 * a formatting quirk, not a reason to make the author retry.
 */
function parseJson(raw: string): unknown {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    throw new RuleViolationError(
      'The model answered with text instead of JSON. Nothing was changed.',
    );
  }
}

/** Collapses runs of whitespace so a quote survives line wrapping. */
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
