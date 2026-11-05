import { describe, expect, it, vi } from 'vitest';
import { createProjectService } from '../../electron/services/project.service.js';
import { RuleViolationError } from '../../electron/lib/errors.js';
import type { ProjectRepository } from '../../electron/repositories/project.repository.js';
import type { SettingsService } from '../../electron/services/settings.service.js';
import type { Project } from '../../electron/ipc/contract.js';

/**
 * Work rules.
 *
 * Only two decisions are policy rather than data shape: you cannot archive your only
 * work, and the app must always open on a work that exists and is not archived. Both
 * are tested here because getting either wrong leaves the author looking at an empty
 * shell with no explanation.
 */

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: FIRST_ID,
    title: 'My Serial',
    kind: 'light_novel',
    exportProfile: 'royal_road',
    summary: '',
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepository(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  return {
    list: vi.fn(async () => [project()]),
    findById: vi.fn(async () => project()),
    create: vi.fn(async () => project()),
    update: vi.fn(async () => project()),
    archive: vi.fn(async () => project({ archivedAt: '2026-11-06T00:00:00.000Z' })),
    countActive: vi.fn(async () => 2),
    firstActive: vi.fn(async () => project()),
    ...overrides,
  };
}

function makeSettings(activeProjectId: string | null): SettingsService & {
  setActiveProjectId: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async () => ({ activeProjectId })),
    setActiveProjectId: vi.fn(async () => undefined),
  };
}

describe('archiving', () => {
  it('refuses to archive the only active work', async () => {
    const service = createProjectService(
      makeRepository({ countActive: vi.fn(async () => 1) }),
      makeSettings(FIRST_ID),
    );

    await expect(service.archive({ id: FIRST_ID })).rejects.toBeInstanceOf(
      RuleViolationError,
    );
  });

  it('archives when another work remains', async () => {
    const repository = makeRepository();
    const service = createProjectService(repository, makeSettings(SECOND_ID));

    const archived = await service.archive({ id: FIRST_ID });

    expect(repository.archive).toHaveBeenCalledWith(FIRST_ID);
    expect(archived.archivedAt).not.toBeNull();
  });

  it('moves the active work away when the active one is archived', async () => {
    const repository = makeRepository({
      firstActive: vi.fn(async () => project({ id: SECOND_ID, title: 'Second' })),
    });
    const settings = makeSettings(FIRST_ID);
    const service = createProjectService(repository, settings);

    await service.archive({ id: FIRST_ID });

    expect(settings.setActiveProjectId).toHaveBeenCalledWith(SECOND_ID);
  });

  it('leaves the active work alone when archiving a different one', async () => {
    const settings = makeSettings(SECOND_ID);
    const service = createProjectService(makeRepository(), settings);

    await service.archive({ id: FIRST_ID });

    expect(settings.setActiveProjectId).not.toHaveBeenCalled();
  });
});

describe('which work opens', () => {
  it('returns the remembered work when it still exists and is not archived', async () => {
    const service = createProjectService(makeRepository(), makeSettings(FIRST_ID));
    await expect(service.getActive()).resolves.toEqual({ projectId: FIRST_ID });
  });

  it('falls back to the oldest active work when nothing is remembered', async () => {
    const repository = makeRepository({
      firstActive: vi.fn(async () => project({ id: SECOND_ID })),
    });
    const service = createProjectService(repository, makeSettings(null));

    await expect(service.getActive()).resolves.toEqual({ projectId: SECOND_ID });
  });

  it('falls back when the remembered work was archived', async () => {
    const repository = makeRepository({
      findById: vi.fn(async () => project({ archivedAt: '2026-11-05T00:00:00.000Z' })),
      firstActive: vi.fn(async () => project({ id: SECOND_ID })),
    });
    const service = createProjectService(repository, makeSettings(FIRST_ID));

    await expect(service.getActive()).resolves.toEqual({ projectId: SECOND_ID });
  });

  it('returns null when there is no work at all', async () => {
    const service = createProjectService(
      makeRepository({ firstActive: vi.fn(async () => null) }),
      makeSettings(null),
    );

    await expect(service.getActive()).resolves.toEqual({ projectId: null });
  });
});

describe('switching', () => {
  it('refuses a work that is archived', async () => {
    const service = createProjectService(
      makeRepository({
        findById: vi.fn(async () => project({ archivedAt: '2026-11-05T00:00:00.000Z' })),
      }),
      makeSettings(null),
    );

    await expect(service.setActive({ projectId: FIRST_ID })).rejects.toThrow(
      /archived/i,
    );
  });

  it('refuses a work that does not exist', async () => {
    const service = createProjectService(
      makeRepository({ findById: vi.fn(async () => null) }),
      makeSettings(null),
    );

    await expect(service.setActive({ projectId: FIRST_ID })).rejects.toThrow(
      /no longer exists/i,
    );
  });

  it('remembers the choice', async () => {
    const settings = makeSettings(null);
    const service = createProjectService(makeRepository(), settings);

    await service.setActive({ projectId: FIRST_ID });

    expect(settings.setActiveProjectId).toHaveBeenCalledWith(FIRST_ID);
  });
});

describe('listing', () => {
  it('excludes archived work unless asked', async () => {
    const repository = makeRepository();
    const service = createProjectService(repository, makeSettings(null));

    await service.list({});
    expect(repository.list).toHaveBeenCalledWith(false);

    await service.list({ includeArchived: true });
    expect(repository.list).toHaveBeenCalledWith(true);
  });
});
