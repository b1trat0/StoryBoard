import { describe, expect, it } from 'vitest';
import { createOutlineService } from '../../electron/services/outline.service.js';
import { createChapterService } from '../../electron/services/content.service.js';
import { RuleViolationError } from '../../electron/services/storyboard.service.js';
import type { OutlineRepository } from '../../electron/repositories/outline.repository.js';
import type { ChapterRepository } from '../../electron/repositories/chapter.repository.js';
import type {
  Arc,
  Chapter,
  OutlineDeletionImpact,
  Volume,
} from '../../electron/ipc/contract.js';
import { createChapterRequestSchema } from '../../electron/ipc/contract.js';

/**
 * Outline and chapter rules, tested against stub repositories.
 *
 * No database here. The service layer exists so these rules are decidable without
 * Postgres, and the two that matter are the ones a cascade can make expensive: a
 * child must not be attached to a parent that has gone, and a deletion must be
 * described before it is performed.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const VOLUME_ID = '22222222-2222-4222-8222-222222222222';
const ARC_ID = '33333333-3333-4333-8333-333333333333';
const CHAPTER_ID = '44444444-4444-4444-8444-444444444444';

function makeVolume(overrides: Partial<Volume> = {}): Volume {
  return {
    id: VOLUME_ID,
    projectId: PROJECT_ID,
    title: 'Volume One',
    ordinal: 1,
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeArc(overrides: Partial<Arc> = {}): Arc {
  return {
    id: ARC_ID,
    volumeId: VOLUME_ID,
    title: 'The Cinders',
    ordinal: 1,
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: CHAPTER_ID,
    arcId: ARC_ID,
    title: 'Ash and Iron',
    ordinal: 1,
    type: 'chapter',
    status: 'outline',
    povEntityId: null,
    outlineGoal: '',
    outlineConflict: '',
    outlineOutcome: '',
    outlineBeat: '',
    bodyMd: '',
    wordCount: 0,
    rrUrl: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A stub that tracks writes, so a test can prove a rejected call never reached the
 * database rather than merely checking the error message.
 */
function stubOutlineRepository(seed: { volumes?: Volume[]; arcs?: Arc[] } = {}) {
  const volumes = seed.volumes ?? [makeVolume()];
  const arcs = seed.arcs ?? [makeArc()];
  const calls: string[] = [];

  const repo: OutlineRepository = {
    listTree: async () => ({ volumes: [] }),
    findVolumeById: async (id) => volumes.find((v) => v.id === id) ?? null,
    findArcById: async (id) => arcs.find((a) => a.id === id) ?? null,
    nextVolumeOrdinal: async () => 1,
    createVolume: async (input) => {
      calls.push('createVolume');
      return makeVolume({ title: input.title });
    },
    updateVolume: async (input) => {
      calls.push('updateVolume');
      return makeVolume({ title: input.title ?? 'Volume One' });
    },
    removeVolume: async () => {
      calls.push('removeVolume');
    },
    nextArcOrdinal: async () => 1,
    createArc: async (input) => {
      calls.push('createArc');
      return makeArc({ title: input.title });
    },
    updateArc: async (input) => {
      calls.push('updateArc');
      return makeArc({ title: input.title ?? 'The Cinders' });
    },
    removeArc: async () => {
      calls.push('removeArc');
    },
    describeDeletion: async (input): Promise<OutlineDeletionImpact> => ({
      kind: input.kind,
      title: 'Ash and Iron',
      childCount: 0,
      factCount: 12,
      illustrationCount: 1,
      wordCount: 2400,
    }),
  };

  return { repo, calls };
}

function stubChapterRepository(seed: Chapter[] = [makeChapter()]) {
  const calls: string[] = [];
  const repo: ChapterRepository = {
    listByArc: async () => seed,
    findById: async (id) => seed.find((c) => c.id === id) ?? null,
    nextOrdinal: async () => seed.length + 1,
    create: async (input) => {
      calls.push('create');
      // Parsed through the real schema so the stub applies the same defaults the
      // main process would. Without this the stub would pass `undefined` where
      // production passes 'outline', and the test would be asserting the stub.
      const parsed = createChapterRequestSchema.parse(input);
      return makeChapter({
        title: parsed.title,
        type: parsed.type,
        status: parsed.status,
      });
    },
    remove: async () => {
      calls.push('remove');
    },
    saveBody: async (input) => makeChapter({ id: input.id, bodyMd: input.bodyMd }),
    saveOutline: async (input) => makeChapter({ id: input.id, title: input.title }),
  };
  return { repo, calls };
}

