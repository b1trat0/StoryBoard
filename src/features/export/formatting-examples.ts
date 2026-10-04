/**
 * What the author types, and what Royal Road actually receives.
 *
 * Royal Road has no markdown support. Its editor toolbar is bold, italic, underline
 * and strikethrough, and anything richer has to arrive as HTML through the source
 * view. So the app translates at export time rather than forbidding markdown, and this
 * file is the author-facing half of that promise.
 *
 * Every `html` value here is asserted against `toRoyalRoadHtml` in
 * `tests/unit/formatting-examples.test.ts`. That test is the point of the file: a
 * reference the author trusts has to be unable to drift away from the converter, and
 * a cheat sheet that quietly stops matching the code is worse than no cheat sheet.
 * Change the converter and this file fails until both agree again.
 */

/** One thing the author can type, and exactly what it becomes. */
export interface FormattingExample {
  /** What to type, shown to the author verbatim. */
  source: string;
  /** The HTML handed to Royal Road. Asserted against the converter. */
  html: string;
  /** Why it behaves this way, or what to reach for instead. */
  note: string;
}

/** A related set of examples under one heading. */
export interface FormattingGroup {
  id: string;
  title: string;
  summary: string;
  examples: FormattingExample[];
}

/** A markdown construct that is deliberately not translated. */
export interface UnsupportedConstruct {
  /** The name the release preview uses when it warns about this. */
  label: string;
  source: string;
  /** What to do instead, which is always available. */
  instead: string;
}

/**
 * Everything the converter translates.
 *
 * Ordered the way an author meets it: emphasis first, because that is nearly all of
 * what prose uses, then the two spacing rules, then the scene break.
 */
export const FORMATTING_GROUPS: FormattingGroup[] = [
  {
    id: 'emphasis',
    title: 'Emphasis',
    summary:
      'These are the whole of it. Everything else you can think of is not translated and will be reported in the release preview.',
    examples: [
      {
        source: '**bold**',
        html: '<b>bold</b>',
        note: 'Double asterisks on both sides.',
      },
      {
        source: '*italic*',
        html: '<i>italic</i>',
        note: 'Single asterisks on both sides.',
      },
      {
        source: '_italic_',
        html: '<i>italic</i>',
        note: 'Single underscores also work, for when asterisks are already busy.',
      },
      {
        source: '***both***',
        html: '<b><i>both</i></b>',
        note: 'Bold and italic together, in either order.',
      },
      {
        source: '~~struck through~~',
        html: '<s>struck through</s>',
        note: 'Tildes on both sides.',
      },
    ],
  },
  {
    id: 'spacing',
    title: 'Paragraphs and line breaks',
    summary:
      'This is Royal Road\'s own rule, not a preference: a blank line is a paragraph, a single newline is a line break.',
    examples: [
      {
        source: 'First paragraph.\n\nSecond paragraph.',
        html: 'First paragraph.<br /><br />Second paragraph.',
        note: 'Leave a completely blank line between paragraphs.',
      },
      {
        source: 'This line\nand this one.',
        html: 'This line<br />and this one.',
        note: 'One newline is a line break, inside a paragraph. It does not start a new one.',
      },
    ],
  },
  {
    id: 'scene-break',
    title: 'Scene break',
    summary:
      'A line of three or more repeated markers becomes a horizontal rule. Any of these four is the same thing.',
    examples: [
      { source: '---', html: '<hr />', note: 'Three or more hyphens on a line by themselves.' },
      { source: '***', html: '<hr />', note: 'Three or more asterisks.' },
      { source: '* * *', html: '<hr />', note: 'Asterisks with spaces, the older convention.' },
      { source: '___', html: '<hr />', note: 'Three or more underscores.' },
    ],
  },
  {
    id: 'characters',
    title: 'Characters that need escaping',
    summary:
      'Handled for you. You type the plain character and it reaches Royal Road intact, never as markup.',
    examples: [
      {
        source: 'Tom & Jerry',
        html: 'Tom &amp; Jerry',
        note: 'An ampersand is escaped so the page cannot read it as markup.',
      },
      {
        source: 'A < B',
        html: 'A &lt; B',
        note: 'Angle brackets are escaped the same way.',
      },
      {
        source: '"Quoted", he said.',
        html: '"Quoted", he said.',
        note: 'Quotes are left alone in prose. A quote is a quote, not markup.',
      },
    ],
  },
];

/**
 * Markdown that is deliberately refused.
 *
 * Each of these is reported by the release preview rather than passed through, because
 * a literal `#` or `-` reaching a published chapter is worse than a loud message: the
 * author has no way to notice it after the fact.
 */
export const UNSUPPORTED_CONSTRUCTS: UnsupportedConstruct[] = [
  {
    label: 'markdown heading',
    source: '## A heading',
    instead: 'Leave it as plain prose. Royal Road puts your chapter title above the text for you, and nothing else in the chapter body should look like a heading.',
  },
  {
    label: 'markdown list item',
    source: '- a bullet',
    instead: 'Write it as a sentence, or use a line break and an em dash. Royal Road has no list in chapter prose.',
  },
  {
    label: 'markdown blockquote',
    source: '> someone said this',
    instead: 'Set it as its own paragraph. A quoted line reads better plain here than through markup that will not render.',
  },
  {
    label: 'fenced code block',
    source: '```\ncode\n```',
    instead: 'Prose does not need code blocks. Invented incantations and formulas read better as plain indented lines or just sentences.',
  },
  {
    label: 'markdown link',
    source: '[the forum](https://example.com)',
    instead: 'Paste the address as plain text. Royal Road links are added in its editor, where they are tracked properly.',
  },
  {
    label: 'markdown image',
    source: '![alt text](https://example.com/a.png)',
    instead: 'Images are placed on the Illustration screen and anchored to a paragraph. That is how the export gets width, height and alt text right.',
  },
  {
    label: 'inline code',
    source: '`a term`',
    instead: 'Leave it plain. For an invented term, pin it on the Glossary screen so it stays spelled the same across the whole serial.',
  },
];

/**
 * The one thing Royal Road can do that markdown cannot express.
 *
 * Worth stating plainly rather than leaving the author to discover it: Royal Road's
 * toolbar has underline, and there is no plain-markdown syntax that means it.
 */
export const UNDERLINE_GAP = {
  label: 'underline',
  reason:
    'Royal Road can underline, but plain markdown has no way to say it. There is no sequence of asterisks or underscores that reaches the site as an underline, so it is not offered here rather than shown with syntax that does not work.',
  instead:
    'Apply underline in Royal Road\'s own editor after you paste the chapter, if a line truly needs it. Underline in prose is rare enough to be worth the extra step.',
} as const;
