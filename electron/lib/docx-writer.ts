import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { parseRoyalRoadInlines } from './docx-runs.js';
import type { DocxParagraphPart } from './docx-runs.js';
import type { PlannedDocxChapter, VolumeDocxPlan } from './volume-docx-plan.js';

/**
 * Writing a volume as a Word document for Royal Road's bulk import.
 *
 * Everything here is dictated by one verified fact: Royal Road builds one chapter per
 * `Heading 1` in the uploaded file. So this writer emits exactly one heading per
 * chapter and nothing else that could be read as a heading. The volume title is
 * deliberately absent — a heading for it would create a chapter that does not exist,
 * and arc boundaries do not exist on Royal Road at all.
 *
 * The other constraints come from the same place. Images are never embedded, because
 * whether they survive an import is unconfirmed and `.html` is the only format where a
 * hotlinked image is definitely preserved. Paragraphs carry no indent and no extra
 * line spacing, because Royal Road is single-spaced and does not indent first lines.
 *
 * The docx library is confined to this file. The plan and the runs are plain data, so
 * the decisions that affect the author's book are tested without a zip archive.
 */

/**
 * Word's own heading style for a chapter title.
 *
 * Not `HEADING_2`: Royal Road maps document headings to chapter titles, and only the
 * top level is a chapter. Anything else is a section inside a chapter that the author
 * did not write.
 */
const CHAPTER_HEADING = HeadingLevel.HEADING_1;

/**
 * Builds the `.docx` for one planned volume.
 *
 * @param plan - The volume, its chapters in order, and what was excluded.
 * @returns The packed Word file.
 */
export async function renderVolumeDocx(plan: VolumeDocxPlan): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: plan.chapters.flatMap(buildChapter),
      },
    ],
  });

  return Packer.toBuffer(document);
}

/**
 * Turns one chapter into the paragraphs that represent it.
 *
 * A heading, then the body. The author's own paragraph breaks become Word paragraphs,
 * because that is the boundary Royal Road will read back as prose structure rather
 * than as one run-on block.
 *
 * @param chapter - One planned chapter.
 * @returns The heading and body paragraphs, in order.
 */
function buildChapter(chapter: PlannedDocxChapter): Paragraph[] {
  return [
    new Paragraph({ text: chapter.title, heading: CHAPTER_HEADING }),
    ...chapter.paragraphs.flatMap(buildBodyParagraphs),
  ];
}

/**
 * Converts one source paragraph into Word paragraphs.
 *
 * Usually that is exactly one paragraph. It becomes two when the author put a scene
 * break inside the paragraph rather than on its own line: the break becomes an empty
 * paragraph, which is the closest Word has to a horizontal rule and keeps the author's
 * asterisks out of the published text.
 *
 * @param html - One converted paragraph from the release preview.
 * @returns The Word paragraphs it becomes.
 * @throws When the converter emitted markup this module cannot read.
 */
function buildBodyParagraphs(html: string): Paragraph[] {
  const groups: DocxParagraphPart[][] = [[]];

  for (const inline of parseRoyalRoadInlines(html)) {
    if (inline.kind === 'sceneBreak') {
      // An empty paragraph on its own, so the break is visible in Word without
      // printing characters the author would then have to delete. Starting a new group
      // both emits the blank line and keeps the break out of the surrounding runs.
      groups.push([]);
      continue;
    }
    const current = groups[groups.length - 1];
    if (current !== undefined) {
      current.push(inline);
    }
  }

  return groups.map((group) => new Paragraph({ children: group.map(buildChild) }));
}

/**
 * Maps one piece of a paragraph to its Word equivalent.
 *
 * @param inline - A run or a line break. Scene breaks never reach here; they become
 *   paragraph boundaries instead.
 * @returns The `TextRun` for it.
 */
function buildChild(inline: DocxParagraphPart): TextRun {
  if (inline.kind === 'lineBreak') {
    return new TextRun({ break: 1 });
  }
  return new TextRun({
    text: inline.text,
    bold: inline.isBold,
    italics: inline.isItalic,
    strike: inline.isStrike,
  });
}