import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';

export interface DiscardDraftDialogProps {
  isOpen: boolean;
  /** Title of the chapter the buffer belongs to, named so the choice is concrete. */
  chapterTitle: string;
  onCancel: () => void;
  onDiscard: () => void;
}

/**
 * Asks before throwing away prose that was never saved.
 *
 * Switching chapters is the one navigation that genuinely destroys the buffer, so it
 * asks first. Moving between sections no longer needs a prompt, because the buffer
 * lives above the section switch and survives the trip.
 *
 * Cancelling is the safe default and what Escape and the close button do: an author who
 * clicked the wrong chapter in a tree of forty should not lose a paragraph to a stray
 * keystroke.
 */
export function DiscardDraftDialog({
  isOpen,
  chapterTitle,
  onCancel,
  onDiscard,
}: DiscardDraftDialogProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title="Leave this chapter?"
      description={`"${chapterTitle}" has prose you have not saved.`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Keep writing
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            Discard and switch
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Switching chapters discards them. Saving first is the only way to keep them —
        once discarded, they are gone from this machine and were never in the database.
      </p>
    </Dialog>
  );
}