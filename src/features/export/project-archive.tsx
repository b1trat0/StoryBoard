import { Archive } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { getBridge } from '../../lib/bridge';

export interface ProjectArchiveProps {
  projectId: string | null;
}

/**
 * The whole-work archive.
 *
 * It exists for the day Postgres, Docker or the app is gone: prose stays as markdown
 * and everything structured is in one readable JSON file. Unlike a database dump it
 * needs no matching database to read, which is the difference between a backup and a
 * backup you can open in ten years.
 */
export function ProjectArchive({ projectId }: ProjectArchiveProps) {
  const [isExporting, setIsExporting] = useState(false);

  async function exportArchive(): Promise<void> {
    const bridge = getBridge();
    if (bridge === null || projectId === null) {
      return;
    }

    setIsExporting(true);
    try {
      const result = await bridge.archive.exportProject({ projectId });
      if (result.status === 'cancelled') {
        return;
      }
      toast.success('Archive written', {
        description: `${result.chapterCount} chapters, ${result.entityCount} entities, ${result.factCount} facts → ${result.filePath}`,
      });
    } catch (err) {
      toast.error('Could not write the archive', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-ink">Project archive</p>
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          One JSON file holding every chapter's markdown, plus entities, facts, relations
          and glossary. Images are files on disk and are not embedded.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void exportArchive()}
        disabled={isExporting || projectId === null}
      >
        <Archive size={14} aria-hidden="true" />
        {isExporting ? 'Writing…' : 'Export archive'}
      </Button>
    </div>
  );
}
