import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { getBridge } from '../../lib/bridge';
import type { ProjectKind } from '../../lib/bridge';

export interface ProjectCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Creates the work and opens it. Rejections are shown inline. */
  onSubmit: (input: {
    title: string;
    kind: ProjectKind;
    exportProfile: 'royal_road' | 'plain';
    storageRoot: string;
  }) => Promise<void>;
}

/**
 * Creating a work.
 *
 * Two choices are asked for because they are hard to change later in the author's
 * head, not just in the database: what kind of book this is, and which publishing
 * rules apply to it. A plain novel should not be told it is too short for a web
 * serial, and a Royal Road serial should not lose those checks.
 */
export function ProjectCreateDialog({
  isOpen,
  onClose,
  onSubmit,
}: ProjectCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ProjectKind>('light_novel');
  const [exportProfile, setExportProfile] = useState<'royal_road' | 'plain'>(
    'royal_road',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [chooseStorageRoot, setChooseStorageRoot] = useState('');

  function reset(): void {
    setTitle('');
    setKind('light_novel');
    setExportProfile('royal_road');
    setErrorMessage(null);
    setChooseStorageRoot('');
  }

  function close(): void {
    reset();
    onClose();
  }

  async function submit(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setErrorMessage('Give the work a title first.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSubmit({ title: trimmed, kind, exportProfile, storageRoot: chooseStorageRoot });
      reset();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'The work was not created.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="New work"
      description="A work is one manuscript with its own cast, outline and continuity record."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create work'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="work-title">Title</Label>
          <Input
            id="work-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The Ash Gate"
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="work-kind">Kind</Label>
            <select
              id="work-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as ProjectKind)}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value="light_novel">Light novel</option>
              <option value="novel">Novel</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="work-profile">Publishing</Label>
            <select
              id="work-profile"
              value={exportProfile}
              onChange={(event) =>
                setExportProfile(event.target.value as 'royal_road' | 'plain')
              }
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value="royal_road">Royal Road</option>
              <option value="plain">Plain manuscript</option>
            </select>
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-ink-muted">
          Royal Road applies that site's length and publishability checks. Plain
          manuscript skips them, so a normal book is not told it is too short for a web
          serial.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="work-storage" hint="optional">
            Data folder
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="work-storage"
              value={chooseStorageRoot}
              readOnly
              placeholder="The app's default folder"
              className="font-mono text-[12px]"
            />
            <Button
              variant="secondary"
              onClick={() => {
                void getBridge()
                  ?.system.pickDirectory({})
                  .then((result) => {
                    if (result.status === 'picked') {
                      setChooseStorageRoot(result.directory);
                    }
                  });
              }}
            >
              Choose…
            </Button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            Where this work's exports, archive and illustration files go. Each work can
            keep its files somewhere different; leaving it empty uses the app default.
          </p>
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
