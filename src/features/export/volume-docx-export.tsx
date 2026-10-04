import type { ReactNode } from 'react';
import { FileDoc, Warning, WarningCircle, X } from '@phosphor-icons/react';
import type { OutlineVolumeNode } from '../../lib/bridge';
import { useVolumeDocxExport } from './use-volume-docx-export';

/**
 * Per-volume `.docx` export, the second step of the export pipeline.
 *
 * Royal Road's bulk import consumes one Word document per volume and turns each
 * document heading into a chapter, so the file is built at volume granularity: one
 * `Heading 1` per chapter, in outline order, and nothing else. Arc and volume
 * headings are flattened away because Royal Road has no concept of either, and an
 * illustration cannot travel in a `.docx` at all, which is why the numbers of dropped
 * images and dropped author notes are reported after the fact rather than assumed.
 */

export interface VolumeDocxExportProps {
  /** Volumes from the outline tree, which is the only place their order is known. */
  volumes: OutlineVolumeNode[];
  /** True while the outline itself is loading. */
  isLoading: boolean;
}

export function VolumeDocxExport({ volumes, isLoading }: VolumeDocxExportProps) {
  const { selectedVolume, isExporting, result, errorMessage, selectVolume, exportVolume, dismissResult } =
    useVolumeDocxExport(volumes);

  const hasVolumes = volumes.length > 0;
  const isBusy = isExporting || isLoading;

  return (
    <section
      aria-label="Volume Word export"
      className="border-b border-line bg-surface px-8 py-5"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="volume-docx-select"
            className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted"
          >
            <FileDoc size={13} weight="bold" aria-hidden="true" />
            Volume document (.docx)
          </label>
          <select
            id="volume-docx-select"
            value={selectedVolume?.id ?? ''}
            onChange={(event) => selectVolume(event.target.value)}
            disabled={!hasVolumes || isBusy}
            className="mt-1.5 w-full max-w-xs rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-60"
          >
            {hasVolumes ? (
              volumes.map((volume) => (
                <option key={volume.id} value={volume.id}>
                  {volume.title}
                </option>
              ))
            ) : (
              <option value="">No volumes yet</option>
            )}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void exportVolume()}
          disabled={!hasVolumes || isBusy}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60"
        >
          {isExporting ? 'Building…' : 'Export .docx'}
        </button>
      </div>

      {/*
        The scope of the file, stated before the click rather than discovered after
        it. An author who does not know interludes and images are left behind will
        assume a bug when they later cannot find one.
      */}
      {hasVolumes && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">
          One Word file per volume, for Royal Road&apos;s bulk import. Interludes, images and
          author notes are not included.
        </p>
      )}

      <ExportOutcome result={result} errorMessage={errorMessage} onDismiss={dismissResult} />
    </section>
  );
}

/**
 * Reports what the export did, or why it did not.
 *
 * Silence on cancel is deliberate and the counts are not: a cancelled dialog needs no
 * explanation, but a written file that quietly dropped six images would leave the
 * author to discover it from a reader.
 */
function ExportOutcome({
  result,
  errorMessage,
  onDismiss,
}: {
  result: ReturnType<typeof useVolumeDocxExport>['result'];
  errorMessage: string | null;
  onDismiss: () => void;
}) {
  if (errorMessage !== null) {
    return (
      <Banner tone="danger" icon={<WarningCircle size={16} weight="bold" aria-hidden="true" />}>
        <p className="text-[13px] font-medium">Nothing was exported</p>
        <p className="mt-1 text-[13px] leading-relaxed">{errorMessage}</p>
        <Dismiss onClick={onDismiss} label="Dismiss" />
      </Banner>
    );
  }

  if (result === null) {
    return null;
  }

  if (result.status === 'cancelled') {
    return null;
  }

  const dropped: string[] = [];
  if (result.droppedImageCount > 0) {
    dropped.push(`${count(result.droppedImageCount, 'image')}`);
  }
  if (result.droppedNoteCount > 0) {
    dropped.push(`${count(result.droppedNoteCount, 'author note')}`);
  }

  return (
    <Banner
      tone="muted"
      icon={<Warning size={16} weight="bold" aria-hidden="true" />}
      onDismiss={onDismiss}
    >
      <p className="text-[13px] font-medium text-ink">
        {result.volumeTitle}: {count(result.chapterCount, 'chapter')} written
        {result.excludedChapterCount > 0
          ? `, ${count(result.excludedChapterCount, 'chapter')} left out`
          : ''}
      </p>
      <p className="mt-0.5 break-all text-[12px] text-ink-muted">{result.filePath}</p>
      {dropped.length > 0 && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          Not in the file: {dropped.join(', ')}. A Word document cannot carry them, and
          Royal Road&apos;s import does not preserve them. Publish illustrated chapters
          individually instead, where the images survive.
        </p>
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {result.warnings.map((warning) => (
            <li key={`${warning.code}-${warning.message}`} className="text-[13px] leading-relaxed text-ink-soft">
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  children,
  onDismiss,
}: {
  tone: 'danger' | 'muted';
  icon: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={
        tone === 'danger'
          ? 'mt-3 flex items-start gap-2.5 rounded-md border border-danger/25 bg-danger-soft px-3.5 py-3'
          : 'mt-3 flex items-start gap-2.5 rounded-md border border-line bg-surface-sunken px-3.5 py-3'
      }
    >
      <span className={tone === 'danger' ? 'mt-px shrink-0 text-danger' : 'mt-px shrink-0 text-ink-muted'}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {children}
        {onDismiss !== undefined && <Dismiss onClick={onDismiss} label="Dismiss" />}
      </div>
    </div>
  );
}

function Dismiss({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
    >
      <X size={12} weight="bold" aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * Pluralises a count.
 *
 * Written out rather than left to `Intl.PluralRules`, because a chapter count is
 * something the author reads once and the extra call sites would be noise.
 */
function count(value: number, noun: string): string {
  return `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`;
}