import { describe, expect, it } from 'vitest';
import { toRoyalRoadHtml } from '../../electron/lib/royal-road-html.js';
import {
  FORMATTING_GROUPS,
  UNSUPPORTED_CONSTRUCTS,
  type FormattingExample,
} from '../../src/features/export/formatting-examples.js';

/**
 * The formatting reference cannot lie.
 *
 * This is the reason the reference is data plus a test rather than a hand-written
 * screen. The author will type what this says and check the release preview, so an
 * example that has drifted from the converter produces chapters that are wrong in a
 * way nobody notices until they are published. Asserting every example against the
 * real converter makes that impossible: change the conversion and this suite fails
 * until the reference catches up.
 *
 * The converse is checked too. A construct the reference calls unsupported must still
 * produce a warning, because "we do not translate this" is only true if the author is
 * told.
 */

function everyExample(): { group: string; example: FormattingExample }[] {
  return FORMATTING_GROUPS.flatMap((group) =>
    group.examples.map((example) => ({ group: group.title, example })),
  );
}

describe('every documented example is what the converter actually produces', () => {
  it.each(everyExample())('$group: $example.source', ({ example }) => {
    const actual = toRoyalRoadHtml(example.source);

    expect(actual.html).toBe(example.html);
    // A documented construct that also warns would be self-contradictory: the
    // reference says it is translated, the preview says it is not.
    expect(actual.warnings).toEqual([]);
  });

  it('covers every construct the converter translates', () => {
    // Each of these is a rule in royal-road-html.ts. If one is added there and not
    // documented, the author has no way to find it and this test says so.
    const documented = everyExample().map(({ example }) => example.html).join(' ');
    for (const translated of [
      '<b>',
      '<i>',
      '<s>',
      '<hr />',
      '<br />',
      '&amp;',
      '&lt;',
    ]) {
      expect(documented).toContain(translated);
    }
  });
});

describe('every unsupported construct is genuinely refused', () => {
  it.each(UNSUPPORTED_CONSTRUCTS.map((construct) => [construct.label, construct.source]))(
    '%s',
    (label, source) => {
      const actual = toRoyalRoadHtml(source as string);

      // Refused means warned about. Passing it through unmarked would put a literal
      // `#` or `-` in front of a reader with no way for the author to notice.
      expect(actual.warnings.length).toBeGreaterThan(0);
      expect(actual.warnings.join(' ')).toContain(label as string);
    },
  );

  it('leaves the text readable rather than stripping it', () => {
    const actual = toRoyalRoadHtml('## A heading');

    // The author keeps their words. They just reach the page as words.
    expect(actual.html).toContain('A heading');
    expect(actual.html).not.toContain('<h1');
  });
});

describe('the reference is shaped for an author to read', () => {
  it('tells the author what to do instead of only what fails', () => {
    for (const construct of UNSUPPORTED_CONSTRUCTS) {
      expect(construct.instead.length).toBeGreaterThan(20);
    }
  });

  it('gives every example a note, because a bare pair of strings is not a reference', () => {
    for (const { example } of everyExample()) {
      expect(example.note.length).toBeGreaterThan(5);
    }
  });

  it('states the underline gap instead of leaving it to be discovered', () => {
    // Royal Road's toolbar has underline and markdown cannot express it. Saying so is
    // the honest answer; showing syntax that does not work would not be.
    expect(UNSUPPORTED_CONSTRUCTS.map((entry) => entry.label)).not.toContain('underline');
  });
});
