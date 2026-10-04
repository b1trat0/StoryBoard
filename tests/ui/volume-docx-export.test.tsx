// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolumeDocxExport } from '../../src/features/export/volume-docx-export.js';
import type { OutlineVolumeNode, VolumeDocxExportResult } from '../../src/lib/bridge.js';

/**
 * The volume `.docx` panel.
 *
 * Two things are under test here. The panel states its own scope before the click,
 * because an author who does not know images and interludes are excluded will read
 * their absence as a bug later. And it reports what the written file left out, because
 * a `.docx` carries no images and no way to say so inside itself.
 */

const VOLUME_A = '70000000-0000-4000-8000-000000000001';
const VOLUME_B = '70000000-0000-4000-8000-000000000002';

function volumeFixture(overrides: Partial<OutlineVolumeNode> = {}): OutlineVolumeNode {
  return {
    id: VOLUME_A,
    projectId: '10000000-0000-4000-8000-000000000001',
    title: 'Volume One',
    ordinal: 1,
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    arcs: [],
    ...overrides,
  };
}

function writtenFixture(
  overrides: Partial<Extract<VolumeDocxExportResult, { status: 'written' }>> = {},
): VolumeDocxExportResult {
  return {
    status: 'written',
    filePath: 'C:\\exports\\Volume One.docx',
    volumeTitle: 'Volume One',
    chapterCount: 12,
    excludedChapterCount: 0,
    droppedImageCount: 0,
    droppedNoteCount: 0,
    warnings: [],
    ...overrides,
  };
}

/** Installs a bridge whose export returns `outcome`, and returns the spy. */
function installBridge(outcome: VolumeDocxExportResult | Error) {
  const exportVolumeDocx = vi.fn(async () => {
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  });
  (globalThis as { window?: Window }).window!.storyboard = {
    release: { exportVolumeDocx },
  } as never;
  return { exportVolumeDocx };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('choosing a volume', () => {
  it('exports the first volume without being asked twice', async () => {
    // The derived selection means one click is enough. Asking again would make the
    // author pick a volume that is already showing.
    const { exportVolumeDocx } = installBridge(writtenFixture());
    render(<VolumeDocxExport volumes={[volumeFixture(), volumeFixture({ id: VOLUME_B, title: 'Volume Two' })]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    await waitFor(() =>
      expect(exportVolumeDocx).toHaveBeenCalledWith({ volumeId: VOLUME_A }),
    );
  });

  it('exports whichever volume is selected', async () => {
    const { exportVolumeDocx } = installBridge(writtenFixture());
    render(<VolumeDocxExport volumes={[volumeFixture(), volumeFixture({ id: VOLUME_B, title: 'Volume Two' })]} isLoading={false} />);

    fireEvent.change(screen.getByLabelText(/volume document/i), { target: { value: VOLUME_B } });
    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    await waitFor(() =>
      expect(exportVolumeDocx).toHaveBeenCalledWith({ volumeId: VOLUME_B }),
    );
  });

  it('says the file is text only before anything is written', () => {
    // The exclusion has to be stated up front. Discovered after the fact, it reads as
    // the app losing work.
    installBridge(writtenFixture());
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    const scope = screen.getByText(/interludes, images and author notes are not included/i);
    expect(scope).toBeTruthy();
  });

  it('disables the button and offers nothing to pick when there are no volumes', () => {
    installBridge(writtenFixture());
    render(<VolumeDocxExport volumes={[]} isLoading={false} />);

    expect((screen.getByRole('button', { name: /export \.docx/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no volumes yet/i)).toBeTruthy();
  });
});

describe('reporting the written file', () => {
  it('shows the path so the author can find the file', async () => {
    installBridge(writtenFixture());
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    expect(await screen.findByText(/Volume One: 12 chapters written/i)).toBeTruthy();
    expect(screen.getByText('C:\\exports\\Volume One.docx')).toBeTruthy();
  });

  it('says how many chapters were left out of the document', async () => {
    installBridge(writtenFixture({ chapterCount: 10, excludedChapterCount: 2 }));
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    expect(await screen.findByText(/10 chapters written, 2 chapters left out/i)).toBeTruthy();
  });

  it('names the images and author notes it could not carry', async () => {
    installBridge(writtenFixture({ droppedImageCount: 6, droppedNoteCount: 1 }));
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    // The whole point of the counts: the document cannot say this, so the screen must.
    // The guidance has to be actionable too, or the author knows what is missing and
    // still does not know what to do instead.
    expect(await screen.findByText(/6 images, 1 author note/i)).toBeTruthy();
    expect(screen.getByText(/publish illustrated chapters individually/i)).toBeTruthy();
  });

  it('leaves out the exclusions line when nothing was excluded', async () => {
    installBridge(writtenFixture({ chapterCount: 12, excludedChapterCount: 0 }));
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    expect(await screen.findByText(/Volume One: 12 chapters written/i)).toBeTruthy();
    expect(screen.queryByText(/left out/i)).toBeNull();
  });

  it('lists every warning the export reported', async () => {
    installBridge(
      writtenFixture({
        warnings: [
          {
            code: 'dropped_image',
            severity: 'warning',
            message: '6 illustrations are not in the Word document.',
          },
          {
            code: 'unconverted_markdown',
            severity: 'warning',
            message: 'Chapter 4 has markdown that will not convert.',
          },
        ],
      }),
    );
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    expect(await screen.findByText(/6 illustrations are not in the Word document/i)).toBeTruthy();
    expect(screen.getByText(/Chapter 4 has markdown that will not convert/i)).toBeTruthy();
  });
});

describe('a cancelled export', () => {
  it('says nothing, because closing the dialog was the author\u2019s decision', async () => {
    // Reporting a cancellation as a failure would train the author to distrust the
    // button they just used on purpose.
    installBridge({ status: 'cancelled' });
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /export \.docx/i })).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/cancel/i)).toBeNull();
  });

  it('leaves the button usable for a second attempt', async () => {
    installBridge({ status: 'cancelled' });
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /export \.docx/i }) as HTMLButtonElement).disabled).toBe(false),
    );
  });
});

