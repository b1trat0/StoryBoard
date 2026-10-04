import { unescapeHtmlText } from './html-escape.js';

/**
 * Reading Royal Road HTML back as Word runs.
 *
 * The `.docx` writer needs the author's emphasis as formatting, not as text. It gets
 * that by tokenizing the output of `toRoyalRoadParagraphs` rather than by converting
 * the markdown a second time: two converters would eventually disagree, and the
 * release preview would be reviewing one document while the author uploaded another.
 *
 * This is a tokenizer over a closed tag set, deliberately not an HTML parser. The
 * converter emits exactly `<b>`, `<i>`, `<s>`, `<br />` and `<hr />`, and everything
 * else in its output is escaped text. An unrecognised tag therefore means the
 * converter has moved on and this module is behind it, which is thrown rather than
 * guessed at — a literal `<h1>` shipped into a Word file is invisible until someone
 * opens it.
 */

/** Emphasis carried by a single run of text. */
export interface DocxRunFlags {
  isBold: boolean;
  isItalic: boolean;
  isStrike: boolean;
}

/** A stretch of text with one set of emphasis on it. */
export interface DocxTextRun extends DocxRunFlags {
  kind: 'run';
  /** The author's characters, unescaped, ready for a Word run. */
  text: string;
}

/** A single newline inside a paragraph, which Royal Road treats as a break. */
export interface DocxLineBreak {
  kind: 'lineBreak';
}

/**
 * A `---` style scene break.
 *
 * Separate from a line break because it ends the paragraph rather than sitting inside
 * it: the writer has to break the surrounding paragraph in two to show one.
 */
export interface DocxSceneBreak {
  kind: 'sceneBreak';
}

/** One piece of a paragraph, in order. */
export type DocxInline = DocxTextRun | DocxLineBreak | DocxSceneBreak;

/** The pieces that can sit inside one Word paragraph. */
export type DocxParagraphPart = DocxTextRun | DocxLineBreak;

/** The emphasis tags the converter emits, and what each one means in a Word run. */
const EMPHASIS_TAGS: Readonly<Record<string, keyof DocxRunFlags>> = {
  b: 'isBold',
  i: 'isItalic',
  s: 'isStrike',
};

/** Which emphasis tag is currently open, so a closing tag knows what to close. */
interface OpenEmphasis {
  tag: string;
  flag: keyof DocxRunFlags;
}

/**
 * Turns one converted paragraph into the pieces a Word paragraph is made of.
 *
 * Text is unescaped here rather than at the call site, so nothing downstream can
 * accidentally write `&amp;` into a document that escapes its own text. Runs with
 * identical emphasis are merged, because the converter emits one run per line and a
 * Word file full of one-word runs is unreadable in any diff.
 *
 * @param html - One paragraph from `toRoyalRoadParagraphs`, never the joined document.
 * @returns Runs, line breaks and scene breaks, in order.
 * @throws When a tag is unbalanced or is not one the converter emits.
 */
export function parseRoyalRoadInlines(html: string): DocxInline[] {
  const inlines: DocxInline[] = [];
  const open: OpenEmphasis[] = [];
  let pending = '';
  let cursor = 0;

  const currentFlags = (): DocxRunFlags => ({
    isBold: open.some((entry) => entry.flag === 'isBold'),
    isItalic: open.some((entry) => entry.flag === 'isItalic'),
    isStrike: open.some((entry) => entry.flag === 'isStrike'),
  });

  const flush = (): void => {
    if (pending === '') {
      return;
    }
    const text = unescapeHtmlText(pending);
    pending = '';
    const flags = currentFlags();
    const previous: DocxInline | undefined = inlines[inlines.length - 1];
    if (
      previous !== undefined &&
      previous.kind === 'run' &&
      previous.isBold === flags.isBold &&
      previous.isItalic === flags.isItalic &&
      previous.isStrike === flags.isStrike
    ) {
      previous.text += text;
      return;
    }
    inlines.push({ kind: 'run', text, ...flags });
  };

  while (cursor < html.length) {
    const next = html.indexOf('<', cursor);
    if (next === -1) {
      pending += html.slice(cursor);
      break;
    }

    pending += html.slice(cursor, next);
    const close = html.indexOf('>', next);
    if (close === -1) {
      throw new Error(
        `Cannot read Royal Road HTML: an unterminated tag was left open in ${JSON.stringify(html)}.`,
      );
    }

    const tag = html.slice(next, close + 1);
    cursor = close + 1;
    flush();

    if (tag === '<br />') {
      inlines.push({ kind: 'lineBreak' });
      continue;
    }
    if (tag === '<hr />') {
      inlines.push({ kind: 'sceneBreak' });
      continue;
    }

    const closing = /^<\/\s*([a-z]+)\s*>$/.exec(tag);
    if (closing !== null) {
      const name = closing[1];
      const top = open[open.length - 1];
      if (top === undefined || top.tag !== name) {
        throw new Error(
          `Cannot read Royal Road HTML: a closing </${name}> has nothing open in ` +
            `${JSON.stringify(html)}.`,
        );
      }
      open.pop();
      continue;
    }

    const opening = /^<\s*([a-z]+)\s*>$/.exec(tag);
    const name = opening?.[1];
    const flag = name === undefined ? undefined : EMPHASIS_TAGS[name];
    if (name !== undefined && flag !== undefined) {
      open.push({ tag: name, flag });
      continue;
    }

    throw new Error(
      `Cannot read Royal Road HTML: <${tag}> is not a tag the converter emits. Add it to ` +
        'docx-runs.ts or keep it out of the export, because guessing here puts markup in ' +
        'front of the author as visible text.',
    );
  }

  flush();

  if (open.length > 0) {
    const names = open.map((entry) => entry.tag).join('>, <');
    throw new Error(
      `Cannot read Royal Road HTML: <${names}> ${open.length === 1 ? 'was' : 'were'} left open ` +
        `in ${JSON.stringify(html)}.`,
    );
  }

  return inlines;
}