import { countParagraphs, countWords } from '../lib/chapter-text.js';
import { ImageUploadError } from '../interfaces/catbox.interface.js';
import type { ImageHost } from '../interfaces/catbox.interface.js';
import type { ChapterRepository } from '../repositories/chapter.repository.js';
import type { GlossaryRepository, SaveGlossaryTermInput } from '../repositories/glossary.repository.js';
import type { IllustrationRepository } from '../repositories/illustration.repository.js';
import type {
  Chapter,
  CreateChapterInput,
  CreateIllustrationSlotRequest,
  GlossaryKind,
  GlossaryTerm,
  Illustration,
  SaveChapterProseRequest,
  SaveChapterOutlineRequest,
} from '../ipc/contract.js';
import { RuleViolationError } from './storyboard.service.js';

/**
 * Business rules for chapters, illustrations and the glossary.
 *
 * The one rule that matters most here is the illustration anchor. Anchoring to a
 * paragraph index survives edits above the image but breaks when paragraphs are
 * removed. When that happens the slot is reported, never silently moved: the
 * author decides where the image belongs.
 */

export interface ChapterService {
  listByArc(input: { arcId: string }): Promise<Chapter[]>;
  create(input: CreateChapterInput): Promise<Chapter>;
  remove(input: { id: string }): Promise<void>;
  saveProse(input: SaveChapterProseRequest): Promise<Chapter>;
  saveOutline(input: SaveChapterOutlineRequest): Promise<Chapter>;
}

export function createChapterService(repo: ChapterRepository): ChapterService {
  return {
    listByArc: (input) => repo.listByArc(input.arcId),

    /**
     * New chapters start as an outline with no prose, which is the state an author
     * creates them in. The status is not inferred from anything: an author who wants
     * a draft labelled as such sets it.
     */
    async create(input) {
      const title = input.title.trim();
      if (title.length === 0) {
        throw new RuleViolationError('Give the chapter a title first.');
      }
      return repo.create({ ...input, title });
    },

    async remove(input) {
      const existing = await repo.findById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That chapter no longer exists.');
      }
      await repo.remove(input.id);
    },

    /**
     * word_count is derived here rather than by the renderer, because the value
     * is shown in the outline and in export previews and must agree everywhere.
     */
    async saveProse(input) {
      // The prose save needs the same guard as the outline save. Without it the
      // update matches no rows and the driver surfaces "Chapter <uuid> was not
      // found", which is both a confusing message and one that leaks an internal
      // identifier to the author.
      const existing = await repo.findById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That chapter no longer exists, so nothing was saved.');
      }
      return repo.saveProse(input, countWords(input.bodyMd));
    },

    async saveOutline(input) {
      const existing = await repo.findById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That chapter no longer exists.');
      }
      return repo.saveOutline(input);
    },
  };
}

export interface IllustrationService {
  listByChapter(input: { chapterId: string }): Promise<Illustration[]>;
  createSlot(input: CreateIllustrationSlotRequest): Promise<Illustration>;
  updateSlot(input: {
    id: string;
    afterParagraphIndex: number;
    altText: string;
    caption?: string;
  }): Promise<Illustration>;
  uploadToHost(input: { id: string }): Promise<Illustration>;
  /**
   * Slots whose anchor is past the end of the chapter's current prose. These
   * are the ones an export would drop or misplace, so the editor surfaces them.
   */
  findOrphanedSlots(input: {
    chapterId: string;
    paragraphCount: number;
  }): Promise<Illustration[]>;
}

export function createIllustrationService(
  repo: IllustrationRepository,
  chapters: ChapterRepository,
  host: ImageHost,
): IllustrationService {
  return {
    listByChapter: (input) => repo.listByChapter(input.chapterId),

    async createSlot(input) {
      const chapter = await chapters.findById(input.chapterId);
      if (chapter === null) {
        throw new RuleViolationError('That chapter no longer exists.');
      }

      const paragraphCount = countParagraphs(chapter.bodyMd);
      if (paragraphCount === 0) {
        throw new RuleViolationError(
          'Write some prose first, then place the image after a paragraph.',
        );
      }
      if (input.afterParagraphIndex > paragraphCount) {
        throw new RuleViolationError(
          `This chapter only has ${paragraphCount} paragraph${paragraphCount === 1 ? '' : 's'}, so there is nothing after paragraph ${input.afterParagraphIndex}.`,
        );
      }

      return repo.createSlot(input);
    },

    async updateSlot(input) {
      const existing = await repo.findById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That image slot no longer exists.');
      }

      const chapter = await chapters.findById(existing.chapterId);
      if (chapter === null) {
        throw new RuleViolationError('The chapter for this image no longer exists.');
      }

      const paragraphCount = countParagraphs(chapter.bodyMd);
      if (input.afterParagraphIndex > paragraphCount) {
        throw new RuleViolationError(
          `This chapter only has ${paragraphCount} paragraph${paragraphCount === 1 ? '' : 's'}. Move the image before removing more prose.`,
        );
      }

      return repo.saveSlot({
        id: input.id,
        afterParagraphIndex: input.afterParagraphIndex,
        altText: input.altText,
        caption: input.caption ?? existing.caption,
      });
    },

    /**
     * Uploads the local file and records the derived URL.
     *
     * The local file is never deleted, so a failed or refused upload costs the
     * author nothing and can be retried. Imgur is not offered as a default
     * because it needs a registered Client ID.
     */
    async uploadToHost(input) {
      const existing = await repo.findById(input.id);
      if (existing === null) {
        throw new RuleViolationError('That image slot no longer exists.');
      }
      if (existing.remoteUrl !== null) {
        throw new RuleViolationError('That image is already uploaded.');
      }

      let remoteUrl: string;
      try {
        remoteUrl = await host.upload(existing.localPath);
      } catch (err) {
        if (err instanceof ImageUploadError) {
          throw new RuleViolationError(err.message);
        }
        throw err;
      }

      return repo.markUploaded(existing.id, { remoteUrl, provider: host.name });
    },

    async findOrphanedSlots({ chapterId, paragraphCount }) {
      const slots = await repo.listByChapter(chapterId);
      return slots.filter((slot) => slot.afterParagraphIndex > paragraphCount);
    },
  };
}

export interface GlossaryService {
  list(input: { projectId: string }): Promise<GlossaryTerm[]>;
  save(input: {
    projectId: string;
    canonicalForm: string;
    kind: GlossaryKind;
    notes?: string;
  }): Promise<GlossaryTerm>;
}

export function createGlossaryService(repo: GlossaryRepository): GlossaryService {
  return {
    list: (input) => repo.list(input.projectId),

    /**
     * Saving an existing form updates it rather than erroring, because pinning a
     * word is an ongoing habit and a duplicate error would make it annoying.
     */
    async save(input) {
      const payload: SaveGlossaryTermInput = {
        projectId: input.projectId,
        canonicalForm: input.canonicalForm.trim(),
        kind: input.kind,
        notes: input.notes ?? '',
      };
      return repo.upsert(payload);
    },
  };
}