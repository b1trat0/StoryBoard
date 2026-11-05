import { AiProviderError } from './ai-provider.interface.js';
import type { AiCompletionRequest, AiProvider } from './ai-provider.interface.js';

/**
 * DeepSeek, behind the provider interface.
 *
 * This is the only file in the codebase that knows the vendor's URL, model name or
 * request shape. The API key comes from the main process's encrypted store and is never
 * logged, never returned over IPC and never written into a prompt.
 *
 * Timeout matters more than retries here: the author is waiting inside an editor, and a
 * hung request is worse than a failed one. One attempt, thirty seconds, then a sentence
 * naming what happened.
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';
const TIMEOUT_MS = 30_000;

interface DeepSeekResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export interface DeepSeekOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function createDeepSeekProvider(options: DeepSeekOptions): AiProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async complete(request: AiCompletionRequest) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            ...(request.json ? { response_format: { type: 'json_object' } } : {}),
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
          }),
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new AiProviderError(
            'DeepSeek rejected the API key. Check it in the AI settings.',
          );
        }
        if (response.status === 429) {
          throw new AiProviderError(
            'DeepSeek is rate-limiting this key. Try again in a minute.',
          );
        }
        if (!response.ok) {
          throw new AiProviderError(
            `DeepSeek returned ${response.status}. Nothing was changed in your chapter.`,
          );
        }

        const body = (await response.json()) as DeepSeekResponse;
        if (body.error?.message !== undefined) {
          throw new AiProviderError(`DeepSeek: ${body.error.message}`);
        }

        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.trim().length === 0) {
          throw new AiProviderError('DeepSeek returned an empty response.');
        }
        return content;
      } catch (err) {
        if (err instanceof AiProviderError) {
          throw err;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          throw new AiProviderError(
            'DeepSeek did not answer within 30 seconds. Nothing was changed.',
          );
        }
        throw new AiProviderError(
          `Could not reach DeepSeek (${err instanceof Error ? err.message : String(err)}).`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
