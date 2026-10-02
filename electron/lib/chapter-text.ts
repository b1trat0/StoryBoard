/**
 * Counting helpers for chapter prose.
 *
 * The author writes the first chapters outside this app, in plain markdown
 * separated by blank lines. These helpers assume exactly that shape, and nothing
 * more: no CommonMark parsing, no heading heuristics, no normalisation. The
 * paragraph count in particular must agree with what the editor shows, because
 * illustration slots are anchored to it.
 */

/**
 * Counts words the way a serial-fiction author cares about: whitespace-separated
 * runs of non-whitespace. Markdown syntax is counted as words, which slightly
 * over-reports a chapter containing emphasis, and that is preferable to
 * under-reporting silently.
 */
export function countWords(bodyMd: string): number {
  const trimmed = bodyMd.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/**
 * Counts blank-line-separated paragraphs.
 *
 * An illustration anchored after paragraph N must land in the same place here as
 * it does in the editor, so this is deliberately the same simple rule the editor
 * uses rather than a stricter parser.
 */
export function countParagraphs(bodyMd: string): number {
  return splitParagraphs(bodyMd).length;
}

/**
 * Splits prose into paragraphs on blank lines, trimming each and discarding
 * empty ones. Windows and Unix line endings are both handled, because the author
 * may be editing on either.
 */
export function splitParagraphs(bodyMd: string): string[] {
  return bodyMd
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}