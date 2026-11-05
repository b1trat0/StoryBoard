import type { ChapterRelease } from './release-chapter.js';

/**
 * Turning a release into the text that actually leaves the app.
 *
 * The preview already assembles the outgoing HTML; this file only decides how it is
 * wrapped. Two forms exist because they are used differently:
 *
 *   - the **body fragment** is what the author pastes into Royal Road's source view,
 *     where title and author notes have their own fields;
 *   - the **document** is what a `.html` export writes, so the file opens correctly on
 *     its own.
 *
 * No `class` attribute is ever emitted, and no stylesheet is embedded: Royal Road
 * strips classes, and inline styles in an exported file would only disagree with the
 * site's own typography.
 */

/**
 * The publishable body: pre-note, prose blocks, images, post-note.
 *
 * @param release - Assembled chapter release.
 * @returns HTML fragment in publication order.
 */
export function renderChapterBody(release: ChapterRelease): string {
  const parts: string[] = [];

  if (release.preNoteHtml.trim().length > 0) {
    parts.push(release.preNoteHtml);
  }

  for (const block of release.blocks) {
    if (block.kind === 'paragraph') {
      parts.push(block.html);
      continue;
    }
    parts.push(block.imageHtml);
    if (block.captionHtml.trim().length > 0) {
      parts.push(block.captionHtml);
    }
  }

  if (release.postNoteHtml.trim().length > 0) {
    parts.push(release.postNoteHtml);
  }

  return parts.join('\n');
}

/**
 * A standalone HTML file for one chapter.
 *
 * @param release - Assembled chapter release.
 * @param escapedTitle - Chapter title, already escaped by the caller.
 * @returns A complete document with the body fragment inside it.
 */
export function renderChapterDocument(
  release: ChapterRelease,
  escapedTitle: string,
): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapedTitle}</title>`,
    '</head>',
    '<body>',
    renderChapterBody(release),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
