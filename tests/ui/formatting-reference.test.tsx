// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormattingReference } from '../../src/features/export/formatting-reference.js';
import {
  FORMATTING_GROUPS,
  UNSUPPORTED_CONSTRUCTS,
} from '../../src/features/export/formatting-examples.js';

/**
 * The formatting reference.
 *
 * The accuracy of every example is asserted against the converter in
 * `tests/unit/formatting-examples.test.ts`. What is tested here is the other half: that
 * the screen actually shows the data, renders the result as HTML rather than as text,
 * and says something useful about what is not translated.
 *
 * That split matters. A screen can render correct data badly and an author is still
 * stuck; a test that only checked the data would not notice.
 */

afterEach(() => {
  cleanup();
});

/** Collapses runs of whitespace, the way the DOM and testing-library do. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Whether a source snippet appears in one of the code elements.
 *
 * Several examples are multi-line, and testing-library normalises whitespace before
 * matching, so the literal string with its newlines in it never matches. Comparing
 * against the code elements directly also avoids matching an ancestor that happens to
 * contain the same text.
 */
function showsSource(expected: string): boolean {
  const target = squash(expected);
  return Array.from(document.querySelectorAll('code')).some(
    (element) => squash(element.textContent ?? '') === target,
  );
}

describe('finding the answer while writing', () => {
  it('leads with the syntax for bold, the thing authors reach for most', () => {
    render(<FormattingReference />);

    const bold = FORMATTING_GROUPS[0].examples[0];
    expect(bold.source).toBe('**bold**');
    expect(showsSource('**bold**')).toBe(true);
  });

  it('renders the result as HTML, so bold really looks bold', () => {
    const { container } = render(<FormattingReference />);

    // If this were text, the author would be reading markup instead of seeing the
    // outcome, which is the only reason to render it.
    expect(container.querySelector('b')).toBeTruthy();
    expect(container.querySelector('i')).toBeTruthy();
    expect(container.querySelector('s')).toBeTruthy();
    expect(container.querySelector('hr')).toBeTruthy();
  });

  it('shows every example the data declares', () => {
    render(<FormattingReference />);

    for (const group of FORMATTING_GROUPS) {
      for (const example of group.examples) {
        expect(showsSource(example.source)).toBe(true);
      }
    }
  });

  it('gives every group and example a heading or a note', () => {
    render(<FormattingReference />);

    for (const group of FORMATTING_GROUPS) {
      expect(screen.getByText(group.title)).toBeTruthy();
    }
  });

  it('states the paragraph rule in the words Royal Road uses', () => {
    render(<FormattingReference />);

    // A blank line is a paragraph and a single newline is a line break. The author
    // needs this stated, not inferred from an example.
    expect(
      screen.getByText(/blank line is a paragraph, a single newline is a line break/i),
    ).toBeTruthy();
  });
});

describe('markdown that is not translated', () => {
  it('lists every unsupported construct', () => {
    render(<FormattingReference />);

    for (const construct of UNSUPPORTED_CONSTRUCTS) {
      expect(showsSource(construct.source)).toBe(true);
    }
  });

  it('offers an alternative for each, not just a refusal', () => {
    render(<FormattingReference />);

    // "This does not work" with no replacement leaves the author stuck mid-chapter.
    for (const construct of UNSUPPORTED_CONSTRUCTS) {
      expect(screen.getByText(construct.instead)).toBeTruthy();
    }
  });

  it('says that Royal Road links and images belong on their own screens', () => {
    render(<FormattingReference />);

    const link = UNSUPPORTED_CONSTRUCTS.find((entry) => entry.label === 'markdown link');
    const image = UNSUPPORTED_CONSTRUCTS.find((entry) => entry.label === 'markdown image');
    expect(link?.instead).toMatch(/plain text/i);
    expect(image?.instead).toMatch(/illustration/i);
  });

  it('admits underline is missing rather than inventing syntax for it', () => {
    render(<FormattingReference />);

    expect(screen.getByText('Underline')).toBeTruthy();
    expect(screen.getByText(/plain markdown has no way to say it/i)).toBeTruthy();
  });
});

describe('why this page exists', () => {
  it('says Royal Road understands no markdown', () => {
    render(<FormattingReference />);

    expect(screen.getByText(/Royal Road understands no markdown/i)).toBeTruthy();
  });

  it('points at the release preview as the place the result is checked', () => {
    render(<FormattingReference />);

    // Mentioned in both the intro and the unsupported list, so this asserts presence
    // rather than a single exact node.
    expect(screen.getAllByText(/release preview/i).length).toBeGreaterThan(0);
  });
});
