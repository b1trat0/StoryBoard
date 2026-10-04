import { describe, expect, it } from 'vitest';
import { toRoyalRoadHtml } from '../../electron/lib/royal-road-html.js';

/**
 * Markdown to Royal Road HTML.
 *
 * These are assertions about Royal Road, not about taste. Each test names the platform
 * rule it pins, because the failure mode is silent: a chapter with literal `*` or `#`
 * characters still exports, still uploads, and still looks almost right, so nothing
 * breaks until a reader sees it.
 *
 * Rules under test, all from Royal Road's own knowledge base:
 *   - no markdown support at all
 *   - a blank line is a paragraph, a single newline is a line break
 *   - `<br />` for line breaks, never a raw `\n`
 *   - no `class` attributes, inline styles only
 *   - no indentation and no line spacing on paragraphs
 */

describe('inline emphasis', () => {
  it('converts bold, italic and strikethrough', () => {
    const { html } = toRoyalRoadHtml('A **bold** and an *italic* and a ~~struck~~ word.');

    expect(html).toBe('A <b>bold</b> and an <i>italic</i> and a <s>struck</s> word.');
  });

  it('accepts underscores for italics', () => {
    expect(toRoyalRoadHtml('an _italic_ word').html).toBe('an <i>italic</i> word');
  });

  it('converts bold and italic together', () => {
    expect(toRoyalRoadHtml('***loudly***').html).toBe('<b><i>loudly</i></b>');
  });

  it('leaves an orphan asterisk alone rather than eating the paragraph', () => {
    // A lone marker is prose, not formatting. Swallowing the rest of the line would
    // lose the author's words silently.
    expect(toRoyalRoadHtml('5 * 3 = 15').html).toBe('5 * 3 = 15');
  });

  it('still converts a matched pair inside a line that also has a lone marker', () => {
    expect(toRoyalRoadHtml('He did not *mean* it, and 5 * 3 = 15').html).toBe(
      'He did not <i>mean</i> it, and 5 * 3 = 15',
    );
  });

  it('does not treat snake_case identifiers as italics', () => {
    // Royal Road has no code spans, so this must arrive as the literal word an author
    // wrote rather than losing half of it.
    expect(toRoyalRoadHtml('the system_prompt field').html).toBe('the system_prompt field');
  });

  it('reports nothing when every construct is translatable', () => {
    expect(toRoyalRoadHtml('Plain **prose** only.').warnings).toEqual([]);
  });
});

describe('paragraphs and line breaks', () => {
  it('uses consecutive break tags for a paragraph gap', () => {
    const { html } = toRoyalRoadHtml('First paragraph.\n\nSecond paragraph.');

    expect(html).toBe('First paragraph.<br /><br />Second paragraph.');
  });

  it('treats a single newline as a line break, not a paragraph', () => {
    // Royal Road's own "clean paste" option exists to repair content that got this
    // wrong, which is the clearest statement that the two are different things.
    const { html } = toRoyalRoadHtml('Still the same paragraph.\nAnd its second line.');

    expect(html).toBe('Still the same paragraph.<br />And its second line.');
  });

  it('never emits a raw newline into the output', () => {
    const { html } = toRoyalRoadHtml('One\n\nTwo\nThree\n\nFour');

    expect(html).not.toMatch(/\n/);
  });

  it('handles Windows line endings the same as Unix', () => {
    expect(toRoyalRoadHtml('One\r\n\r\nTwo').html).toBe(toRoyalRoadHtml('One\n\nTwo').html);
  });

  it('returns empty output for empty prose', () => {
    expect(toRoyalRoadHtml('')).toEqual({ html: '', warnings: [] });
  });
});

describe('scene breaks', () => {
  it('converts a markdown horizontal rule', () => {
    expect(toRoyalRoadHtml('Before.\n\n---\n\nAfter.').html).toBe(
      'Before.<br /><br /><hr /><br /><br />After.',
    );
  });

  it('converts the three-asterisk prose convention', () => {
    expect(toRoyalRoadHtml('Before.\n\n***\n\nAfter.').html).toBe(
      'Before.<br /><br /><hr /><br /><br />After.',
    );
  });

  it('converts the spaced scene break', () => {
    expect(toRoyalRoadHtml('Before.\n\n* * *\n\nAfter.').html).toBe(
      'Before.<br /><br /><hr /><br /><br />After.',
    );
  });

  it('converts an underscore scene break', () => {
    expect(toRoyalRoadHtml('Before.\n\n___\n\nAfter.').html).toBe(
      'Before.<br /><br /><hr /><br /><br />After.',
    );
  });
});

