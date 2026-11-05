/**
 * Errors that carry a sentence the author can act on.
 *
 * Controllers turn a RuleViolationError into a plain message; it never reaches the
 * renderer as a stack trace. It lives here rather than in a service so any layer can
 * raise one without importing a feature module.
 */

export class RuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolationError';
  }
}
