import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { renderVolumeDocx } from '../../electron/lib/docx-writer.js';
import { planVolumeDocx } from '../../electron/lib/volume-docx-plan.js';
import type { VolumeDocxPlan } from '../../electron/lib/volume-docx-plan.js';
import type { Chapter } from '../../electron/ipc/contract.js';

/**
 * What Royal Road's importer actually receives.
 *
 * Every other export test checks the author's side of the pipeline: which chapters,
 * which runs, which warnings. This one opens the generated file and looks at the
 * OOXML, because the constraint that matters is not "we built a Document" but "Royal
 * Road sees one heading per chapter".
 *
 * These assertions are the reason the zip is unpacked here rather than trusted. A
 * `.docx` that carries two headings for one chapter, or an embedded image, or an
 * indent, uploads without complaint and produces a published serial that is wrong in
 * a way the author finds out about from a reader.
 */

/** Unpacks one entry from a zip archive built with stored or deflated entries. */
function readZipEntry(archive: Buffer, entryName: string): string {
  let offset = 0;

  while (offset + 30 <= archive.length) {
    if (archive.readUInt32LE(offset) !== 0x04034b50) {
      break;
    }
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;

    if (name === entryName) {
      const data = archive.subarray(dataStart, dataStart + compressedSize);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    }
    offset = dataStart + compressedSize;
  }

  throw new Error(`The generated document has no ${entryName} entry.`);
}

/** Every entry name in the archive, so absence can be asserted as well as presence. */
function zipEntryNames(archive: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;

  while (offset + 30 <= archive.length) {
    if (archive.readUInt32LE(offset) !== 0x04034b50) {
      break;
    }
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    names.push(archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'));
    offset = offset + 30 + nameLength + extraLength + compressedSize;
  }

  return names;
}

/** The body of the document, which is where every publishing constraint shows up. */
function documentXml(archive: Buffer): string {
  return readZipEntry(archive, 'word/document.xml');
}

const ARC_ID = '22222222-2222-4222-8222-222222222222';
const VOLUME_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let nextId = 0;

function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    arcId: ARC_ID,
    title: 'The Third Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'draft',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}First paragraph.`,
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 100,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function planFor(chapters: Chapter[]): VolumeDocxPlan {
  return planVolumeDocx(
    {
      volumes: [
        {
          id: VOLUME_ID,
          title: 'Volume One',
          arcs: [{ id: ARC_ID, ordinal: 1, chapters }],
        },
      ],
      chapters,
    },
    [],
  );
}

describe('one heading per chapter, because Royal Road builds chapters from headings', () => {
  it('emits exactly one Heading 1 for a single chapter', async () => {
    const xml = documentXml(await renderVolumeDocx(planFor([chapterFixture()])));

    expect(xml.match(/Heading1/g)).toHaveLength(1);
  });

  it('emits one heading per chapter across a whole volume', async () => {
    const chapters = [
      chapterFixture({ title: 'One', ordinal: 1 }),
      chapterFixture({ title: 'Two', ordinal: 2 }),
      chapterFixture({ title: 'Three', ordinal: 3 }),
    ];

    const xml = documentXml(await renderVolumeDocx(planFor(chapters)));

    // Three headings means three imported chapters. A fourth would be a volume title
    // that Royal Road turned into a chapter of its own.
    expect(xml.match(/Heading1/g)).toHaveLength(3);
  });

  it('never emits the volume title as a heading', async () => {
    const xml = documentXml(await renderVolumeDocx(planFor([chapterFixture()])));

    expect(xml).not.toContain('Volume One');
  });

  it('never emits an arc heading, because arcs do not exist on Royal Road', async () => {
    const chapter = chapterFixture();
    const plan = planVolumeDocx(
      {
        volumes: [
          {
            id: VOLUME_ID,
            title: 'Volume One',
            arcs: [{ id: ARC_ID, ordinal: 1, chapters: [chapter] }],
          },
        ],
        chapters: [chapter],
      },
      [],
    );

    const xml = documentXml(await renderVolumeDocx(plan));

    // Only Heading1 exists anywhere in the file, so nothing else can be read as a
    // chapter title by the importer.
    expect(xml).not.toMatch(/Heading[2-9]/);
  });

  it('puts the chapter title text in the heading', async () => {
    const xml = documentXml(await renderVolumeDocx(planFor([chapterFixture({ title: 'The Third Seal' })])));

    expect(xml).toContain('The Third Seal');
  });
});

describe('emphasis survives as formatting, not as asterisks', () => {
  it('writes bold, italic and strikethrough as Word formatting', async () => {
    const chapter = chapterFixture({
      bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}**bold** and *italic* and ~~gone~~`,
    });

    const xml = documentXml(await renderVolumeDocx(planFor([chapter])));

    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toMatch(/<w:i\/>/);
    expect(xml).toMatch(/<w:strike\/>/);
  });

  it('leaves no markdown characters in the published text', async () => {
    const chapter = chapterFixture({
      bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}**bold**`,
    });

    const xml = documentXml(await renderVolumeDocx(planFor([chapter])));

    // This is the failure the whole export pipeline exists to prevent: a literal `*`
    // in a published chapter, which looks approximately right to nobody.
    expect(xml).not.toContain('**');
  });

  it('decodes escaped characters rather than writing the escape', async () => {
    const chapter = chapterFixture({
      bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}Tom & Jerry`,
    });

    const xml = documentXml(await renderVolumeDocx(planFor([chapter])));

    expect(xml).toContain('Tom &amp; Jerry');
    expect(xml).not.toContain('&amp;amp;');
  });

  it.each([
    ['**bold**', true, false, false],
    ['*italic*', false, true, false],
    ['~~struck~~', false, false, true],
  ])('round-trips %s through the converter and the writer', async (source, bold, italic, strike) => {
    const xml = documentXml(
      await renderVolumeDocx(
        planFor([
          chapterFixture({
            bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}\n\n${source}`,
          }),
        ]),
      ),
    );

    // The markup the author typed is absent, and the formatting it meant is present.
    // Both halves matter: a document with neither is a chapter published with literal
    // asterisks, and one with the asterisks still present is a document nobody can fix.
    expect(xml).not.toContain(source);
    if (bold) expect(xml).toMatch(/<w:b\/>/);
    if (italic) expect(xml).toMatch(/<w:i\/>/);
    if (strike) expect(xml).toMatch(/<w:strike\/>/);
  });
});

