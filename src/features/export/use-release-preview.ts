import { useCallback, useEffect, useState } from 'react';
import { getBridge } from '../../lib/bridge';
import type { ChapterRelease } from '../../lib/bridge';

/**
 * Loads the release preview for one chapter.
 *
 * Deliberately reads the committed chapter rather than an editor buffer. The point
 * of the preview is to show what publishing would send, so it must reflect the last
 * explicit save and never the unsaved text on screen, or the author would review one
 * version and upload another.
 */

export interface ReleasePreviewState {
  release: ChapterRelease | null;
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
}

export function useReleasePreview(chapterId: string | null): ReleasePreviewState {
  const [release, setRelease] = useState<ChapterRelease | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || chapterId === null) {
      // The shell renders the no-bridge screen instead, and with no chapter chosen
      // there is nothing to ask for.
      setRelease(null);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setRelease(await bridge.release.previewChapter({ chapterId }));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.');
      setRelease(null);
    } finally {
      setIsLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await, so nothing cascades synchronously; the
    // lint rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { release, isLoading, errorMessage, reload };
}