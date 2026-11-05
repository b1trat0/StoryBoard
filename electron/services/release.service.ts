import { buildChapterRelease } from '../lib/release-chapter.js';
import type { ChapterRelease, ReleaseWarning } from '../lib/release-chapter.js';
import type { Chapter } from '../ipc/contract.js';
import { planVolumeDocx } from '../lib/volume-docx-plan.js';
import type { VolumeDocxPlan } from '../lib/volume-docx-plan.js';
import { renderVolumeDocx } from '../lib/docx-writer.js';
import { renderChapterDocument } from '../lib/release-html.js';
import { escapeHtmlText } from '../lib/html-escape.js';
import { toChapterHtmlFileName, toExportFileName } from '../lib/export-filename.js';
import type { ProjectRepository } from '../repositories/project.repository.js';
import type { ReleaseProfile } from '../lib/release-chapter.js';
import type { ChapterRepository } from '../repositories/chapter.repository.js';
import type { IllustrationRepository } from '../repositories/illustration.repository.js';
import type { OutlineRepository } from '../repositories/outline.repository.js';
import type { SaveFilePicker } from '../interfaces/file-dialog.interface.js';
import { RuleViolationError } from './storyboard.service.js';

/**
 * The export pipeline's only step that writes anything.
 *
 * The preview reads committed data and judges it. This reads the same committed data,
 * refuses the file outright when something would make it wrong, and then hands it to
 * the author through a save dialog. Royal Road has no API, so this file is the end of
 * the pipeline: the author uploads it by hand, and nothing after this point can check
 * what they do with it.
 *
 * Every read here is a read of what is stored. An unsaved editor buffer is never
 * exported, because the author would be reviewing one version in the preview and
 * uploading another.
 */

/** Preview of one chapter's publishable form. */
export interface ReleaseService {
  /**
   * Assembles what a chapter will look like once published.
   *
   * @param input - `chapterId` of the chapter to preview.
   * @returns The chapter's blocks, both author notes converted, and every problem
   *   found. Throws when the chapter does not exist.
   */
  previewChapter(input: { chapterId: string }): Promise<ChapterRelease>;

  /**
   * Writes one volume as a Word document for Royal Road's bulk import.
   *
   * @param input - `volumeId` of the volume to export.
   * @returns Where the file went and what it left out, or `cancelled` when the author
   *   closed the save dialog.
   * @throws When the volume does not exist, or when a blocker would make the file
   *   wrong. Nothing is written in either case.
   */
  exportVolumeDocx(input: { volumeId: string }): Promise<VolumeDocxExportResult>;

  /**
   * Writes one chapter as a standalone `.html` file.
   *
   * This is the only path where a hotlinked illustration is definitely preserved,
   * because Royal Road's form and its `.docx` import treat images differently.
   */
  exportChapterHtml(input: { chapterId: string }): Promise<ChapterHtmlExportResult>;
}

/** What a chapter `.html` export produced. */
export type ChapterHtmlExportResult =
  | { status: 'cancelled' }
  | {
      status: 'written';
      filePath: string;
      chapterTitle: string;
      bytes: number;
      warnings: ReleaseWarning[];
    };

/** What an export produced, or that the author declined to produce one. */
export type VolumeDocxExportResult =
  | { status: 'cancelled' }
  | {
      status: 'written';
      filePath: string;
      volumeTitle: string;
      chapterCount: number;
      excludedChapterCount: number;
      droppedImageCount: number;
      droppedNoteCount: number;
      warnings: ReleaseWarning[];
    };

/**
 * Builds the release service.
 *
 * Takes repositories rather than the higher level services, because both the preview
 * and the export must read what is stored rather than what any single editing surface
 * happens to have loaded.
 *
 * @param chapters - Chapter data access, shared with the editing surfaces.
 * @param illustrations - Illustration slot data access.
 * @param outline - Outline data access, for a volume's chapters in reading order.
 * @param saveFile - Where the exported document is written.
 * @returns The release service.
 */
