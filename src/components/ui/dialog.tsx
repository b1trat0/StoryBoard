import { X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from '../../lib/utils';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal dialog built on the native <dialog> element.
 *
 * The platform element supplies the focus trap, the inert background, Escape to
 * close and top-layer stacking. Reimplementing any of that in a component is how
 * modals end up leaking focus to the page behind them, and none of it is worth
 * reimplementing when the browser already does it correctly.
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    if (isOpen && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      // The native cancel event fires for Escape. Left unhandled the dialog would
      // close visually while React state still believed it was open.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-labelledby="dialog-title"
      className={cn(
        'm-auto w-[min(560px,calc(100vw-48px))] rounded-xl border border-line bg-surface p-0 text-ink shadow-[0_24px_48px_-12px_rgb(27_27_25/0.18)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h2 id="dialog-title" className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description !== undefined && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0"
        >
          <X size={16} weight="bold" />
        </Button>
      </div>

      <div className="px-6 py-5">{children}</div>

      {footer !== undefined && (
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken/60 px-6 py-3.5">
          {footer}
        </div>
      )}
    </dialog>
  );
}