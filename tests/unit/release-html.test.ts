import { describe, expect, it } from 'vitest';
import { renderChapterBody, renderChapterDocument } from '../../electron/lib/release-html.js';
import type { ChapterRelease } from '../../electron/lib/release-chapter.js';

/**
 * The outgoing HTML.
 *
 * Royal Road strips class attributes and understands no stylesheet, so the file this
 * produces must carry neither. It also has to keep images in publication order and
 * keep the notes outside the prose, because the form puts them in separate boxes.
 */

function release(overrides: Partial<ChapterRelease> = {}): ChapterRelease {
  return {
    chapterId: '40000000-0000-4000-8000-000000000001',
    title: 'The Seal',
    preNoteHtml: '<p>Schedule note.</p>',
    blocks: [
      { kind: 'paragraph', html: '<p>First paragraph.</p>', paragraphIndex: 0 },
      {
        kind: 'image',
        imageHtml: '<img src="https://files.catbox.moe/a.png" width="900" height="600" alt="A seal">',
        captionHtml: '<p>Figure one.</p>',
        illustrationId: '55555555-5555-4555-8555-555555555555',
        afterParagraphIndex: 0,
        isMisplaced: false,
      },
      { kind: 'paragraph', html: '<p>Second paragraph.</p>', paragraphIndex: 1 },
    ],
    postNoteHtml: '<p>Thanks.</p>',
    wordCount: 4,
    isExcluded: false,
    exclusionReason: null,
    warnings: [],
    ...overrides,
  };
}

describe('the body fragment', () => {
  it('keeps notes, paragraphs and images in publication order', () => {
    const html = renderChapterBody(release());
    const order = [
      'Schedule note.',
      'First paragraph.',
      'files.catbox.moe/a.png',
      'Figure one.',
      'Second paragraph.',
      'Thanks.',
    ].map((needle) => html.indexOf(needle));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('omits an empty note instead of emitting an empty paragraph', () => {
    const html = renderChapterBody(release({ preNoteHtml: '', postNoteHtml: '' }));
    expect(html).not.toContain('<p></p>');
    expect(html.startsWith('<p>First paragraph.</p>')).toBe(true);
  });
});

describe('the exported document', () => {
  it('is a complete document with the title once', () => {
    const html = renderChapterDocument(release(), 'The Seal');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html.match(/The Seal/g)?.length).toBe(1);
  });

  it('carries no class attribute anywhere, because Royal Road strips them', () => {
    const html = renderChapterDocument(release(), 'The Seal');
    expect(html).not.toMatch(/\sclass=/i);
  });

  it('carries no stylesheet, so the file cannot disagree with the site', () => {
    const html = renderChapterDocument(release(), 'The Seal');
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle=/i);
  });
});
