import { useCallback, useEffect, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { Illustration, PickImageResult } from '../../lib/bridge';

/**
 * Illustration slots for one chapter.
 *
 * The local file is the source of truth and the remote URL is derived, so a slot with
 * a path and no URL is a visible, unfinished state rather than an export-time surprise.
 * Uploading is the only action in the app that sends anything off the machine, so it is
 * never automatic.
 */

export interface IllustrationsState {
  slots: Illustration[];
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  pickImage: () => Promise<PickImageResult>;
  add: (input: {
    localPath: string;
    width: number | null;
    height: number | null;
    afterParagraphIndex: number;
    altText: string;
    caption: string;
  }) => Promise<Illustration>;
  upload: (id: string) => Promise<Illustration>;
}

export function useIllustrations(chapterId: string | null): IllustrationsState {
  const [slots, setSlots] = useState<Illustration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || chapterId === null) {
      setSlots([]);
      setIsLoading(false);
      return;
    }

    try {
      setSlots(await bridge.illustrations.listByChapter({ chapterId }));
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await; the lint rule cannot see the boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const pickImage = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    return bridge.illustrations.pickImage({});
  }, []);

  const add = useCallback<IllustrationsState['add']>(
    async (input) => {
      const bridge = getBridge();
      if (bridge === null || chapterId === null) {
        throw new Error('Open a chapter before adding an illustration.');
      }
      const created = await bridge.illustrations.createSlot({
        chapterId,
        localPath: input.localPath,
        width: input.width,
        height: input.height,
        afterParagraphIndex: input.afterParagraphIndex,
        altText: input.altText,
      });
      // Caption is optional on create, so it is only written when non-empty.
      if (input.caption.trim().length > 0) {
        const updated = await bridge.illustrations.updateSlot({
          id: created.id,
          afterParagraphIndex: input.afterParagraphIndex,
          altText: input.altText,
          caption: input.caption.trim(),
        });
        await reload();
        return updated;
      }
      await reload();
      return created;
    },
    [chapterId, reload],
  );

  const upload = useCallback(
    async (id: string) => {
      const bridge = getBridge();
      if (bridge === null) {
        throw new Error('Not running inside the StoryBoard app');
      }
      const uploaded = await bridge.illustrations.uploadToHost({ id });
      setSlots((current) =>
        current.map((slot) => (slot.id === id ? uploaded : slot)),
      );
      return uploaded;
    },
    [],
  );

  return { slots, isLoading, errorMessage, reload, pickImage, add, upload };
}
