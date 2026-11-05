/**
 * The AI boundary.
 *
 * Nothing above this interface knows which model is answering. That is deliberate: the
 * app's rules — proposals only, never prose, always attributed to a source — belong to
 * the service, and swapping DeepSeek for a local model must not require rewriting them.
 */

export interface AiCompletionRequest {
  /** Instructions that define the task and its output shape. */
  system: string;
  /** The material to work on: one chapter at a time, never a volume. */
  user: string;
  /** Ask the provider for a JSON object rather than prose. */
  json: boolean;
}

export interface AiProvider {
  /**
   * Runs one completion.
   *
   * @returns The model's text output.
   * @throws {@link AiProviderError} for anything the author needs to read.
   */
  complete(request: AiCompletionRequest): Promise<string>;
}

/** A failure the author can act on: bad key, no network, rate limit, timeout. */
export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}
