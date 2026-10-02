import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  isInvalid?: boolean;
}

/**
 * Multi-line prose input.
 *
 * Uses the serif face because what lands here is the author's own prose, not a
 * label. Resizes vertically only: a horizontally resizable prose box breaks the
 * two-column layout it sits in.
 */
export function Textarea({ className, isInvalid = false, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={isInvalid || undefined}
      className={cn(
        'w-full resize-y rounded-md border bg-surface px-3 py-2 font-serif text-[15px] leading-relaxed text-ink',
        'placeholder:text-ink-muted/70 placeholder:font-sans placeholder:text-sm',
        'transition-colors duration-150',
        isInvalid ? 'border-danger' : 'border-line hover:border-line-strong',
        className,
      )}
      {...props}
    />
  );
}