describe('a refused export', () => {
  it('shows the blockers and confirms nothing was written', async () => {
    // Blockers stop the write entirely, so the author must be told a file does not
    // exist rather than left hunting for one.
    // The message is the service's own wording, because the panel claims "nothing was
    // exported" on top of it and the two sentences have to agree.
    installBridge(
      new Error(
        'Volume One is not ready to export yet:\n\n- Chapter 4 has an image with no public URL.\n\nNothing was written. Fix these and try again.',
      ),
    );
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/nothing was exported/i)).toBeTruthy();
    expect(screen.getByText(/no public URL/i)).toBeTruthy();
  });

  it('can be dismissed once read', async () => {
    installBridge(new Error('The export failed.'));
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not blame the author for a cancelled write as an error', async () => {
    // Cancelling is a result value, so it never reaches this branch. The test exists
    // to pin that: if a future refactor reported cancel as a rejection, the panel
    // would claim nothing was exported when nothing was attempted.
    installBridge({ status: 'cancelled' });
    render(<VolumeDocxExport volumes={[volumeFixture()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('switching volume', () => {
  it('clears the previous result so counts cannot be misread', async () => {
    // The result of an export of Volume One says "12 chapters". Left up after picking
    // Volume Two, it reads as a result for Volume Two.
    installBridge(writtenFixture());
    const volumes = [volumeFixture(), volumeFixture({ id: VOLUME_B, title: 'Volume Two' })];
    render(<VolumeDocxExport volumes={volumes} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: /export \.docx/i }));
    await screen.findByText(/12 chapters written/i);
    fireEvent.change(screen.getByLabelText(/volume document/i), { target: { value: VOLUME_B } });

    expect(screen.queryByText(/12 chapters written/i)).toBeNull();
  });
});