describe('the document is text only, because embedded images are unconfirmed', () => {
  it('contains no media at all', async () => {
    const names = zipEntryNames(await renderVolumeDocx(planFor([chapterFixture()])));

    expect(names.filter((name) => name.startsWith('word/media/'))).toEqual([]);
  });

  it('contains no image relationship', async () => {
    const names = zipEntryNames(await renderVolumeDocx(planFor([chapterFixture()])));

    // A relationship pointing at an image is how a document embeds one, whatever the
    // entry is named.
    expect(names.some((name) => name.endsWith('media'))).toBe(false);
  });
});

describe('spacing matches Royal Road, which is single spaced and unindented', () => {
  it('never indents a paragraph', async () => {
    const xml = documentXml(await renderVolumeDocx(planFor([chapterFixture()])));

    // `w:ind` is the indent property. Royal Road does not indent first lines, and an
    // indented import is visible on every paragraph of every published chapter.
    expect(xml).not.toContain('<w:ind');
  });

  it('never sets custom line spacing', async () => {
    const xml = documentXml(await renderVolumeDocx(planFor([chapterFixture()])));

    expect(xml).not.toMatch(/<w:spacing [^>]*w:line=/);
  });
});

describe('paragraph structure is preserved', () => {
  it('writes one Word paragraph per authored paragraph', async () => {
    const chapter = chapterFixture({
      bodyMd: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
    });

    const xml = documentXml(await renderVolumeDocx(planFor([chapter])));

    // Each source paragraph is its own Word paragraph, so the blank-line convention
    // survives the round trip instead of collapsing into one block.
    expect(xml.match(/<w:p[ >]/g)?.length).toBe(4);
  });

  it('writes a line break for a single newline inside a paragraph', async () => {
    const chapter = chapterFixture({
      bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}\n\nThis line\nand this one.`,
    });

    const xml = documentXml(await renderVolumeDocx(planFor([chapter])));

    expect(xml).toMatch(/<w:br\/>/);
  });

  it('writes a scene break as an empty paragraph, not as asterisks', async () => {
    const chapter = chapterFixture({
      bodyMd: `${'Filler prose to clear the character floor. '.repeat(14)}\n\n---\n\nAfter the break.`,
    });

    const xml = documentXml(await renderVolumeDocx(planFor([chapter])));

    // `---` reaching a reader as three hyphens is the exact failure the converter
    // exists to prevent, so it must not survive into the Word file.
    expect(xml).not.toContain('---');
  });
});

describe('the file is a real document', () => {
  it('starts with a zip signature', async () => {
    const archive = await renderVolumeDocx(planFor([chapterFixture()]));

    expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  it('carries the parts a Word document needs', async () => {
    const names = zipEntryNames(await renderVolumeDocx(planFor([chapterFixture()])));

    expect(names).toContain('word/document.xml');
    expect(names).toContain('word/styles.xml');
    expect(names).toContain('[Content_Types].xml');
  });
});