import { ZodError } from 'zod';
import type { ZodType, z } from 'zod';
import { RuleViolationError } from '../services/storyboard.service.js';
import type { Logger } from '../lib/logger.js';

/**
 * IPC request handling.
 *
 * A controller does three things and nothing else: validate the inbound payload,
 * call the service, validate the outbound payload. It holds no business rules,
 * so there is nowhere for logic to hide.
 */

export type IpcErrorCode =
  | 'invalid_request'
  | 'rule_violation'
  | 'constraint_violation'
  | 'not_found'
  | 'internal';

/** The single error shape the renderer receives. Never a stack trace. */
export interface IpcError {
  ok: false;
  code: IpcErrorCode;
  message: string;
}

export interface IpcSuccess<T> {
  ok: true;
  data: T;
}

export type IpcResult<T> = IpcSuccess<T> | IpcError;

/**
 * Maps a Postgres constraint name to a sentence the author can act on.
 *
 * The database is the authority on every rule in this project, so the error the
 * author sees usually originates here rather than in application code.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  entities_project_canonical_name_uq:
    'An entity with that name already exists. Add an alias instead of renaming.',
  relations_no_self_reference: 'An entity cannot have a relation with itself.',
  relations_sentiment_is_social_only:
    'Sentiment applies to social relations only. Possession and membership are states, not arcs.',
  relations_rank_is_membership_only:
    'Rank applies to faction membership relations only.',
  relations_validity_order: 'A relation cannot end in the same chapter it starts.',
  relations_sentiment_check: 'Sentiment must be between -5 and 5.',
  facts_scoped_rows_have_scope_id: 'A fact must be attached to something.',
  illustrations_alt_text_check:
    'Every image needs alt text. Royal Road requires it, and screen readers need it.',
  glossary_terms_project_form_uq: 'That glossary entry already exists.',
  chapters_arc_ordinal_uq: 'Another chapter already sits at that position in this arc.',  entity_abilities_entity_kind_name_uq:
    'That entity already has an ability with this name.',
  projects_title_uq: 'A work with that title already exists.',
};

function describeZodError(err: ZodError): string {
  const first = err.issues[0];
  if (first === undefined) {
    return 'The request was not valid.';
  }
  const path = first.path.length > 0 ? first.path.join('.') : 'request';
  return `${path}: ${first.message}`;
}

function describePostgresError(err: unknown): { code: IpcErrorCode; message: string } {
  const constraint = (err as { constraint?: string }).constraint;
  if (typeof constraint === 'string') {
    const mapped = CONSTRAINT_MESSAGES[constraint];
    return {
      code: 'constraint_violation',
      message: mapped ?? 'That change conflicts with an existing record.',
    };
  }
  return { code: 'internal', message: 'Something went wrong writing to the database.' };
}

/**
 * Builds an IPC handler from a request schema, a response schema and a service
 * call.
 *
 * The returned function takes the untrusted raw payload. Every failure becomes
 * an IpcError: full detail is logged here, plain sentences are sent to the
 * renderer, because a Postgres constraint name is not useful to the author and a
 * stack trace is not a user interface.
 *
 * @param responseSchema - `null` for void handlers, where there is nothing to
 *   validate on the way out.
 */
export function handleIpc<TRequest extends z.ZodTypeAny, TResponse extends z.ZodTypeAny>(
  logger: Logger,
  channel: string,
  requestSchema: TRequest,
  responseSchema: TResponse | null,
  handler: (input: z.infer<TRequest>) => Promise<z.infer<TResponse>>,
): (raw: unknown) => Promise<IpcResult<z.infer<TResponse> | undefined>>;
export function handleIpc<TRequest extends z.ZodTypeAny>(
  logger: Logger,
  channel: string,
  requestSchema: TRequest,
  responseSchema: null,
  handler: (input: z.infer<TRequest>) => Promise<void>,
): (raw: unknown) => Promise<IpcResult<void>>;
export function handleIpc(
  logger: Logger,
  channel: string,
  requestSchema: ZodType,
  responseSchema: ZodType | null,
  handler: (input: never) => Promise<unknown>,
): (raw: unknown) => Promise<IpcResult<unknown>> {
  return async (raw: unknown) => {
    let input: unknown;
    try {
      input = requestSchema.parse(raw);
    } catch (err) {
      const message =
        err instanceof ZodError ? describeZodError(err) : 'The request was not valid.';
      logger.warn('ipc request rejected', { channel, message });
      return { ok: false, code: 'invalid_request', message };
    }

    try {
      const result = await handler(input as never);

      if (responseSchema === null) {
        return { ok: true, data: undefined };
      }

      // The database is not trusted on the way out either. A row that fails
      // validation is a bug to surface in the log, not to ship to the UI.
      const parsed = responseSchema.safeParse(result);
      if (!parsed.success) {
        logger.error('ipc response failed validation', {
          channel,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return {
          ok: false,
          code: 'internal',
          message: 'The app returned something it could not verify. See the logs.',
        };
      }

      return { ok: true, data: parsed.data };
    } catch (err) {
      if (err instanceof RuleViolationError) {
        return { ok: false, code: 'rule_violation', message: err.message };
      }

      const described = describePostgresError(err);
      logger.error('ipc handler failed', { channel, err: String(err) });
      return { ok: false, code: described.code, message: described.message };
    }
  };
}