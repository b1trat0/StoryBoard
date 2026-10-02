import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field invalid and wires up the aria-invalid state. */
  isInvalid?: boolean;
}

/**
 * Text input.
 *
 * Placeholder text is deliberately muted further than the label: a placeholder
 * is a hint about format, not a label, and when the two are the same weight the
 * author cannot tell an empty field from an unfilled one.
 */
export function Input({ className, isInvalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={isInvalid || undefined}
      className={cn(
        'h-9 w-full rounded-md border bg-surface px-3 text-sm text-ink',
        'placeholder:text-ink-muted/70',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken',
        isInvalid ? 'border-danger' : 'border-line hover:border-line-strong',
        className,
      )}
      {...props}
    />
  );
}