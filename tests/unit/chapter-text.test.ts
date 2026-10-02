import { describe, expect, it } from 'vitest';
import {
  countParagraphs,
  countWords,
  splitParagraphs,
} from '../../electron/lib/chapter-text.js';

/**
 * These counts decide where an illustration lands and what a chapter reports as
 * its length, so the rules are pinned here rather than left to a regex nobody
 * re-reads. The author writes in plain markdown separated by blank lines; the
 * helpers match that and nothing more.
 */

describe('countWords', () => {
  it('counts a single word', () => {
    expect(countWords('word')).toBe(1);
  });

  it('returns zero for empty prose', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns zero for whitespace only', () => {
    expect(countWords('   \n\n\t  ')).toBe(0);
  });

  it('counts separated words', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('treats newlines as separators so paragraphs do not merge', () => {
    expect(countWords('one\ntwo')).toBe(2);
  });

  it('collapses runs of whitespace', () => {
    expect(countWords('one   \t  two')).toBe(2);
  });

  it('ignores leading and trailing whitespace', () => {
    expect(countWords('  one two  ')).toBe(2);
  });

  it('counts markdown emphasis markers as part of the word', () => {
    // Slight over-report is deliberate: an under-reported chapter is a silent
    // lie, an over-reported one shows up as odd formatting.
    expect(countWords('**bold**')).toBe(1);
  });
});

describe('splitParagraphs', () => {
  it('returns one paragraph for a single block', () => {
    expect(splitParagraphs('Only one.')).toEqual(['Only one.']);
  });

  it('splits on a blank line', () => {
    expect(splitParagraphs('First.\n\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('handles more than one blank line between paragraphs', () => {
    expect(splitParagraphs('First.\n\n\n\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('handles Windows line endings', () => {
    expect(splitParagraphs('First.\r\n\r\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('handles mixed line endings', () => {
    expect(splitParagraphs('First.\r\n\r\nSecond.\n\nThird.')).toEqual([
      'First.',
      'Second.',
      'Third.',
    ]);
  });

  it('keeps single newlines inside one paragraph', () => {
    expect(splitParagraphs('Line one\nline two.')).toEqual(['Line one\nline two.']);
  });

  it('trims each paragraph', () => {
    expect(splitParagraphs('  First.  \n\n  Second.  ')).toEqual(['First.', 'Second.']);
  });

  it('discards empty paragraphs from leading blank lines', () => {
    expect(splitParagraphs('\n\n\nFirst.')).toEqual(['First.']);
  });

  it('discards empty paragraphs from trailing blank lines', () => {
    expect(splitParagraphs('First.\n\n\n')).toEqual(['First.']);
  });

  it('treats a blank line of spaces as a separator', () => {
    expect(splitParagraphs('First.\n   \nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('returns nothing for empty prose', () => {
    expect(splitParagraphs('')).toEqual([]);
  });

  it('returns nothing for whitespace only', () => {
    expect(splitParagraphs('  \n\n \t ')).toEqual([]);
  });
});

describe('countParagraphs', () => {
  it('is zero for empty prose', () => {
    expect(countParagraphs('')).toBe(0);
  });

  it('counts one paragraph', () => {
    expect(countParagraphs('Just this.')).toBe(1);
  });

  it('counts three paragraphs', () => {
    expect(countParagraphs('One.\n\nTwo.\n\nThree.')).toBe(3);
  });

  it('does not count trailing blank lines as a paragraph', () => {
    // This is the case that matters for anchors: a chapter ending in a blank
    // line must not report an extra paragraph and strand its last image slot.
    expect(countParagraphs('One.\n\nTwo.\n\n')).toBe(2);
  });

  it('agrees with splitParagraphs length', () => {
    const body = 'One.\n\nTwo.\n\n\nThree.\n\n';
    expect(countParagraphs(body)).toBe(splitParagraphs(body).length);
  });
});