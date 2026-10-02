import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Empty state.
 *
 * An empty list is the first thing a new user sees, so it has to say what goes
 * here and offer the action that fills it. "No data" is a dead end.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center',
        className,
      )}
      {...props}
    >
      {icon !== undefined && (
        <span className="text-ink-muted/70" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-[13px] leading-relaxed text-ink-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

/** A pulsing block standing in for a list row while the first load is in flight. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}