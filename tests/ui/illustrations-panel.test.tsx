// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IllustrationsPanel } from '../../src/features/illustrations/illustrations-panel.js';
import { countParagraphs } from '../../src/lib/chapter-text.js';
import type { Illustration, StoryBoardBridge } from '../../src/lib/bridge.js';
import { installDialogPolyfill } from '../helpers/jsdom-dialog.js';

installDialogPolyfill();

/**
 * Illustrations.
 *
 * The two rules worth testing: an anchor past the end of the chapter is reported rather
 * than silently corrected, and uploading — the only action that sends anything off the
 * machine — asks first.
 */

const CHAPTER_ID = '40000000-0000-4000-8000-000000000001';

function slot(overrides: Partial<Illustration> = {}): Illustration {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    chapterId: CHAPTER_ID,
    afterParagraphIndex: 2,
    localPath: 'D:\\art\\kael-writ.png',
    remoteUrl: null,
    provider: 'manual',
    width: 900,
    height: 600,
    altText: 'Kael holding the burning writ',
    caption: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function installBridge(slots: Illustration[]): {
  upload: ReturnType<typeof vi.fn>;
  pickImage: ReturnType<typeof vi.fn>;
  createSlot: ReturnType<typeof vi.fn>;
} {
  const upload = vi.fn(async () => slot({ remoteUrl: 'https://files.catbox.moe/x.png' }));
  const pickImage = vi.fn(async () => ({
    status: 'picked' as const,
    filePath: 'D:\\art\\kael-writ.png',
    width: 900,
    height: 600,
  }));
  const createSlot = vi.fn(async () => slot());

  (window as unknown as { storyboard: StoryBoardBridge }).storyboard = {
    illustrations: {
      listByChapter: vi.fn(async () => slots),
      createSlot,
      updateSlot: vi.fn(),
      uploadToHost: upload,
      pickImage,
    },
  } as unknown as StoryBoardBridge;

  return { upload, pickImage, createSlot };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { storyboard?: StoryBoardBridge }).storyboard;
});

describe('showing slots', () => {
  it('shows the file, the anchor and that it is not uploaded', async () => {
    installBridge([slot()]);
    render(<IllustrationsPanel chapterId={CHAPTER_ID} paragraphCount={8} />);

    expect(await screen.findByText('kael-writ.png')).toBeTruthy();
    expect(screen.getByText(/after paragraph 2/)).toBeTruthy();
    expect(screen.getByText('Not uploaded')).toBeTruthy();
  });

  it('flags an anchor beyond the end of the chapter instead of moving it', async () => {
    installBridge([slot({ afterParagraphIndex: 12 })]);
    render(<IllustrationsPanel chapterId={CHAPTER_ID} paragraphCount={8} />);

    expect(await screen.findByText(/chapter now has 8/i)).toBeTruthy();
    // The stored anchor is unchanged; the author decides where it belongs.
    expect(screen.getAllByText(/after paragraph 12/).length).toBeGreaterThan(0);
  });

  it('does not flag an in-range anchor', async () => {
    installBridge([slot()]);
    render(<IllustrationsPanel chapterId={CHAPTER_ID} paragraphCount={8} />);

    await screen.findByText('kael-writ.png');
    expect(screen.queryByText(/chapter now has/i)).toBeNull();
  });
});

describe('adding an image', () => {
  it('requires alt text before it can be added', async () => {
    const { createSlot, pickImage } = installBridge([]);
    render(<IllustrationsPanel chapterId={CHAPTER_ID} paragraphCount={8} />);

    fireEvent.click(await screen.findByRole('button', { name: /add image/i }));
    fireEvent.click(screen.getByRole('button', { name: /choose image/i }));

    await waitFor(() => expect(pickImage).toHaveBeenCalled());

    const addButton = screen.getByRole('button', { name: /^add illustration$/i });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(addButton);

    expect(createSlot).not.toHaveBeenCalled();
  });

  it('records the picked file with its real dimensions and alt text', async () => {
    const { createSlot } = installBridge([]);
    render(<IllustrationsPanel chapterId={CHAPTER_ID} paragraphCount={8} />);

    fireEvent.click(await screen.findByRole('button', { name: /add image/i }));
    fireEvent.click(screen.getByRole('button', { name: /choose image/i }));
    await screen.findByText('900 × 600 px');

    fireEvent.change(screen.getByLabelText('Alt text'), {
      target: { value: 'Kael holding the burning writ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add illustration$/i }));

    await waitFor(() =>
      expect(createSlot).toHaveBeenCalledWith({
        chapterId: CHAPTER_ID,
        localPath: 'D:\\art\\kael-writ.png',
        width: 900,
        height: 600,
        afterParagraphIndex: 0,
        altText: 'Kael holding the burning writ',
      }),
    );
  });
});

describe('uploading', () => {
  it('asks before sending anything off the machine', async () => {
    const { upload } = installBridge([slot()]);
    render(<IllustrationsPanel chapterId={CHAPTER_ID} paragraphCount={8} />);

    fireEvent.click(await screen.findByRole('button', { name: /upload/i }));

    expect(
      await screen.findByText(/sent to api\.catbox\.moe/i),
    ).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /upload to catbox/i }));

    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith({
        id: '77777777-7777-4777-8777-777777777777',
      }),
    );
  });
});

describe('counting paragraphs the export way', () => {
  it('treats a blank line as a break and a single newline as not one', () => {
    expect(countParagraphs('one\ntwo\n\nthree')).toBe(2);
    expect(countParagraphs('  \n\n ')).toBe(0);
  });
});
