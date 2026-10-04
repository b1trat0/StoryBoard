/**
 * HTML escaping for author-supplied text.
 *
 * Split out of the markdown converter because escaping has two distinct jobs and
 * getting them confused produces broken output quietly:
 *
 * - text nodes need `&`, `<` and `>` escaped
 * - attribute values additionally need `"` escaped, or an alt text containing a
 *   double quote terminates the attribute early and the rest of the tag becomes
 *   part of the image's URL
 *
 * Prose and image metadata both reach the export from the author's hands, so every
 * string that lands in the output goes through one of these.
 */

/**
 * Escapes a string for use as HTML text content.
 *
 * Quotes are deliberately left alone: a `"` in prose is a quote, not markup, and
 * escaping it would show the author their own escape sequence in the preview.
 *
 * @param text - Raw author text.
 * @returns Text safe between tags.
 */
export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes a string for use inside a double-quoted HTML attribute.
 *
 * `&` must be replaced first, otherwise the ampersands introduced by the later
 * replacements get escaped again and `&lt;` becomes `&amp;lt;`.
 *
 * @param value - Raw author text, typically alt text or an image URL.
 * @returns Text safe inside a double-quoted attribute value.
 */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}