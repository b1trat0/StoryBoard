import { ImageSquare, UploadSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import type { Illustration } from '../../lib/bridge';
import { useIllustrations } from './use-illustrations';

export interface IllustrationsPanelProps {
  chapterId: string | null;
  /** Paragraph count of the current prose, for the anchor warning. */
  paragraphCount: number;
}

/** Last path segment, for showing a filename without the whole path. */
function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/**
 * Illustrations for one chapter.
 *
 * Anchored by paragraph index, never by character offset: an offset breaks on every
 * edit above the image, while a paragraph index only needs attention when the chapter
 * itself gets shorter. When it does, the slot is flagged rather than silently moved,
 * because an image that jumps a scene is worse than one that is visibly misplaced.
 */
export function IllustrationsPanel({
  chapterId,
  paragraphCount,
}: IllustrationsPanelProps) {
  const illustrations = useIllustrations(chapterId);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<Illustration | null>(null);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Illustrations
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsAddOpen(true)}
          disabled={chapterId === null}
        >
          <ImageSquare size={14} aria-hidden="true" />
          Add image
        </Button>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        Placed after a paragraph. The local file stays the source of truth; publishing
        needs it uploaded, which sends it to a public image host.
      </p>

      {illustrations.errorMessage !== null && (
        <p role="alert" className="text-[12px] text-danger">
          {illustrations.errorMessage}
        </p>
      )}

      {illustrations.isLoading ? (
        <p className="text-[12.5px] text-ink-muted">Loading illustrations…</p>
      ) : illustrations.slots.length === 0 ? (
        <p className="text-[12.5px] italic text-ink-muted">
          No images in this chapter.
        </p>
      ) : (
        <ul className="space-y-2">
          {illustrations.slots.map((slot) => {
            const isMisplaced = slot.afterParagraphIndex > paragraphCount;
            return (
              <li
                key={slot.id}
                className="rounded-md border border-line bg-surface px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-ink-soft">
                    {fileName(slot.localPath)}
                  </span>
                  <span className="text-[11.5px] text-ink-muted">
                    after paragraph {slot.afterParagraphIndex}
                  </span>
                  {slot.remoteUrl === null ? (
                    <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-warn">
                      Not uploaded
                    </span>
                  ) : (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-accent">
                      Uploaded
                    </span>
                  )}
                  {slot.remoteUrl === null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setUploadTarget(slot)}
                    >
                      <UploadSimple size={13} aria-hidden="true" />
                      Upload
                    </Button>
                  )}
                </div>
                {isMisplaced && (
                  <p className="mt-1.5 text-[12px] text-danger">
                    This image sits after paragraph {slot.afterParagraphIndex}, but the
                    chapter now has {paragraphCount}. Re-anchor it deliberately; it has
                    not been moved for you.
                  </p>
                )}
                <p className="mt-1 text-[12px] text-ink-muted">
                  Alt: {slot.altText}
                  {slot.caption.trim().length > 0 && ` · ${slot.caption}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {isAddOpen && chapterId !== null && (
        <AddIllustrationDialog
          paragraphs={paragraphCount}
          onClose={() => setIsAddOpen(false)}
          onPick={illustrations.pickImage}
          onSubmit={async (input) => {
            await illustrations.add(input);
            setIsAddOpen(false);
          }}
        />
      )}

      {uploadTarget !== null && (
        <UploadConfirmDialog
          slot={uploadTarget}
          onCancel={() => setUploadTarget(null)}
          onConfirm={async () => {
            await illustrations.upload(uploadTarget.id);
            setUploadTarget(null);
          }}
        />
      )}
    </section>
  );
}

interface AddIllustrationDialogProps {
  paragraphs: number;
  onClose: () => void;
  onPick: () => Promise<
    { status: 'picked'; filePath: string; width: number | null; height: number | null } | { status: 'cancelled' }
  >;
  onSubmit: (input: {
    localPath: string;
    width: number | null;
    height: number | null;
    afterParagraphIndex: number;
    altText: string;
    caption: string;
  }) => Promise<void>;
}

/** Choosing the file, its alt text and its anchor. Alt text is required to save. */
function AddIllustrationDialog({
  paragraphs,
  onClose,
  onPick,
  onSubmit,
}: AddIllustrationDialogProps) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [afterParagraphIndex, setAfterParagraphIndex] = useState(0);
  const [altText, setAltText] = useState('');
  const [caption, setCaption] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit =
    filePath !== null && altText.trim().length > 0 && !isSubmitting;

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Add an illustration"
      description="The file stays on this machine until you upload it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (filePath === null) {
                return;
              }
              setIsSubmitting(true);
              setErrorMessage(null);
              void onSubmit({
                localPath: filePath,
                width,
                height,
                afterParagraphIndex,
                altText: altText.trim(),
                caption,
              })
                .catch((err: unknown) => {
                  setErrorMessage(
                    err instanceof Error ? err.message : 'The image was not added.',
                  );
                })
                .finally(() => setIsSubmitting(false));
            }}
            disabled={!canSubmit}
          >
            {isSubmitting ? 'Adding…' : 'Add illustration'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="illustration-file">File</Label>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void onPick().then((result) => {
                  if (result.status === 'picked') {
                    setFilePath(result.filePath);
                    setWidth(result.width);
                    setHeight(result.height);
                  }
                });
              }}
            >
              Choose image
            </Button>
            <span className="min-w-0 truncate font-mono text-[12px] text-ink-soft">
              {filePath === null ? 'No file chosen' : fileName(filePath)}
            </span>
          </div>
          {width !== null && height !== null && (
            <p className="text-[11.5px] text-ink-muted">
              {width} × {height} px
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="illustration-anchor" hint={`0–${paragraphs}`}>
              After paragraph
            </Label>
            <Input
              id="illustration-anchor"
              type="number"
              min={0}
              max={paragraphs}
              value={afterParagraphIndex}
              onChange={(event) => setAfterParagraphIndex(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="illustration-alt">Alt text</Label>
            <Input
              id="illustration-alt"
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              placeholder="Kael holding the burning writ"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="illustration-caption" hint="optional">
            Caption
          </Label>
          <Textarea
            id="illustration-caption"
            rows={2}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Royal Road has no caption field, so this is rendered as a paragraph under the image."
          />
        </div>

        {errorMessage !== null && (
          <p role="alert" className="text-[12.5px] text-danger">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}

interface UploadConfirmDialogProps {
  slot: Illustration;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * The one action that leaves the machine.
 *
 * It is a dialog rather than a silent button because uploading makes the image public
 * and permanent on the host: there is no delete afterwards, and the URL is what a
 * published chapter will hotlink for as long as it exists.
 */
function UploadConfirmDialog({
  slot,
  onCancel,
  onConfirm,
}: UploadConfirmDialogProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <Dialog
      isOpen
      onClose={onCancel}
      title="Upload this image?"
      description={`${fileName(slot.localPath)} will be sent to api.catbox.moe and get a public, permanent URL.`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setIsUploading(true);
              setErrorMessage(null);
              void onConfirm()
                .catch((err: unknown) => {
                  setErrorMessage(
                    err instanceof Error ? err.message : 'The upload failed.',
                  );
                })
                .finally(() => setIsUploading(false));
            }}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading…' : 'Upload to Catbox'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-soft">
        This is the only action in StoryBoard that sends anything off this machine. The
        local file remains the source of truth, and a published chapter will hotlink the
        public URL — so an image you would not publish should not be uploaded.
      </p>
      {errorMessage !== null && (
        <p role="alert" className="mt-3 text-[12.5px] text-danger">
          {errorMessage}
        </p>
      )}
    </Dialog>
  );
}
