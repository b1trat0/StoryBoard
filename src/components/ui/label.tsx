import type { LabelHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders helper text under the label and connects it via aria-describedby. */
  hint?: string;
}

/**
 * Field label.
 *
 * Always rendered, never replaced by a placeholder. A placeholder disappears the
 * moment the field has content, which leaves a bare box with no indication of
 * what belonged in it.
 */
export function Label({ className, children, hint, ...props }: LabelProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label
        className={cn('text-[13px] font-medium text-ink-soft', className)}
        {...props}
      >
        {children}
      </label>
      {hint !== undefined && (
        <span className="text-xs text-ink-muted">{hint}</span>
      )}
    </div>
  );
}