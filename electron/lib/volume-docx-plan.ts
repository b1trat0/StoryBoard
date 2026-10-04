import { buildChapterRelease, dedupeWarnings } from './release-chapter.js';
import type { ReleaseWarning } from './release-chapter.js';
import type { Chapter, Illustration } from '../ipc/contract.js';

/**
 * Deciding what goes into a volume's `.docx`.
 *
 * Royal Road's bulk import builds one chapter per `Heading 1` in the uploaded Word
 * file, and nothing in that pipeline reports a chapter that was left out. A volume
 * exported with a chapter missing uploads perfectly and publishes a serial with a
 * hole in it, which is why every exclusion and every dropped element is counted here
 * rather than discovered later.
 *
 * Pure, like the release preview it reuses. It reads committed chapters and knows
 * nothing about the docx library, the filesystem, or the author's unsaved buffer, so
 * every decision here is checkable on its own.
 *
 * The per-chapter warnings are not reimplemented. `buildChapterRelease` already knows
 * Royal Road's rules, and a second set of rules would drift from the first within a
 * release — the preview would clear a volume that the export then refused.
 */

/** A chapter that will be written, in the order it will appear. */
export interface PlannedDocxChapter {
  chapterId: string;
  title: string;
  /** Converted HTML paragraphs, in order. The writer turns these into Word runs. */
  paragraphs: string[];
}

/** A chapter left out of the document, with the reason stated for the author. */
export interface ExcludedChapter {
  chapterId: string;
  title: string;
  reason: string;
}

/** One volume, ready to be written. */
export interface VolumeDocxPlan {
  volumeId: string;
  volumeTitle: string;
  chapters: PlannedDocxChapter[];
  excluded: ExcludedChapter[];
  /** Problems that do not stop the export. */
  warnings: ReleaseWarning[];
  /** Problems that must be fixed before the file is worth writing. */
  blockers: ReleaseWarning[];
  paragraphCount: number;
  droppedImageCount: number;
  droppedNoteCount: number;
}

/** The outline shape the plan needs, kept narrower than the full outline tree. */
export interface VolumeOutlineNode {
  id: string;
  title: string;
  arcs: {
    id: string;
    ordinal: number;
    /** Only identity and order: the prose itself is loaded separately. */
    chapters: { id: string; ordinal: number }[];
  }[];
}

/** Everything read from the database to build one plan. */
export interface VolumeDocxSource {
  volumes: VolumeOutlineNode[];
  /** Chapter bodies for every chapter in `volumes`, in any order. */
  chapters: Chapter[];
}

/**
 * Warning codes that only make sense for a document that shows images.
 *
 * A `.docx` carries no images at all, so an unuploaded image or a missing alt text is
 * not a problem with this file. Blocking the export for it would refuse work over
 * something that cannot appear in the output, and the single-chapter preview is
 * already reporting it where it does matter.
 */
const IMAGE_ONLY_CODES: ReadonlySet<ReleaseWarning['code']> = new Set([
  'unuploaded_image',
  'missing_alt',
  'unknown_dimensions',
  'anchor_out_of_range',
]);

/**
 * Builds the document plan for one volume.
 *
 * @param source - The volume and the chapter bodies belonging to it.
 * @param slots - Illustration slots for those chapters, used only to count what a
 *   text-only document drops.
 * @returns The chapters in order, what was left out, and every problem found.
 */
export function planVolumeDocx(
  source: VolumeDocxSource,
  slots: readonly Illustration[],
): VolumeDocxPlan {
  const volume = source.volumes[0];
  if (volume === undefined) {
    throw new Error('planVolumeDocx was called with no volume to export.');
  }

  const byId = new Map(source.chapters.map((chapter) => [chapter.id, chapter]));
  const slotsByChapter = new Map<string, Illustration[]>();
  for (const slot of slots) {
    const existing = slotsByChapter.get(slot.chapterId);
    if (existing === undefined) {
      slotsByChapter.set(slot.chapterId, [slot]);
    } else {
      existing.push(slot);
    }
  }

  const chapters: PlannedDocxChapter[] = [];
  const excluded: ExcludedChapter[] = [];
  const allWarnings: ReleaseWarning[] = [];
  const blockers: ReleaseWarning[] = [];
  let droppedImageCount = 0;
  let droppedNoteCount = 0;

  for (const arc of [...volume.arcs].sort((left, right) => left.ordinal - right.ordinal)) {
    for (const summary of [...arc.chapters].sort((left, right) => left.ordinal - right.ordinal)) {
      const chapter = byId.get(summary.id);
      if (chapter === undefined) {
        throw new Error(
          `Chapter ${summary.id} is in the outline but its text could not be read. ` +
            'The export cannot continue with a volume it has only partly loaded.',
        );
      }

      const release = buildChapterRelease(chapter, slotsByChapter.get(chapter.id) ?? []);

      if (release.isExcluded) {
        excluded.push({
          chapterId: chapter.id,
          title: chapter.title,
          reason: release.exclusionReason ?? 'This chapter is not part of the main arc.',
        });
        continue;
      }

      for (const warning of release.warnings) {
        if (IMAGE_ONLY_CODES.has(warning.code)) {
          continue;
        }
        allWarnings.push(warning);
        if (warning.severity === 'blocker') {
          blockers.push(warning);
        }
      }

      const paragraphs: string[] = [];
      let imageCount = 0;
      for (const block of release.blocks) {
        if (block.kind === 'image') {
          imageCount += 1;
          continue;
        }
        paragraphs.push(block.html);
      }

      if (imageCount > 0) {
        droppedImageCount += imageCount;
        allWarnings.push({
          code: 'dropped_image',
          severity: 'warning',
          message:
            `"${chapter.title}" has ${imageCount} illustration(s) that a .docx cannot carry. ` +
            'Royal Road shows them on the single-chapter path or through the .html export; ' +
            'this file is text only.',
        });
      }

      // Notes are counted per chapter, not per note: the author needs to know a
      // chapter had one, not that it had both a pre and a post note.
      if (release.preNoteHtml.trim() !== '' || release.postNoteHtml.trim() !== '') {
        droppedNoteCount += 1;
        allWarnings.push({
          code: 'dropped_author_note',
          severity: 'warning',
          message:
            `"${chapter.title}" has an author note that is not in this file. Royal Road's ` +
            'bulk import turns everything after a heading into chapter content, so notes are ' +
            'pasted into its own note fields by hand.',
        });
      }

      chapters.push({ chapterId: chapter.id, title: chapter.title, paragraphs });
    }
  }

  if (chapters.length === 0) {
    blockers.push({
      code: 'no_publishable_chapters',
      severity: 'blocker',
      message:
        `"${volume.title}" has no chapters that can be exported. Every chapter in it is ` +
        'either an outline or an interlude.',
    });
  }

  return {
    volumeId: volume.id,
    volumeTitle: volume.title,
    chapters,
    excluded,
    warnings: dedupeWarnings(allWarnings),
    blockers: dedupeWarnings(blockers),
    paragraphCount: chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0),
    droppedImageCount,
    droppedNoteCount,
  };
}