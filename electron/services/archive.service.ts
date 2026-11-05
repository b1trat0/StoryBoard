import { toArchiveFileName } from '../lib/export-filename.js';
import type { SaveFilePicker } from '../interfaces/file-dialog.interface.js';
import type { ChapterRepository } from '../repositories/chapter.repository.js';
import type { EntityRepository } from '../repositories/entity.repository.js';
import type { FactRepository } from '../repositories/fact.repository.js';
import type { GlossaryRepository } from '../repositories/glossary.repository.js';
import type { OutlineRepository } from '../repositories/outline.repository.js';
import type { ProjectRepository } from '../repositories/project.repository.js';
import type { RelationRepository } from '../repositories/relation.repository.js';
import type { ArchiveExportResult } from '../ipc/contract.js';
import { RuleViolationError } from '../lib/errors.js';/**
 * The whole-work archive.
 *
 * This is the backup that survives losing Postgres, the container, or the app entirely:
 * prose stays as markdown strings, and everything structured is in one readable JSON
 * file. A `.dump` file needs a matching Postgres to restore; this needs nothing but a
 * text editor.
 *
 * Illustrations are not embedded. Their files live on disk as the source of truth, and
 * inlining binaries would turn a readable archive into a blob. The manifest records
 * paths so the files can be copied alongside.
 *
 * One file rather than a folder: the save dialog writes a file, and an archive the
 * author has to assemble by hand is an archive that stops being taken.
 */

export interface ArchiveServiceDeps {
  projects: ProjectRepository;
  outline: OutlineRepository;
  chapters: ChapterRepository;
  entities: EntityRepository;
  facts: FactRepository;
  relations: RelationRepository;
  glossary: GlossaryRepository;
  saveFile: SaveFilePicker;
}

export interface ArchiveService {
  exportProject(input: { projectId: string }): Promise<ArchiveExportResult>;
}

export function createArchiveService(deps: ArchiveServiceDeps): ArchiveService {
  return {
    async exportProject(input) {
      const project = await deps.projects.findById(input.projectId);
      if (project === null) {
        throw new RuleViolationError('That work no longer exists, so there is nothing to archive.');
      }

      const tree = await deps.outline.listTree(project.id);
      const chapterIds = tree.volumes.flatMap((volume) =>
        volume.arcs.flatMap((arc) => arc.chapters.map((chapter) => chapter.id)),
      );
      const chapters = await deps.chapters.findByIds(chapterIds);
      const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));

      const [entities, facts, relations, glossary] = await Promise.all([
        deps.entities.list({ projectId: project.id }),
        deps.facts.list({ projectId: project.id }),
        deps.relations.list({ projectId: project.id }),
        deps.glossary.list(project.id),
      ]);

      const archive = {
        format: 'storyboard-archive',
        version: 1,
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          title: project.title,
          kind: project.kind,
          exportProfile: project.exportProfile,
          summary: project.summary,
        },
        volumes: tree.volumes.map((volume) => ({
          id: volume.id,
          title: volume.title,
          ordinal: volume.ordinal,
          summary: volume.summary,
          arcs: volume.arcs.map((arc) => ({
            id: arc.id,
            title: arc.title,
            ordinal: arc.ordinal,
            summary: arc.summary,
            chapters: arc.chapters.map((summary) => {
              const chapter = byId.get(summary.id);
              return {
                id: summary.id,
                title: summary.title,
                ordinal: summary.ordinal,
                type: summary.type,
                status: summary.status,
                povEntityId: summary.povEntityId,
                wordCount: summary.wordCount,
                rrUrl: chapter?.rrUrl ?? null,
                publishedAt: chapter?.publishedAt ?? null,
                outlineGoal: chapter?.outlineGoal ?? '',
                outlineConflict: chapter?.outlineConflict ?? '',
                outlineOutcome: chapter?.outlineOutcome ?? '',
                outlineBeat: chapter?.outlineBeat ?? '',
                authorNotePre: chapter?.authorNotePre ?? '',
                authorNotePost: chapter?.authorNotePost ?? '',
                // Markdown, never HTML: the archive has to stay readable and editable.
                bodyMd: chapter?.bodyMd ?? '',
              };
            }),
          })),
        })),
        entities,
        facts,
        relations,
        glossary,
        // Images are files, not data. The path is recorded so they can be copied.
        illustrationsNote:
          'Illustration files are not embedded. Their local paths live in the database and the files must be copied separately.',
      };

      const bytes = Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
      const saved = await deps.saveFile.save({
        suggestedName: toArchiveFileName(project.title),
        bytes,
        kind: 'json',
      });

      if (saved.status === 'cancelled') {
        return { status: 'cancelled' };
      }

      return {
        status: 'written',
        filePath: saved.filePath,
        projectTitle: project.title,
        chapterCount: chapters.length,
        entityCount: entities.length,
        factCount: facts.length,
        relationCount: relations.length,
        glossaryCount: glossary.length,
        bytes: bytes.byteLength,
      };
    },
  };
}
