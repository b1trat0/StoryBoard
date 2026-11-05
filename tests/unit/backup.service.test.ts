import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupService } from '../../electron/services/backup.service.js';
import { toDumpFileName } from '../../electron/lib/backup-policy.js';
import type { BackupSource } from '../../electron/lib/docker-backup.js';

/**
 * The backup service's decisions, with Docker stubbed out.
 *
 * The point of these tests is the ordering the service enforces: a dump is verified
 * before it is written, and nothing is deleted until a good one is on disk. A stub
 * that lies about verification must not be able to produce a backup file.
 */

const FAKE_ARCHIVE = Buffer.from('PGDMP fake custom-format archive');

let workDir: string;
let backupsDir: string;
let repoRoot: string;

function makeSource(overrides: Partial<BackupSource> = {}): BackupSource {
  return {
    dump: async () => FAKE_ARCHIVE,
    assertArchiveReadable: async () => undefined,
    readCounts: async () => ({ chapters: 3, entities: 2, facts: 1, relations: 0 }),
    ...overrides,
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'storyboard-backup-'));
  repoRoot = path.join(workDir, 'repo');
  backupsDir = path.join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('writing a backup', () => {
  it('writes the archive and reports what it contains', async () => {
    const now = new Date(2026, 10, 6, 21, 4, 9);
    const service = createBackupService(makeSource(), {
      backupsDir,
      repoRoot,
      mirrorDir: null,
      now: () => now,
    });

    const result = await service.run();

    expect(result.file.fileName).toBe(toDumpFileName(now));
    expect(result.file.bytes).toBe(FAKE_ARCHIVE.byteLength);
    expect(result.counts).toEqual({ chapters: 3, entities: 2, facts: 1, relations: 0 });
    expect(result.mirrorPath).toBeNull();

    const files = await readdir(backupsDir);
    expect(files).toEqual([toDumpFileName(now)]);
  });

  it('refuses to write when the archive header is wrong', async () => {
    const service = createBackupService(
      makeSource({ dump: async () => Buffer.from('not a pg_dump archive') }),
      { backupsDir, repoRoot, mirrorDir: null },
    );

    await expect(service.run()).rejects.toThrow(/not a backup archive/i);
    expect(await readdir(backupsDir)).toEqual([]);
  });

  it('writes nothing when the archive cannot be read back', async () => {
    const service = createBackupService(
      makeSource({
        assertArchiveReadable: async () => {
          throw new Error('the archive is truncated');
        },
      }),
      { backupsDir, repoRoot, mirrorDir: null },
    );

    await expect(service.run()).rejects.toThrow(/truncated/i);
    expect(await readdir(backupsDir)).toEqual([]);
  });

  it('refuses a destination inside the repository', async () => {
    const service = createBackupService(makeSource(), {
      backupsDir: path.join(repoRoot, 'backups'),
      repoRoot,
      mirrorDir: null,
    });

    await expect(service.run()).rejects.toThrow(/inside the repository/i);
  });
});

describe('retention', () => {
  it('deletes old dumps only after the new one is written', async () => {
    await createOldDumps(20);

    const service = createBackupService(makeSource(), {
      backupsDir,
      repoRoot,
      mirrorDir: null,
      now: () => new Date(2026, 10, 6, 22, 0, 0),
    });

    const result = await service.run();

    expect(result.removed.length).toBeGreaterThan(0);
    const files = await readdir(backupsDir);
    expect(files).toContain(result.file.fileName);
    for (const removed of result.removed) {
      expect(files).not.toContain(removed);
    }
    // Newest 14 survive by policy, so the directory cannot empty out.
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  it('never deletes a file it did not write', async () => {
    await mkdir(backupsDir, { recursive: true });
    await writeFile(path.join(backupsDir, 'notes.txt'), 'keep me');

    const service = createBackupService(makeSource(), {
      backupsDir,
      repoRoot,
      mirrorDir: null,
    });
    await service.run();

    expect(await readdir(backupsDir)).toContain('notes.txt');
  });
});

describe('status', () => {
  it('reports no backup before the first run', async () => {
    const service = createBackupService(makeSource(), {
      backupsDir,
      repoRoot,
      mirrorDir: null,
    });

    await expect(service.status()).resolves.toEqual({
      directory: backupsDir,
      isMirrorConfigured: false,
      lastBackup: null,
    });
  });

  it('reports the newest dump after a run', async () => {
    const service = createBackupService(makeSource(), {
      backupsDir,
      repoRoot,
      mirrorDir: null,
      now: () => new Date(2026, 10, 6, 21, 4, 9),
    });
    const result = await service.run();

    const status = await service.status();
    expect(status.lastBackup?.fileName).toBe(result.file.fileName);
    expect(status.lastBackup?.filePath).toBe(result.file.filePath);
  });
});

/** Seeds a directory with dumps spread over past weeks. */
async function createOldDumps(count: number): Promise<void> {
  await mkdir(backupsDir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const when = new Date(2026, 5, 1 + index, 12, 0, 0);
    await writeFile(path.join(backupsDir, toDumpFileName(when)), 'old');
  }
}
