import { describe, expect, it, vi } from 'vitest';
import { createAiService } from '../../electron/services/ai.service.js';
import type { AiProvider } from '../../electron/interfaces/ai-provider.interface.js';
import type { AiKeyStore } from '../../electron/services/ai-key.service.js';
import type { Chapter } from '../../electron/ipc/contract.js';

/**
 * The AI layer's rules.
 *
 * The model is not trusted. Every test here is about what the service refuses: prose
 * that does not match the span, quotes that are not in the chapter, and answers that
 * are not JSON. Those refusals are the difference between an assistant and a second
 * author.
 */

const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';
const ARC_ID = '30000000-0000-4000-8000-000000000001';

const BODY = 'Kael held the writ. The writ curled and went to ash in his hand.';

function chapter(): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: ARC_ID,
    title: 'The Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: BODY,
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 12,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function keyStore(hasKey: boolean): AiKeyStore {
  return {
    status: async () => ({ isConfigured: hasKey, isEncryptionAvailable: true }),
    get: async () => (hasKey ? 'sk-test' : null),
    set: async () => undefined,
    clear: async () => undefined,
  };
}

function serviceWith(answer: string, hasKey = true) {
  const complete = vi.fn(async () => answer);
  const provider: AiProvider = { complete };
  const service = createAiService({
    chapters: { findById: async () => chapter() } as never,
    glossary: {
      list: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          projectId: '00000000-0000-4000-8000-000000000001',
          canonicalForm: 'Kaelith',
          kind: 'name',
          notes: '',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    } as never,
    keys: keyStore(hasKey),
    makeProvider: () => provider,
    resolveProjectId: async () => '00000000-0000-4000-8000-000000000001',
  });
  return { service, complete };
}

describe('checking English', () => {
  it('refuses to run without a stored key', async () => {
    const { service } = serviceWith('{}', false);
    await expect(service.checkChapter({ chapterId: CHAPTER_ID })).rejects.toThrow(
      /no deepseek key/i,
    );
  });

  it('keeps a suggestion whose span matches the chapter text', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        suggestions: [
          {
            start: 0,
            end: 4,
            original: 'Kael',
            suggestion: 'Kaelith',
            kind: 'spelling',
            message: 'The glossary spells this Kaelith.',
          },
        ],
      }),
    );

    const result = await service.checkChapter({ chapterId: CHAPTER_ID });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.suggestion).toBe('Kaelith');
  });

  it('drops a suggestion whose original text is not at that span', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        suggestions: [
          {
            start: 0,
            end: 4,
            original: 'Mira',
            suggestion: 'Mire',
            kind: 'spelling',
            message: 'Not actually there.',
          },
        ],
      }),
    );

    const result = await service.checkChapter({ chapterId: CHAPTER_ID });
    expect(result.suggestions).toEqual([]);
  });

  it('drops an unknown suggestion kind', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        suggestions: [
          {
            start: 0,
            end: 4,
            original: 'Kael',
            suggestion: 'Kaell',
            kind: 'rewrite-everything',
            message: 'No.',
          },
        ],
      }),
    );

    const result = await service.checkChapter({ chapterId: CHAPTER_ID });
    expect(result.suggestions).toEqual([]);
  });

  it('refuses an answer that is not JSON, without changing anything', async () => {
    const { service } = serviceWith('I rewrote your chapter for you.');
    await expect(service.checkChapter({ chapterId: CHAPTER_ID })).rejects.toThrow(
      /instead of JSON/i,
    );
  });

  it('sends the glossary as a never-touch list', async () => {
    const { service, complete } = serviceWith(
      JSON.stringify({ suggestions: [] }),
    );
    await service.checkChapter({ chapterId: CHAPTER_ID });

    const request = complete.mock.calls[0]?.[0] as { user: string };
    expect(request.user).toContain('Kaelith');
    expect(request.user).toContain(BODY);
  });
});

describe('proposing facts', () => {
  it('keeps a fact whose quote is in the chapter', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        facts: [
          {
            kind: 'event',
            content: 'Kael burns the writ.',
            sourceQuote: 'The writ curled and went to ash in his hand.',
          },
        ],
      }),
    );

    const result = await service.proposeFacts({ chapterId: CHAPTER_ID });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.kind).toBe('event');
  });

  it('drops a fact whose quote cannot be found, because it cannot be checked', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        facts: [
          {
            kind: 'event',
            content: 'Kael rides north.',
            sourceQuote: 'Kael rode north before dawn.',
          },
        ],
      }),
    );

    const result = await service.proposeFacts({ chapterId: CHAPTER_ID });
    expect(result.proposals).toEqual([]);
  });

  it('drops an unknown fact kind', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        facts: [
          {
            kind: 'plot_twist',
            content: 'Something.',
            sourceQuote: 'Kael held the writ.',
          },
        ],
      }),
    );

    const result = await service.proposeFacts({ chapterId: CHAPTER_ID });
    expect(result.proposals).toEqual([]);
  });

  it('tolerates a fenced JSON block', async () => {
    const { service } = serviceWith(
      '```json\n{"facts":[{"kind":"event","content":"Kael burns the writ.","sourceQuote":"The writ curled and went to ash in his hand."}]}\n```',
    );

    const result = await service.proposeFacts({ chapterId: CHAPTER_ID });
    expect(result.proposals).toHaveLength(1);
  });
});
