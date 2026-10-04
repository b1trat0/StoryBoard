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

/**
 * Reverses `escapeHtmlText`, for reading the converter's output back.
 *
 * The `.docx` writer needs the author's characters rather than their escaped forms,
 * because a Word document is XML and escapes its own text on the way out. Escaping
 * twice is the failure this prevents: `&amp;` would reach the author's file as a
 * literal `&amp;`, which is a bug that only shows up after publication.
 *
 * `&lt;` and `&gt;` are decoded as well, and that is what makes it safe to run before
 * tokenizing: a literal `<` in prose arrives escaped, so a real `<` in the string is
 * always a tag from the converter and never the author's text.
 *
 * @param text - HTML-escaped text, as produced by `escapeHtmlText`.
 * @returns The text as the author typed it.
 */
export function unescapeHtmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}