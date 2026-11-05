// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupDialog } from '../../src/features/backup/backup-dialog.js';
import type { BackupRunResult, BackupStatus, StoryBoardBridge } from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * The backup screen.
 *
 * The contract this screen has to keep is not "it renders". It is that after a
 * backup the author can see what was written and where to recover it from. A dialog
 * that only said "Backup complete" would pass a smoke test and still leave the
 * manuscript unrecoverable in practice, so the path and the restore command are the
 * assertions.
 */

const BACKUP_DIR = 'D:\\storyboard-backups';

function statusFixture(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    directory: BACKUP_DIR,
    isMirrorConfigured: false,
    lastBackup: null,
    ...overrides,
  };
}

function resultFixture(): BackupRunResult {
  return {
    file: {
      fileName: 'storyboard-20261106-210409.dump',
      filePath: `${BACKUP_DIR}\\storyboard-20261106-210409.dump`,
      bytes: 38_309,
      createdAt: '2026-11-06T01:04:09.000Z',
    },
    counts: { chapters: 12, entities: 8, facts: 40, relations: 3 },
    removed: [],
    mirrorPath: null,
  };
}

function installBridge(options: {
  status?: () => Promise<BackupStatus>;
  run?: () => Promise<BackupRunResult>;
}): void {
  const bridge = {
    backup: {
      status: vi.fn(options.status ?? (async () => statusFixture())),
      run: vi.fn(options.run ?? (async () => resultFixture())),
    },
  } as unknown as StoryBoardBridge;

  (window as unknown as { storyboard: StoryBoardBridge }).storyboard = bridge;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { storyboard?: StoryBoardBridge }).storyboard;
});

describe('before a backup', () => {
  it('shows where backups go, so the folder is known before it is needed', async () => {
    installBridge({});
    render(<BackupDialog isOpen onClose={() => {}} />);

    expect(await screen.findByText(BACKUP_DIR)).toBeTruthy();
    expect(screen.getByText('No backup yet.')).toBeTruthy();
  });

  it('says when there is only one copy on one drive', async () => {
    installBridge({});
    render(<BackupDialog isOpen onClose={() => {}} />);

    expect(await screen.findByText(/one copy on one drive/i)).toBeTruthy();
  });

  it('shows the newest backup when one exists', async () => {
    installBridge({
      status: async () =>
        statusFixture({
          lastBackup: resultFixture().file,
        }),
    });
    render(<BackupDialog isOpen onClose={() => {}} />);

    expect(await screen.findByText('storyboard-20261106-210409.dump')).toBeTruthy();
  });
});

describe('taking a backup', () => {
  it('reports the written file, its counts, and where to recover it', async () => {
    installBridge({});
    render(<BackupDialog isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /back up now/i }));

    expect(await screen.findByText('Backup written')).toBeTruthy();
    expect(
      screen.getByText(`${BACKUP_DIR}\\storyboard-20261106-210409.dump`),
    ).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();

    // The recovery instruction is the part that makes the backup usable.
    expect(
      screen.getByText(
        'npm run db:restore -- --file="D:\\storyboard-backups\\storyboard-20261106-210409.dump"',
      ),
    ).toBeTruthy();
  });

  it('says plainly that backups are not encrypted', async () => {
    installBridge({});
    render(<BackupDialog isOpen onClose={() => {}} />);

    expect(await screen.findByText(/are not encrypted/i)).toBeTruthy();
  });

  it('shows the reason when the database is not running', async () => {
    installBridge({
      run: async () => {
        throw new Error('pg_dump failed (exit 1). Is the database container running?');
      },
    });
    render(<BackupDialog isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /back up now/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/database container running/i);
    });
    expect(screen.queryByText('Backup written')).toBeNull();
  });
});