describe('outline service', () => {
  it('trims a volume title before storing it', async () => {
    const { repo, calls } = stubOutlineRepository();
    const service = createOutlineService(repo);

    const created = await service.createVolume({
      projectId: PROJECT_ID,
      title: '  Volume One  ',
      summary: '',
    });

    expect(created.title).toBe('Volume One');
    expect(calls).toContain('createVolume');
  });

  /**
   * `nonEmptyText` rejects "" but not "   ", so a title of only spaces would
   * otherwise reach the database and produce a volume with no name.
   */
  it('refuses a title made only of spaces and never writes', async () => {
    const { repo, calls } = stubOutlineRepository();
    const service = createOutlineService(repo);

    await expect(
      service.createVolume({ projectId: PROJECT_ID, title: '   ', summary: '' }),
    ).rejects.toBeInstanceOf(RuleViolationError);
    expect(calls).not.toContain('createVolume');
  });

  it('refuses to add an arc to a volume that no longer exists', async () => {
    const { repo, calls } = stubOutlineRepository({ volumes: [] });
    const service = createOutlineService(repo);

    await expect(
      service.createArc({ volumeId: VOLUME_ID, title: 'The Cinders', summary: '' }),
    ).rejects.toThrow(/volume no longer exists/i);
    expect(calls).not.toContain('createArc');
  });

  it('adds an arc when the volume exists', async () => {
    const { repo, calls } = stubOutlineRepository();
    const service = createOutlineService(repo);

    const created = await service.createArc({
      volumeId: VOLUME_ID,
      title: 'The Cinders',
      summary: '',
    });

    expect(created.title).toBe('The Cinders');
    expect(calls).toContain('createArc');
  });

  it('refuses to update a volume that no longer exists', async () => {
    const { repo, calls } = stubOutlineRepository({ volumes: [] });
    const service = createOutlineService(repo);

    await expect(service.updateVolume({ id: VOLUME_ID, title: 'Renamed' })).rejects.toThrow(
      /volume no longer exists/i,
    );
    expect(calls).not.toContain('updateVolume');
  });

  /**
   * A save with nothing in it would issue an UPDATE that touches updated_at alone,
   * which reads as "you edited this" without having edited anything.
   */
  it('refuses an empty update instead of issuing a no-op write', async () => {
    const { repo, calls } = stubOutlineRepository();
    const service = createOutlineService(repo);

    await expect(service.updateVolume({ id: VOLUME_ID })).rejects.toThrow(/nothing to save/i);
    expect(calls).not.toContain('updateVolume');
  });

  it('reports what a deletion would cost before it happens', async () => {
    const { repo } = stubOutlineRepository();
    const service = createOutlineService(repo);

    const impact = await service.describeDeletion({ kind: 'chapter', id: CHAPTER_ID });

    expect(impact.factCount).toBe(12);
    expect(impact.wordCount).toBe(2400);
    expect(impact.illustrationCount).toBe(1);
  });
});

describe('chapter service', () => {
  it('creates a chapter as an outline with no prose', async () => {
    const { repo } = stubChapterRepository();
    const service = createChapterService(repo);

    const created = await service.create({ arcId: ARC_ID, title: 'New Chapter' });

    expect(created.title).toBe('New Chapter');
    expect(created.status).toBe('outline');
    expect(created.bodyMd).toBe('');
    expect(created.wordCount).toBe(0);
  });

  it('trims the chapter title', async () => {
    const { repo } = stubChapterRepository();
    const service = createChapterService(repo);

    const created = await service.create({ arcId: ARC_ID, title: '  Padded  ' });

    expect(created.title).toBe('Padded');
  });

  it('refuses a blank chapter title and never writes', async () => {
    const { repo, calls } = stubChapterRepository();
    const service = createChapterService(repo);

    await expect(
      service.create({ arcId: ARC_ID, title: '   ' }),
    ).rejects.toBeInstanceOf(RuleViolationError);
    expect(calls).not.toContain('create');
  });

  it('refuses to delete a chapter that has already gone', async () => {
    const { repo, calls } = stubChapterRepository([]);
    const service = createChapterService(repo);

    await expect(service.remove({ id: CHAPTER_ID })).rejects.toThrow(/no longer exists/i);
    expect(calls).not.toContain('remove');
  });

  it('deletes a chapter that exists', async () => {
    const { repo, calls } = stubChapterRepository();
    const service = createChapterService(repo);

    await service.remove({ id: CHAPTER_ID });

    expect(calls).toContain('remove');
  });

  it('keeps a prologue typed as a prologue', async () => {
    const { repo } = stubChapterRepository();
    const service = createChapterService(repo);

    const created = await service.create({ arcId: ARC_ID, title: 'Prologue', type: 'prologue' });

    expect(created.type).toBe('prologue');
  });
});
