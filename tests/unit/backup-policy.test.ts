import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertOutsideRepo,
  isInsideRepo,
  isoWeekKey,
  parseDumpFileName,
  selectDumpsToDelete,
  toDumpFileName,
} from '../../electron/lib/backup-policy.js';

/**
 * The backup rules, tested without a database or a filesystem.
 *
 * These are the tests that matter most in the repository: a wrong retention policy
 * or a path guard that lets a dump land inside git are incidents, not bugs.
 */

const DATE = new Date(2026, 10, 6, 21, 4, 9);

describe('dump file names', () => {
  it('formats local time with zero padding', () => {
    expect(toDumpFileName(DATE)).toBe('storyboard-20261106-210409.dump');
  });

  it('round-trips through the parser', () => {
    const parsed = parseDumpFileName(toDumpFileName(DATE));
    expect(parsed).not.toBeNull();
    expect(parsed?.timestamp.getTime()).toBe(DATE.getTime());
  });

  it('ignores files it did not write', () => {
    expect(parseDumpFileName('backup.log')).toBeNull();
    expect(parseDumpFileName('storyboard-latest.dump')).toBeNull();
    expect(parseDumpFileName('storyboard-20261106-210409.dump.partial')).toBeNull();
    expect(parseDumpFileName('my-manuscript.dump')).toBeNull();
  });
});

describe('retention', () => {
  const weekA = [9, 10, 11].map((hour) =>
    toDumpFileName(new Date(2026, 0, 5, hour, 0, 0)),
  );
  const weekB = [9, 10, 11].map((hour) =>
    toDumpFileName(new Date(2026, 1, 2, hour, 0, 0)),
  );
  const weekC = [9, 10, 11].map((hour) =>
    toDumpFileName(new Date(2026, 2, 2, hour, 0, 0)),
  );

  it('deletes nothing while under the keep count', () => {
    expect(selectDumpsToDelete([...weekC, ...weekB])).toEqual([]);
  });

  it('keeps the newest dumps and one representative per week, oldest deleted first', () => {
    const all = [...weekA, ...weekB, ...weekC];
    expect(selectDumpsToDelete(all, { keepLatest: 2, keepWeeks: 2 })).toEqual([
      weekA[0],
      weekA[1],
      weekA[2],
      weekB[0],
      weekB[1],
      weekC[0],
    ]);
  });

  it('never proposes deleting a file it did not write', () => {
    const expired = selectDumpsToDelete(
      [...weekA, ...weekB, ...weekC, 'backup.log', 'notes.dump', 'thumbs.db'],
      { keepLatest: 1, keepWeeks: 1 },
    );
    expect(expired).not.toContain('backup.log');
    expect(expired).not.toContain('notes.dump');
    expect(expired).not.toContain('thumbs.db');
  });
});

describe('iso weeks', () => {
  it('groups days of the same week together', () => {
    expect(isoWeekKey(new Date(2026, 10, 2))).toBe(isoWeekKey(new Date(2026, 10, 6)));
  });

  it('treats the new year week as one week', () => {
    expect(isoWeekKey(new Date(2025, 11, 29))).toBe(isoWeekKey(new Date(2026, 0, 1)));
  });
});

describe('repository guard', () => {
  const repoRoot = path.resolve('C:/Users/vinit/Desktop/StoryBoard');

  it('refuses the repository itself and anything beneath it', () => {
    expect(isInsideRepo(repoRoot, repoRoot)).toBe(true);
    expect(isInsideRepo(path.join(repoRoot, 'backups'), repoRoot)).toBe(true);
    expect(isInsideRepo(path.join(repoRoot, 'dist', 'backups'), repoRoot)).toBe(true);
  });

  it('allows a sibling directory that merely shares a prefix', () => {
    expect(isInsideRepo('C:/Users/vinit/Desktop/StoryBoard-backups', repoRoot)).toBe(false);
    expect(isInsideRepo('D:/storyboard-backups', repoRoot)).toBe(false);
  });

  it('throws for a destination inside the repo', () => {
    expect(() => assertOutsideRepo(path.join(repoRoot, 'backups'), repoRoot)).toThrow(
      /inside the repository/i,
    );
    expect(() => assertOutsideRepo('D:/storyboard-backups', repoRoot)).not.toThrow();
  });
});
