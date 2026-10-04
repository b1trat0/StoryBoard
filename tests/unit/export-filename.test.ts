import { describe, expect, it } from 'vitest';
import { toExportFileName } from '../../electron/lib/export-filename.js';

/**
 * Volume titles are author prose, and they end up as filenames on the author's disk.
 *
 * Windows rejects `< > : " / \ | ? *` and control characters outright, refuses a name
 * ending in a dot or a space, and reserves a handful of device names. A title like
 * `Book One: The Seal` is perfectly reasonable prose and a perfectly invalid filename,
 * and the failure surfaces as an error dialog at the moment the author has committed
 * to exporting, which is the worst time to find out.
 *
 * The volume title is not the place this belongs either. Royal Road's bulk import
 * turns document headings into chapter titles, so the only volume-level label in this
 * pipeline is the filename.
 */

describe('a usable title becomes the filename unchanged', () => {
  it('keeps ordinary words', () => {
    expect(toExportFileName('Volume One')).toBe('Volume One.docx');
  });

  it('keeps digits, apostrophes and accents', () => {
    expect(toExportFileName("Ash'grave, Volume 2")).toBe("Ash'grave, Volume 2.docx");
  });

  it('collapses surrounding whitespace', () => {
    expect(toExportFileName('  Volume One  ')).toBe('Volume One.docx');
  });
});

describe('characters Windows refuses are replaced rather than passed through', () => {
  it('replaces a colon', () => {
    expect(toExportFileName('Book One: The Seal')).toBe('Book One The Seal.docx');
  });

  it('replaces every forbidden character', () => {
    expect(toExportFileName('a<b>c|d?e*f"g\\h/i')).toBe('a b c d e f g h i.docx');
  });

  it('replaces control characters', () => {
    expect(toExportFileName('Volume\u0000One\u0007')).toBe('Volume One.docx');
  });

  it('trims the trailing dots and spaces Windows silently strips', () => {
    expect(toExportFileName('Volume One. ')).toBe('Volume One.docx');
  });

  it('never produces a name that is only an extension', () => {
    // A title of pure punctuation would otherwise save as `.docx`, which Windows
    // treats as having no name at all.
    expect(toExportFileName('...')).toBe('untitled volume.docx');
  });

  it('falls back when the title has nothing usable in it', () => {
    expect(toExportFileName('   ')).toBe('untitled volume.docx');
  });
});

describe('Windows device names are not used', () => {
  it('renames a reserved name', () => {
    expect(toExportFileName('CON')).toBe('_CON.docx');
  });

  it('renames a reserved name used as a prefix', () => {
    expect(toExportFileName('NUL volume')).toBe('_NUL volume.docx');
  });

  it('leaves a name that only contains a reserved word', () => {
    expect(toExportFileName('The Conclave')).toBe('The Conclave.docx');
  });
});

describe('the name stays inside what a filesystem accepts', () => {
  it('truncates a title far longer than any filesystem allows', () => {
    const name = toExportFileName('A'.repeat(400));

    expect(name.length).toBeLessThanOrEqual(255);
    expect(name.endsWith('.docx')).toBe(true);
  });

  it('always ends in the extension, exactly once', () => {
    expect(toExportFileName('Volume One').match(/\.docx$/g)).toHaveLength(1);
  });
});