describe('escaping', () => {
  it('escapes angle brackets so prose cannot inject markup', () => {
    const { html } = toRoyalRoadHtml('The ward held at <b>threshold</b> & held.');

    expect(html).toBe('The ward held at &lt;b&gt;threshold&lt;/b&gt; &amp; held.');
  });

  it('escapes ampersands before anything else', () => {
    // Escaping in the wrong order turns `&lt;` into `&amp;lt;` and shows the author
    // their own escape sequence.
    expect(toRoyalRoadHtml('salt & pepper').html).toBe('salt &amp; pepper');
  });
});

describe('Royal Road output constraints', () => {
  it('emits no class attributes', () => {
    const { html } = toRoyalRoadHtml('# Heading\n\nA **bold** line.\n\n* * *\n\nAnother.');

    expect(html).not.toMatch(/class=/i);
  });

  it('emits no text-indent, because Royal Road never indents a first line', () => {
    const { html } = toRoyalRoadHtml('First.\n\nSecond.');

    expect(html).not.toMatch(/text-indent/i);
    expect(html).not.toMatch(/<p\b/i);
  });

  it('emits no leading whitespace on its output', () => {
    const { html } = toRoyalRoadHtml('   Indented source line.\n\nSecond.');

    expect(html).not.toMatch(/^\s/);
  });
});

describe('constructs that cannot be translated', () => {
  it('reports a markdown heading and leaves it visible rather than dropping it', () => {
    const { html, warnings } = toRoyalRoadHtml('## Chapter Twelve');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/markdown heading/i);
    // The text survives so the author can see and fix it.
    expect(html).toBe('## Chapter Twelve');
  });

  it('reports list items', () => {
    expect(toRoyalRoadHtml('- first\n- second').warnings[0]).toMatch(/markdown list item/i);
  });

  it('reports blockquotes', () => {
    expect(toRoyalRoadHtml('> remembered').warnings[0]).toMatch(/markdown blockquote/i);
  });

  it('reports markdown links', () => {
    expect(toRoyalRoadHtml('see [the docs](https://example.invalid)').warnings[0]).toMatch(
      /markdown link/i,
    );
  });

  it('reports markdown images rather than dropping them', () => {
    const { warnings } = toRoyalRoadHtml('![a map](https://example.invalid/map.png)');

    expect(warnings[0]).toMatch(/markdown image/i);
  });

  it('reports inline code', () => {
    expect(toRoyalRoadHtml('call `render()` first').warnings[0]).toMatch(/inline code/i);
  });

  it('reports a fenced code block', () => {
    expect(toRoyalRoadHtml('```\nplain()\n```').warnings[0]).toMatch(/fenced code block/i);
  });

  it('reports every distinct offending line, since each is its own fix', () => {
    const { warnings } = toRoyalRoadHtml('- one\n- two\n- three\n- four');

    expect(warnings).toHaveLength(4);
  });

  it('collapses a repeated identical construct', () => {
    // The same wrong line pasted twice is one thing to fix, not two.
    const { warnings } = toRoyalRoadHtml('## Twelve\n\ntext\n\n## Twelve');

    expect(warnings).toHaveLength(1);
  });

  it('truncates a long offending line so the preview stays readable', () => {
    const { warnings } = toRoyalRoadHtml(`- ${'word '.repeat(40)}`);

    expect(warnings[0]!.length).toBeLessThan(90);
  });
});

describe('a realistic chapter fragment', () => {
  it('converts prose, emphasis, a scene break and a line break in one pass', () => {
    const source = [
      'Kael pressed his palm to the **ward** and it *held*.',
      'Not for long.',
      '',
      'The third seal broke with a sound like glass.',
      '',
      '***',
      '',
      'He ran.',
    ].join('\n');

    const { html, warnings } = toRoyalRoadHtml(source);

    expect(html).toBe(
      'Kael pressed his palm to the <b>ward</b> and it <i>held</i>.<br />' +
        'Not for long.<br /><br />' +
        'The third seal broke with a sound like glass.<br /><br />' +
        '<hr /><br /><br />' +
        'He ran.',
    );
    expect(warnings).toEqual([]);
  });
});