export function createReleaseService(
  chapters: ChapterRepository,
  illustrations: IllustrationRepository,
  outline: OutlineRepository,
  saveFile: SaveFilePicker,
  projects?: ProjectRepository,
): ReleaseService {
  return {
    async previewChapter(input) {
      const chapter = await chapters.findById(input.chapterId);
      if (chapter === null) {
        throw new RuleViolationError('That chapter no longer exists, so there is nothing to preview.');
      }
      const slots = await illustrations.listByChapter(chapter.id);
      return buildChapterRelease(chapter, slots, {
        profile: await resolveProfile(chapter, outline, projects),
      });
    },

    async exportVolumeDocx(input) {
      const plan = await buildVolumePlan(input.volumeId, outline, chapters, illustrations);

      if (plan.blockers.length > 0) {
        throw new RuleViolationError(describeBlockers(plan));
      }

      const bytes = await renderVolumeDocx(plan);
      const saved = await saveFile.save({
        suggestedName: toExportFileName(plan.volumeTitle),
        bytes,
      });

      if (saved.status === 'cancelled') {
        return { status: 'cancelled' };
      }

      return {
        status: 'written',
        filePath: saved.filePath,
        volumeTitle: plan.volumeTitle,
        chapterCount: plan.chapters.length,
        excludedChapterCount: plan.excluded.length,
        droppedImageCount: plan.droppedImageCount,
        droppedNoteCount: plan.droppedNoteCount,
        warnings: plan.warnings,
      };
    },

    async exportChapterHtml(input) {
      const chapter = await chapters.findById(input.chapterId);
      if (chapter === null) {
        throw new RuleViolationError('That chapter no longer exists, so there is nothing to export.');
      }

      const slots = await illustrations.listByChapter(chapter.id);
      const release = buildChapterRelease(chapter, slots, {
        profile: await resolveProfile(chapter, outline, projects),
      });
      const html = renderChapterDocument(release, escapeHtmlText(chapter.title));
      const bytes = Buffer.from(html, 'utf8');

      const saved = await saveFile.save({
        suggestedName: toChapterHtmlFileName(chapter.title),
        bytes,
        kind: 'html',
      });

      if (saved.status === 'cancelled') {
        return { status: 'cancelled' };
      }

      return {
        status: 'written',
        filePath: saved.filePath,
        chapterTitle: chapter.title,
        bytes: bytes.byteLength,
        warnings: release.warnings,
      };
    },
  };
}

/**
 * Which publishing rules apply to a chapter.
 *
 * Walks chapter → arc → volume → work, because a chapter does not carry its project id
 * directly. Falls back to Royal Road when the chain is incomplete or no project
 * repository was supplied, so the strictest rules apply unless the work says otherwise.
 */
async function resolveProfile(
  chapter: Chapter,
  outline: OutlineRepository,
  projects: ProjectRepository | undefined,
): Promise<ReleaseProfile> {
  if (projects === undefined) {
    return 'royal_road';
  }

  const arc = await outline.findArcById(chapter.arcId);
  if (arc === null) {
    return 'royal_road';
  }
  const volume = await outline.findVolumeById(arc.volumeId);
  if (volume === null) {
    return 'royal_road';
  }
  const project = await projects.findById(volume.projectId);
  return project?.exportProfile ?? 'royal_road';
}

/**
 * Reads one volume and decides what its document should contain.
 *
 * The outline is read first because it is the only place that knows which chapters
 * belong to this volume and in what order. Chapter text is then fetched in one query
 * against that list rather than chapter by chapter, which would make a single export
 * one round trip per chapter.
 *
 * @param volumeId - The volume to export.
 * @param outline - Outline data access.
 * @param chapters - Chapter data access.
 * @param illustrations - Illustration slot data access.
 * @returns The plan, including every blocker that would make the file wrong.
 * @throws When the volume no longer exists.
 */
async function buildVolumePlan(
  volumeId: string,
  outline: OutlineRepository,
  chapters: ChapterRepository,
  illustrations: IllustrationRepository,
): Promise<VolumeDocxPlan> {
  const volume = await outline.findVolumeById(volumeId);
  if (volume === null) {
    throw new RuleViolationError(
      'That volume no longer exists, so there is nothing to export.',
    );
  }

  // The tree is read by project id, which the volume row carries.
  const tree = await outline.listTree(volume.projectId);
  const node = tree.volumes.find((entry) => entry.id === volume.id);
  if (node === undefined) {
    throw new RuleViolationError(
      'That volume no longer exists, so there is nothing to export.',
    );
  }

  const ids = node.arcs.flatMap((arc) => arc.chapters.map((chapter) => chapter.id));
  const bodies = await chapters.findByIds(ids);
  const slots = await Promise.all(ids.map((id) => illustrations.listByChapter(id)));

  return planVolumeDocx(
    { volumes: [{ id: node.id, title: node.title, arcs: node.arcs }], chapters: bodies },
    slots.flat(),
  );
}

/**
 * Explains every blocker at once.
 *
 * One blocker per attempt would send the author round the loop once per chapter, and a
 * volume of outline stubs would take twenty exports to discover what one screen could
 * have said.
 *
 * @param plan - The plan that was refused.
 * @returns A message naming each blocker.
 */
function describeBlockers(plan: VolumeDocxPlan): string {
  const lines = plan.blockers.map((warning) => `- ${warning.message}`);
  return (
    `${plan.volumeTitle} is not ready to export yet:\n\n${lines.join('\n')}\n\n` +
    'Nothing was written. Fix these and try again.'
  );
}