import { useCallback, useState } from 'react';
import { getBridge } from '../../lib/bridge';
import type { OutlineVolumeNode, VolumeDocxExportResult } from '../../lib/bridge';

/**
 * Drives one volume's `.docx` export.
 *
 * The button writes a file through a save dialog, so it is an action with a result
 * rather than a load: nothing happens until the author asks, and what comes back is
 * either a written file, a cancellation, or a refusal.
 *
 * The selected volume is derived, not stored. Storing it and defaulting it in an
 * effect would need a second copy of the rule "no selection means the first volume",
 * and the outline arrives after this component mounts.
 */
export interface VolumeDocxExportState {
  /** The volume the export would use, or null when the outline has no volumes. */
  selectedVolume: OutlineVolumeNode | null;
  /** True while the main process is building the document. */
  isExporting: boolean;
  /** The last completed export, for reporting. Null when none has run. */
  result: VolumeDocxExportResult | null;
  /** Why the export failed. Null unless the last attempt was refused or errored. */
  errorMessage: string | null;
  selectVolume: (volumeId: string) => void;
  exportVolume: () => Promise<void>;
  dismissResult: () => void;
}

export function useVolumeDocxExport(volumes: OutlineVolumeNode[]): VolumeDocxExportState {
  const [chosenVolumeId, setChosenVolumeId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<VolumeDocxExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // A stored id that no longer exists falls back to the first volume rather than
  // leaving a dead selection that exports nothing.
  const selectedVolume =
    volumes.find((volume) => volume.id === chosenVolumeId) ?? volumes[0] ?? null;

  const selectVolume = useCallback((volumeId: string) => {
    setChosenVolumeId(volumeId);
    // The previous outcome belongs to a different volume. Leaving it up would let the
    // author read a chapter count from the export they just did of the wrong volume.
    setResult(null);
    setErrorMessage(null);
  }, []);

  const dismissResult = useCallback(() => {
    setResult(null);
    setErrorMessage(null);
  }, []);

  const exportVolume = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || selectedVolume === null) {
      // The shell renders the no-bridge screen instead. Nothing to export without a
      // volume either, so there is no button to press in that state.
      return;
    }
    setIsExporting(true);
    setErrorMessage(null);
    setResult(null);
    try {
      setResult(await bridge.release.exportVolumeDocx({ volumeId: selectedVolume.id }));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'The export failed.');
    } finally {
      setIsExporting(false);
    }
  }, [selectedVolume]);

  return {
    selectedVolume,
    isExporting,
    result,
    errorMessage,
    selectVolume,
    exportVolume,
    dismissResult,
  };
}