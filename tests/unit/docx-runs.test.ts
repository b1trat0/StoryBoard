import { describe, expect, it } from 'vitest';
import { parseRoyalRoadInlines } from '../../electron/lib/docx-runs.js';
import { FORMATTING_GROUPS } from '../../src/features/export/formatting-examples.js';

/**
 * The `.docx` writer gets its emphasis by reading the converter's HTML.
 *
 * Royal Road's bulk import turns a Word document's headings into chapter titles, so
 * the formatting the author wrote has to survive as real bold/italic/strikethrough
 * rather than as literal asterisks. That means turning `<b>`, `<i>` and `<s>` back
 * into runs, and this is the only place that happens.
 *
 * It is a tokenizer over a closed tag set, not an HTML parser, and these tests are
 * what hold it to that. The tag set is exactly what `toRoyalRoadParagraphs` emits; if
 * the converter grows a tag, the unknown-tag case below fails rather than silently
 * shipping the author's markup as visible text.
 */

describe('emphasis becomes runs', () => {
  it('reads bold', () => {
    expect(parseRoyalRoadInlines('<b>bold</b>')).toEqual([
      { kind: 'run', text: 'bold', isBold: true, isItalic: false, isStrike: false },
    ]);
  });

  it('reads italic', () => {
    expect(parseRoyalRoadInlines('<i>italic</i>')).toEqual([
      { kind: 'run', text: 'italic', isBold: false, isItalic: true, isStrike: false },
    ]);
  });

  it('reads strikethrough', () => {
    expect(parseRoyalRoadInlines('<s>struck</s>')).toEqual([
      { kind: 'run', text: 'struck', isBold: false, isItalic: false, isStrike: true },
    ]);
  });

  it('keeps nested emphasis as one run carrying both flags', () => {
    // The converter emits `<b><i>both</i></b>` for `***both***`. Splitting this into
    // two paragraphs in Word would be visible to the author on every screen.
    expect(parseRoyalRoadInlines('<b><i>both</i></b>')).toEqual([
      { kind: 'run', text: 'both', isBold: true, isItalic: true, isStrike: false },
    ]);
  });

  it('leaves plain text unformatted', () => {
    expect(parseRoyalRoadInlines('just words')).toEqual([
      { kind: 'run', text: 'just words', isBold: false, isItalic: false, isStrike: false },
    ]);
  });

  it('merges neighbouring text that shares formatting', () => {
    // The converter emits one run per line, so `plain <b>bold</b>` arrives as two
    // text runs. Word renders a run boundary as nothing, but keeping them apart would
    // make the generated file harder to read in any diff.
    expect(parseRoyalRoadInlines('plain <b>bold</b>')).toEqual([
      { kind: 'run', text: 'plain ', isBold: false, isItalic: false, isStrike: false },
      { kind: 'run', text: 'bold', isBold: true, isItalic: false, isStrike: false },
    ]);
  });
});

describe('spacing and scene breaks', () => {
  it('reads a line break', () => {
    expect(parseRoyalRoadInlines('This line<br />and this one.')).toEqual([
      { kind: 'run', text: 'This line', isBold: false, isItalic: false, isStrike: false },
      { kind: 'lineBreak' },
      { kind: 'run', text: 'and this one.', isBold: false, isItalic: false, isStrike: false },
    ]);
  });

  it('reads a scene break', () => {
    expect(parseRoyalRoadInlines('<hr />')).toEqual([{ kind: 'sceneBreak' }]);
  });

  it('returns nothing for empty text', () => {
    expect(parseRoyalRoadInlines('')).toEqual([]);
  });
});

describe('escapes are decoded back to the characters the author typed', () => {
  it('decodes an ampersand', () => {
    expect(parseRoyalRoadInlines('Tom &amp; Jerry')).toEqual([
      { kind: 'run', text: 'Tom & Jerry', isBold: false, isItalic: false, isStrike: false },
    ]);
  });

  it('decodes angle brackets rather than treating them as markup', () => {
    // `A &lt; B` is prose. If this came back as a tag the author's words would be
    // silently deleted from the exported file.
    expect(parseRoyalRoadInlines('A &lt; B')).toEqual([
      { kind: 'run', text: 'A < B', isBold: false, isItalic: false, isStrike: false },
    ]);
  });

  it('decodes entities inside formatted text', () => {
    expect(parseRoyalRoadInlines('<b>Tom &amp; Jerry</b>')).toEqual([
      { kind: 'run', text: 'Tom & Jerry', isBold: true, isItalic: false, isStrike: false },
    ]);
  });
});

describe('malformed input is refused rather than guessed at', () => {
  it('rejects a closing tag with nothing open', () => {
    expect(() => parseRoyalRoadInlines('text</b>')).toThrow(/closing <\/b>/);
  });

  it('rejects a tag left open', () => {
    expect(() => parseRoyalRoadInlines('<b>text')).toThrow(/left open/);
  });

  it('rejects a tag the converter does not emit', () => {
    // The whole safety of this module rests on the tag set being closed. An unknown
    // tag means the converter changed and this module is now behind it.
    expect(() => parseRoyalRoadInlines('<h1>Heading</h1>')).toThrow(/<h1>/);
  });
});

describe('every documented formatting example survives the tokenizer', () => {
  it.each(
    FORMATTING_GROUPS.flatMap((group) => group.examples.map((e) => [e.source, e.html])),
  )('%s', (_source, html) => {
    // The same data that proves the reference matches the HTML also proves the `.docx`
    // writer can read that HTML. A construct the author is told about and the export
    // cannot carry is worse than one that was never offered.
    expect(() => parseRoyalRoadInlines(html as string)).not.toThrow();
  });

  it('carries the emphasis the author was shown', () => {
    const inlines = parseRoyalRoadInlines('<b><i>both</i></b>');
    const run = inlines[0];

    expect(run.kind).toBe('run');
    expect(run).toMatchObject({ text: 'both', isBold: true, isItalic: true });
  });
});