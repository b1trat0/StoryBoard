import type { ChapterRelease } from '../../lib/bridge';

/**
 * The HTML the author pastes into Royal Road's source view.
 *
 * This is assembly, not conversion: every paragraph and image tag in `blocks` was
 * already converted by the main process, and the notes are already escaped. Joining
 * them in publication order is the only thing that happens here, which is why it is
 * safe to keep beside the preview rather than importing the main-process renderer.
 *
 * The title is deliberately absent. Royal Road's form has its own Title field, and a
 * duplicated title in the body is the most common clean-paste mistake.
 *
 * @param release - Assembled release, as returned by the preview.
 * @returns HTML fragment in publication order.
 */
export function releaseBodyHtml(release: ChapterRelease): string {
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
