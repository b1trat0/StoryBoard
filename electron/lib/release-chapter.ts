import type { Chapter, Illustration } from '../ipc/contract.js';
import { escapeHtmlAttribute } from './html-escape.js';
import { toRoyalRoadParagraphs } from './royal-road-html.js';

/**
 * Assembles what a single chapter will look like when published to Royal Road.
 *
 * This is the release preview's engine and it is a pure function on purpose. Every
 * claim the preview makes about a chapter has to be checkable without a database, an
 * Electron window, or an export dialog, because the failure it exists to catch is
 * silent: an image two paragraphs late, a missing alt text, a stray markdown asterisk
 * that publishes as a literal character. Those all produce output, and the author has
 * no other signal that anything is wrong.
 *
 * Nothing here writes. A misplaced illustration is reported so the author can
 * re-anchor it deliberately, never corrected on the way past.
 *
 * Constraints encoded below are asserted in `tests/unit/release-chapter.test.ts` and
 * all come from AGENTS.md's Royal Road section.
 */

/** Royal Road refuses to publish a chapter under this many characters. */
const MIN_PUBLISHABLE_CHARACTERS = 500;



/** Royal Road's stated ceiling for a single chapter. */
const MAX_RECOMMENDED_WORD_COUNT = 10000;

/** Marks a problem that must be resolved before this chapter can be published. */
export type ReleaseSeverity = 'blocker' | 'warning';

/** Machine-readable reason, so the preview can group and the tests can assert. */
export type ReleaseWarningCode =
  | 'not_finished'
  | 'too_short'
  | 'over_length'
  | 'unconverted_markdown'
  | 'unuploaded_image'
  | 'missing_alt'
  | 'unknown_dimensions'
  | 'anchor_out_of_range';

/** One thing the author needs to know before publishing. */
export interface ReleaseWarning {
  code: ReleaseWarningCode;
  severity: ReleaseSeverity;
  /** Written for the author to act on, not for a log file. */
  message: string;
}

/** A block of the chapter body in publication order. */
export type ReleaseBlock =
  | {
      kind: 'paragraph';
      /** Converted HTML for this paragraph. */
      html: string;
      /** Zero-based index of the source paragraph this is. */
      paragraphIndex: number;
    }
  | {
      kind: 'image';
      /** The `<img>` tag exactly as Royal Road will receive it. */
      imageHtml: string;
      /** Caption converted to HTML, empty when the author wrote none. */
      captionHtml: string;
      illustrationId: string;
      /** Zero-based index of the paragraph this image follows. */
      afterParagraphIndex: number;
      /** True when the anchor no longer exists and the image was shown at the end. */
      isMisplaced: boolean;
    };

/** Everything the preview needs to render and judge one chapter. */
export interface ChapterRelease {
  chapterId: string;
  title: string;
  /** Converted pre-chapter author note, empty when unwritten. */
  preNoteHtml: string;
  /** Converted body, in publication order, images interleaved. */
  blocks: ReleaseBlock[];
  /** Converted post-chapter author note, empty when unwritten. */
  postNoteHtml: string;
  wordCount: number;
  /**
   * True when this chapter is left out of the exported output.
   *
   * Interludes stay on the timeline but are not part of the main arc, so they do not
   * publish in sequence. The preview still lists them with this flag rather than
   * hiding them, because a chapter that silently vanishes from a release is worse
   * than one that is visibly excluded.
   */
  isExcluded: boolean;
  /** Why the chapter is excluded, or null when it is included. */
  exclusionReason: string | null;
  warnings: ReleaseWarning[];
}

/**
 * Collects warnings, keeping the order the problems were found in.
 *
 * Two slots missing the same thing produce two identical messages, and an
 * indistinguishable pair of lines is noise the author has to read past to find the
 * distinct problem underneath. Deduplication happens once at the end, so the
 * detection code does not have to know whether a warning has been seen.
 */
function pushWarning(
  warnings: ReleaseWarning[],
  code: ReleaseWarningCode,
  severity: ReleaseSeverity,
  message: string,
): void {
  warnings.push({ code, severity, message });
}

