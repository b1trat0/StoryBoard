import { cva } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Button.
 *
 * Three variants and three sizes rather than a `variant` prop typed as string,
 * so an invalid combination is a compile error and not a silently unstyled
 * button at runtime.
 */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-medium rounded-md ' +
    'transition-colors duration-150 select-none whitespace-nowrap ' +
    // The 1px downward nudge on press is what makes a button feel like a button.
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        // Primary text on white fails contrast outright; the deep accent is what
        // clears WCAG AA against white text.
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary: 'bg-surface text-ink border border-line hover:bg-surface-sunken',
        ghost: 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
        danger: 'bg-surface text-danger border border-line hover:bg-danger-soft',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-5 text-[15px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

/** A button whose label and icon stay on one line at any width. */
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}