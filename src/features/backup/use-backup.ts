import { useCallback, useEffect, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { BackupRunResult, BackupStatus } from '../../lib/bridge';

/**
 * State for the backup screen.
 *
 * Two separate concerns: knowing what happened last (status) and doing it now (run).
 * They fail independently — a status read can fail while a backup would succeed, and
 * a backup can fail on a stopped container — so the screen always shows the last
 * known state beside the error instead of replacing one with the other.
 */

export interface BackupState {
  /** Last backup and destination, or null before the first read. */
  status: BackupStatus | null;
  isRunning: boolean;
  /** The result of the most recent backup in this session. */
  result: BackupRunResult | null;
  errorMessage: string | null;
  refreshStatus: () => Promise<void>;
  runBackup: () => Promise<void>;
}

/**
 * Loads backup status and runs a backup on demand.
 *
 * @param isOpen - Whether the screen is showing. Status is refreshed on open so the
 *   author sees a backup they took from the terminal, not a stale one.
 */
export function useBackup(isOpen: boolean): BackupState {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BackupRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null) {
      return;
    }
    try {
      const next = await bridge.backup.status({});
      setStatus(next);
    } catch (err) {
      setErrorMessage(describeError(err));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // Reading the backup directory is the legitimate reason for an effect here. Every
    // setState runs after an await, so nothing cascades synchronously; the lint rule
    // cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
  }, [isOpen, refreshStatus]);

  const runBackup = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null) {
      setErrorMessage('The bridge is not available, so a backup cannot be taken.');
      return;
    }

    setIsRunning(true);
    setErrorMessage(null);
    try {
      const next = await bridge.backup.run({});
      setResult(next);
      // Status is re-read rather than derived from the result: the main process owns
      // the destination directory, and guessing it here would be a second source of
      // truth for where the manuscript lives.
      await refreshStatus();
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsRunning(false);
    }
  }, [refreshStatus]);

  return {
    status,
    isRunning,
    result,
    errorMessage,
    refreshStatus,
    runBackup,
  };
}
