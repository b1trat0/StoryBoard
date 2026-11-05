import { describe, expect, it, vi } from 'vitest';
import { createArchiveService } from '../../electron/services/archive.service.js';
import type { ArchiveServiceDeps } from '../../electron/services/archive.service.js';
import type {
  Chapter,
  Project,
} from '../../electron/ipc/contract.js';

/**
 * The archive is the backup that survives losing Postgres, so what matters is that the
 * prose is in it as markdown and the counts on the result are real. A JSON file missing
 * bodyMd would still look like a successful export.
 */

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const VOLUME_ID = '20000000-0000-4000-8000-000000000001';
const ARC_ID = '30000000-0000-4000-8000-000000000001';
const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

function project(): Project {
  return {
    id: PROJECT_ID,
    title: 'The Ash Gate',
    kind: 'light_novel',
    exportProfile: 'royal_road',
    summary: '',
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function chapter(): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: ARC_ID,
    title: 'The Seal',
    ordinal: 1,
    type: 'chapter',
    status: 'done',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: 'First paragraph.\n\nSecond paragraph.',
    authorNotePre: '',
    authorNotePost: '',
    wordCount: 4,
    rrUrl: 'https://royalroad.com/fiction/1/chapter/2',
    publishedAt: '2026-11-02T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function makeDeps(captured: { bytes: Buffer | null }): ArchiveServiceDeps {
  return {
    projects: { findById: vi.fn(async () => project()) } as never,
    outline: {
      listTree: vi.fn(async () => ({
        volumes: [
          {
            id: VOLUME_ID,
            projectId: PROJECT_ID,
            title: 'Volume One',
            ordinal: 1,
            summary: '',
            createdAt: '2026-11-01T00:00:00.000Z',
            arcs: [
              {
                id: ARC_ID,
                volumeId: VOLUME_ID,
                title: 'The Ash Gate',
                ordinal: 1,
                summary: '',
                createdAt: '2026-11-01T00:00:00.000Z',
                chapters: [
                  {
                    id: CHAPTER_ID,
                    arcId: ARC_ID,
                    title: 'The Seal',
                    ordinal: 1,
                    type: 'chapter',
                    status: 'done',
                    povEntityId: null,
                    wordCount: 4,
                    publishedAt: null,
                  },
                ],
              },
            ],
          },
        ],
      })),
    } as never,
    chapters: { findByIds: vi.fn(async () => [chapter()]) } as never,
    entities: { list: vi.fn(async () => []) } as never,
    facts: { list: vi.fn(async () => []) } as never,
    relations: { list: vi.fn(async () => []) } as never,
    glossary: { list: vi.fn(async () => []) } as never,
    saveFile: {
      save: vi.fn(async ({ bytes }: { bytes: Buffer }) => {
        captured.bytes = bytes;
        return { status: 'saved' as const, filePath: 'D:\\archive.json' };
      }),
    },
  };
}

describe('exporting the archive', () => {
  it('writes prose as markdown and reports real counts', async () => {
    const captured: { bytes: Buffer | null } = { bytes: null };
    const service = createArchiveService(makeDeps(captured));

    const result = await service.exportProject({ projectId: PROJECT_ID });

    expect(result.status).toBe('written');
    if (result.status !== 'written') {
      return;
    }
    expect(result.chapterCount).toBe(1);
    expect(captured.bytes).not.toBeNull();

    const parsed = JSON.parse(captured.bytes!.toString('utf8')) as {
      format: string;
      project: { title: string };
      volumes: { arcs: { chapters: { bodyMd: string; wordCount: number }[] }[] }[];
    };

    expect(parsed.format).toBe('storyboard-archive');
    expect(parsed.project.title).toBe('The Ash Gate');
    const archived = parsed.volumes[0]?.arcs[0]?.chapters[0];
    expect(archived?.bodyMd).toBe('First paragraph.\n\nSecond paragraph.');
    expect(archived?.wordCount).toBe(4);
  });

  it('treats a cancelled save as an outcome, not a failure', async () => {
    const deps = makeDeps({ bytes: null });
    deps.saveFile = {
      save: vi.fn(async () => ({ status: 'cancelled' as const })),
    };
    const service = createArchiveService(deps);

    await expect(service.exportProject({ projectId: PROJECT_ID })).resolves.toEqual({
      status: 'cancelled',
    });
  });
});
