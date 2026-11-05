import { CheckCircle, HardDrives, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { copyText } from '../../lib/clipboard';
import { formatBackupTime, formatBytes, restoreCommand } from './format';
import { useBackup } from './use-backup';

export interface BackupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The backup screen.
 *
 * The author presses a button and is told three things: what was written, how big it
 * is, and where to recover it from. A backup they cannot locate is a backup they do
 * not have, so the path and the restore command are both shown and copyable.
 *
 * There is no scheduler behind this on purpose. A scheduled task that stops working
 * fails silently, and this app has no server to notice the difference; a button that
 * reports the file it just wrote cannot lie quietly.
 */
export function BackupDialog({ isOpen, onClose }: BackupDialogProps) {
  const { status, isRunning, result, errorMessage, runBackup } = useBackup(isOpen);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const copyValue = useCallback(async (label: string, value: string) => {
    const copied = await copyText(value);
    setCopiedLabel(copied ? label : null);
  }, []);

  const recoveryPath = result?.file.filePath ?? status?.lastBackup?.filePath ?? null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Backup"
      description="One verified copy of the whole manuscript database, written where you can find it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void runBackup()} disabled={isRunning}>
            {isRunning ? 'Backing up…' : 'Back up now'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <HardDrives size={16} weight="bold" aria-hidden="true" className="text-accent" />
            Where backups live
          </h3>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[12px] text-ink-soft">
              {status?.directory ?? 'Reading the backup folder…'}
            </code>
            {status !== null && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyValue('directory', status.directory)}
              >
                {copiedLabel === 'directory' ? 'Copied' : 'Copy path'}
              </Button>
            )}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            Every backup is checked before it is kept: a dump that cannot be read back is
            never written. The newest 14 are kept, plus one per week for eight weeks.
          </p>
        </section>

        <section>
          <h3 className="text-[13px] font-medium text-ink">Last backup</h3>
          {status?.lastBackup === null || status === null ? (
            <p className="mt-1.5 text-[13px] text-ink-muted">
              {status === null && errorMessage === null ? 'Checking…' : 'No backup yet.'}
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-ink-soft">
              <span className="font-mono text-[12px]">
                {status.lastBackup.fileName}
              </span>{' '}
              · {formatBytes(status.lastBackup.bytes)} ·{' '}
              {formatBackupTime(status.lastBackup.createdAt)}
            </p>
          )}
          {status !== null && !status.isMirrorConfigured && (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              This is one copy on one drive. A second location has not been configured,
              so a dead disk would still take the book with it.
            </p>
          )}
        </section>

        {errorMessage !== null && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5"
          >
            <WarningCircle
              size={16}
              weight="bold"
              aria-hidden="true"
              className="mt-px shrink-0 text-danger"
            />
            <p className="text-[12.5px] leading-relaxed text-danger">{errorMessage}</p>
          </div>
        )}

        {result !== null && (
          <section
            aria-live="polite"
            className="rounded-md border border-accent/25 bg-accent-soft/60 px-3.5 py-3"
          >
            <h3 className="flex items-center gap-2 text-[13px] font-medium text-accent">
              <CheckCircle size={16} weight="bold" aria-hidden="true" />
              Backup written
            </h3>
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto break-all rounded border border-accent/20 bg-surface px-2 py-1.5 font-mono text-[11.5px] text-ink-soft">
                {result.file.filePath}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyValue('file', result.file.filePath)}
              >
                {copiedLabel === 'file' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ['chapters', result.counts.chapters],
                  ['entities', result.counts.entities],
                  ['facts', result.counts.facts],
                  ['relations', result.counts.relations],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded border border-accent/15 bg-surface py-1.5">
                  <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">
                    {label}
                  </dt>
                  <dd className="text-[15px] font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {result.mirrorPath !== null && (
              <p className="mt-2 text-[12px] text-ink-soft">
                Also copied to{' '}
                <span className="font-mono text-[11.5px]">{result.mirrorPath}</span>
              </p>
            )}
            {result.removed.length > 0 && (
              <p className="mt-1.5 text-[12px] text-ink-muted">
                Removed {result.removed.length} expired{' '}
                {result.removed.length === 1 ? 'backup' : 'backups'} after this one was
                safely on disk.
              </p>
            )}
          </section>
        )}

        <section>
          <h3 className="text-[13px] font-medium text-ink">Where to recover from</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
            Restoring reads this file into the database. The command below restores it
            into a throwaway database first and compares row counts, so a bad file is
            caught before it replaces anything.
          </p>
          {recoveryPath === null ? (
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Take a backup first, then the exact command appears here.
            </p>
          ) : (
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[11.5px] text-ink-soft">
                {restoreCommand(recoveryPath)}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyValue('restore', restoreCommand(recoveryPath))}
              >
                {copiedLabel === 'restore' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            Backups are plain files and are not encrypted. Full manual recovery steps are
            in <span className="font-mono">docs/backup.md</span>.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