/**
 * Builds the `<img>` tag for an illustration.
 *
 * Hotlinked, never re-hosted: Royal Road provides no internal image hosting, so the
 * file must already have a permanent public URL or the tag is useless. No `class`
 * attribute, because Royal Road strips it. Dimensions come from the stored record
 * rather than being invented, so the preview shows the author the real gap instead
 * of a plausible-looking guess.
 */
function buildImageTag(illustration: Illustration): string {
  const src = illustration.remoteUrl;
  if (src === null) {
    return '';
  }
  const attributes = [
    `src="${escapeHtmlAttribute(src)}"`,
    illustration.width === null ? null : `width="${illustration.width}"`,
    illustration.height === null ? null : `height="${illustration.height}"`,
    `alt="${escapeHtmlAttribute(illustration.altText)}"`,
  ].filter((attribute): attribute is string => attribute !== null);
  return `<img ${attributes.join(' ')}>`;
}

/**
 * Reports everything wrong with one illustration that this module can detect.
 *
 * An unuploaded slot is a blocker because there is no working image to publish. A
 * missing alt text is also a blocker: alt text is required on every exported image,
 * and an image with none is unusable to a screen reader.
 */
function checkIllustration(illustration: Illustration, warnings: ReleaseWarning[]): void {
  if (illustration.remoteUrl === null) {
    pushWarning(
      warnings,
      'unuploaded_image',
      'blocker',
      `Image "${illustration.altText || 'untitled'}" has a local file but no public URL. ` +
        'Upload it to an image host first, because Royal Road cannot show a local file.',
    );
  }
  if (illustration.altText.trim() === '') {
    pushWarning(
      warnings,
      'missing_alt',
      'blocker',
      'An exported image has no alt text. Every image published to Royal Road needs it.',
    );
  }
  if (illustration.width === null || illustration.height === null) {
    pushWarning(
      warnings,
      'unknown_dimensions',
      'warning',
      `Image "${illustration.altText || 'untitled'}" has no recorded width and height, ` +
        'so the tag is emitted without them and may not lay out as you expect.',
    );
  }
}

/**
 * Orders illustrations into the body.
 *
 * Anchoring is by paragraph index rather than character offset because a character
 * offset breaks on every edit above the image, while an index breaks only when
 * paragraphs are added or removed.
 */
function placeIllustrations(
  paragraphs: string[],
  illustrations: readonly Illustration[],
  warnings: ReleaseWarning[],
): ReleaseBlock[] {
  const byAnchor = new Map<number, Illustration[]>();
  for (const illustration of illustrations) {
    const siblings = byAnchor.get(illustration.afterParagraphIndex);
    if (siblings === undefined) {
      byAnchor.set(illustration.afterParagraphIndex, [illustration]);
    } else {
      siblings.push(illustration);
    }
  }

  const blocks: ReleaseBlock[] = [];
  paragraphs.forEach((html, paragraphIndex) => {
    blocks.push({ kind: 'paragraph', html, paragraphIndex });
    for (const illustration of byAnchor.get(paragraphIndex) ?? []) {
      checkIllustration(illustration, warnings);
      blocks.push({
        kind: 'image',
        imageHtml: buildImageTag(illustration),
        captionHtml: toRoyalRoadParagraphs(illustration.caption).paragraphs.join('<br /><br />'),
        illustrationId: illustration.id,
        afterParagraphIndex: paragraphIndex,
        isMisplaced: false,
      });
    }
  });

  // Anchors past the end of the chapter. Shown after the last paragraph and flagged,
  // rather than dropped: the author asked for this image to be in this chapter, and
  // the fix is to re-anchor it deliberately, not for the preview to guess.
  const placed = new Set([...byAnchor.keys()].filter((index) => index < paragraphs.length));
  for (const [anchor, orphans] of byAnchor) {
    if (placed.has(anchor)) {
      continue;
    }
    for (const illustration of orphans) {
      checkIllustration(illustration, warnings);
      pushWarning(
        warnings,
        'anchor_out_of_range',
        'warning',
        `Image "${illustration.altText || 'untitled'}" is anchored after paragraph ` +
          `${anchor + 1}, but the chapter only has ${paragraphs.length} paragraph(s). ` +
          'It is shown at the end; re-anchor it to put it back where you meant.',
      );
      blocks.push({
        kind: 'image',
        imageHtml: buildImageTag(illustration),
        captionHtml: toRoyalRoadParagraphs(illustration.caption).paragraphs.join('<br /><br />'),
        illustrationId: illustration.id,
        // Recorded as the last real index so the preview can label the position
        // honestly rather than claiming a paragraph that does not exist.
        afterParagraphIndex: Math.max(0, paragraphs.length - 1),
        isMisplaced: true,
      });
    }
  }

  return blocks;
}

