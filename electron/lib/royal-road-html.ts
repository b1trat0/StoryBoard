import { splitParagraphs } from './chapter-text.js';

/**
 * Converts the author's plain markdown into HTML that Royal Road actually renders.
 *
 * Royal Road has no markdown support at all. Its chapter editor toolbar is bold,
 * italic, underline and strikethrough, and anything else has to arrive as BBCode or
 * as HTML through the source view. A chapter written with `*emphasis*` or `# Heading`
 * and pasted in unchanged publishes with those characters visible, which is the whole
 * reason this module exists.
 *
 * Only the constructs listed below are converted. This is deliberately not a markdown
 * engine: AGENTS.md commits to adopting the author's existing plain-markdown files with
 * no conversion step, so the storage format stays portable and the translation happens
 * in exactly one place at export time.
 *
 * Everything this module cannot translate is reported as a warning rather than
 * silently passed through. A literal `#` or `-` reaching a published chapter is worse
 * than a loud message in the release preview, because the author has no way to notice
 * it after the fact.
 */

/** Result of converting one block of authored text. */
export interface RoyalRoadConversion {
  /** HTML safe to hand to Royal Road's chapter content or its source view. */
  html: string;
  /**
   * Constructs found in the source that Royal Road cannot render, in the order they
   * were met. Empty means everything in the source is translatable.
   */
  warnings: string[];
}

/**
 * Royal Road is single-spaced with no paragraph spacing control, so a paragraph break
 * is expressed as consecutive break tags. AGENTS.md fixes this at two.
 */
const PARAGRAPH_GAP = '<br /><br />';

/** A single newline inside a paragraph is a line break, never a new paragraph. */
const LINE_BREAK = '<br />';

/** Three or more repeated markers on their own line: the prose scene-break convention. */
const SCENE_BREAK = /^(?:([*\-_])(?:[ \t]*\1){2,})$/;

/** A horizontal rule written the markdown way, on a line by itself. */
const HORIZONTAL_RULE = /^-{3,}$/;

/**
 * Block constructs that cannot be represented in Royal Road chapter prose.
 *
 * Each is detected on the raw line, before escaping, because `>` and `&` are exactly
 * the characters escaping rewrites and a blockquote marker must still be recognised.
 */
const UNCONVERTIBLE_BLOCKS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /^\s{0,3}#{1,6}\s/, label: 'markdown heading' },
  { pattern: /^\s{0,3}([-*+])\s+\S/, label: 'markdown list item' },
  { pattern: /^\s{0,3}>\s?/, label: 'markdown blockquote' },
  { pattern: /^\s{0,3}(?:```|~~~)/, label: 'fenced code block' },
  { pattern: /!\[[^\]]*\]\([^)]*\)/, label: 'markdown image' },
  { pattern: /(?<!!)\[[^\]]+\]\([^)]*\)/, label: 'markdown link' },
  { pattern: /`[^`]+`/, label: 'inline code' },
];

/**
 * Escapes the three characters that would otherwise be read as markup.
 *
 * Fantasy prose contains angle brackets and ampersands in ordinary sentences, and an
 * unescaped `<` silently swallows the rest of the paragraph in the browser. Quotes are
 * not escaped because no attribute is ever built from authored text here.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Applies the emphasis conversions, outermost first.
 *
 * `***text***` is handled ahead of the others because the single-star and double-star
 * patterns both match parts of it and produce `<i><b>` in an order that reads
 * backwards; matching it whole keeps the outer emphasis the outer tag.
 */
function applyEmphasis(escaped: string): string {
  return escaped
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>')
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '<i>$1</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>');
}

/**
 * Reports any untranslatable construct on one line.
 *
 * The message quotes the offending text so the author can find it in a chapter of
 * prose without the preview having to count lines across a paragraph split.
 */
function collectWarnings(line: string, warnings: string[]): void {
  for (const block of UNCONVERTIBLE_BLOCKS) {
    if (block.pattern.test(line)) {
      warnings.push(`${block.label}: ${truncate(line.trim())}`);
    }
  }
}

/** Keeps a warning message to one readable line. */
function truncate(text: string): string {
  const limit = 60;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Converts one source line.
 *
 * A scene break or horizontal rule replaces the line entirely. Everything else is
 * escaped, warned about if it carries markup Royal Road cannot show, then converted.
 */
function convertLine(line: string, warnings: string[]): string {
  const trimmed = line.trim();
  if (HORIZONTAL_RULE.test(trimmed) || SCENE_BREAK.test(trimmed)) {
    return '<hr />';
  }
  collectWarnings(line, warnings);
  return applyEmphasis(escapeHtml(line));
}

/**
 * Converts one blank-line-separated block of prose.
 *
 * Newlines inside the block become line breaks, matching Royal Road's own rule that a
 * single newline is a line break and a blank line is a paragraph.
 */
function convertParagraph(paragraph: string, warnings: string[]): string {
  return paragraph
    .split(/\r?\n/)
    .map((line) => convertLine(line, warnings))
    .join(LINE_BREAK);
}

/**
 * Converts authored markdown into Royal Road HTML.
 *
 * @param bodyMd - The author's stored text. Treated as plain markdown with
 *   blank-line-separated paragraphs, never as CommonMark.
 * @returns The HTML plus every construct that could not be translated. The warnings
 *   are informational; the HTML is still usable, with the untranslatable text left
 *   visible as literal characters.
 */
export function toRoyalRoadHtml(bodyMd: string): RoyalRoadConversion {
  const warnings: string[] = [];
  const paragraphs = splitParagraphs(bodyMd).map((paragraph) =>
    convertParagraph(paragraph, warnings),
  );
  return {
    html: paragraphs.join(PARAGRAPH_GAP),
    // Deduplicated so a chapter with forty unconverted list items reports one line
    // rather than burying the release preview.
    warnings: [...new Set(warnings)],
  };
}