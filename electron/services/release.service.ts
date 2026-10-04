import { buildChapterRelease } from '../lib/release-chapter.js';
import type { ChapterRelease } from '../lib/release-chapter.js';
import type { ChapterRepository } from '../repositories/chapter.repository.js';
import type { IllustrationRepository } from '../repositories/illustration.repository.js';
import { RuleViolationError } from './storyboard.service.js';

/**
 * Release preview.
 *
 * The first step of the export pipeline and the only one that writes nothing.
 * Every file the pipeline eventually produces comes from what this returns, so a
 * problem caught here is caught before the author uploads anything by hand to
 * Royal Road — which, per AGENTS.md, is the one step that cannot be undone or
 * scripted.
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
}

/**
 * Builds the release service.
 *
 * Takes the two repositories rather than the higher level services, because the
 * preview must read a chapter and its image slots as they are stored, not as any
 * single editing surface happens to have loaded them. It is a read of committed
 * data, not a view of someone's unsaved buffer.
 *
 * @param chapters - Chapter data access.
 * @param illustrations - Illustration slot data access.
 * @returns The release service.
 */
export function createReleaseService(
  chapters: ChapterRepository,
  illustrations: IllustrationRepository,
): ReleaseService {
  return {
    async previewChapter(input) {
      const chapter = await chapters.findById(input.chapterId);
      if (chapter === null) {
        throw new RuleViolationError('That chapter no longer exists, so there is nothing to preview.');
      }
      const slots = await illustrations.listByChapter(chapter.id);
      return buildChapterRelease(chapter, slots);
    },
  };
}