/**
 * Reports the chapter-level problems Royal Road itself enforces.
 *
 * The character floor is a hard platform rule. The word-count ceiling is only a
 * recommendation, so it is a warning rather than a blocker: an author publishing a
 * long chapter has usually decided that on purpose.
 */
function checkChapter(chapter: Chapter, warnings: ReleaseWarning[]): void {
  if (chapter.status === 'outline') {
    pushWarning(
      warnings,
      'not_finished',
      'blocker',
      'This chapter is still an outline. It has no prose to publish yet.',
    );
  }
  if (chapter.bodyMd.trim().length < MIN_PUBLISHABLE_CHARACTERS) {
    pushWarning(
      warnings,
      'too_short',
      'blocker',
      `Royal Road will not publish a chapter under ${MIN_PUBLISHABLE_CHARACTERS} characters. ` +
        `This one is ${chapter.bodyMd.trim().length}.`,
    );
  }
  if (chapter.wordCount > MAX_RECOMMENDED_WORD_COUNT) {
    pushWarning(
      warnings,
      'over_length',
      'warning',
      `This chapter is ${chapter.wordCount.toLocaleString('en-US')} words. Royal Road's ` +
        `recommended ceiling is ${MAX_RECOMMENDED_WORD_COUNT.toLocaleString('en-US')}.`,
    );
  }
}

/**
 * Assembles the publishable form of one chapter.
 *
 * @param chapter - The chapter as stored, including its author notes.
 * @param illustrations - Slots for this chapter, in any order; they are placed by
 *   their `afterParagraphIndex`.
 * @returns The blocks in publication order, both notes converted, and every problem
 *   found. `warnings` is empty when the chapter is ready to publish.
 */
export function buildChapterRelease(
  chapter: Chapter,
  illustrations: readonly Illustration[],
): ChapterRelease {
  const warnings: ReleaseWarning[] = [];
  const isExcluded = chapter.type === 'interlude';

  const { paragraphs, warnings: markdownWarnings } = toRoyalRoadParagraphs(chapter.bodyMd);
  for (const message of markdownWarnings) {
    pushWarning(warnings, 'unconverted_markdown', 'warning', message);
  }

  const preNote = toRoyalRoadParagraphs(chapter.authorNotePre);
  const postNote = toRoyalRoadParagraphs(chapter.authorNotePost);
  for (const message of [...preNote.warnings, ...postNote.warnings]) {
    pushWarning(warnings, 'unconverted_markdown', 'warning', `Author note: ${message}`);
  }

  checkChapter(chapter, warnings);

  return {
    chapterId: chapter.id,
    title: chapter.title,
    preNoteHtml: preNote.paragraphs.join('<br /><br />'),
    blocks: placeIllustrations(paragraphs, illustrations, warnings),
    postNoteHtml: postNote.paragraphs.join('<br /><br />'),
    wordCount: chapter.wordCount,
    isExcluded,
    exclusionReason: isExcluded
      ? 'Interludes stay on the timeline but are not part of the main arc, so this ' +
        'chapter is not included in the exported release.'
      : null,
    warnings: dedupeWarnings(warnings),
  };
}

/**
 * Collapses identical warnings, keeping the first occurrence.
 *
 * Keyed on code and message together because the same message under two different
 * codes is genuinely two problems: a chapter can be too short and still an outline,
 * and telling the author only one of those would leave the other unfixed.
 */
function dedupeWarnings(warnings: readonly ReleaseWarning[]): ReleaseWarning[] {
  const seen = new Set<string>();
  const unique: ReleaseWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(warning);
  }
  return unique;
}