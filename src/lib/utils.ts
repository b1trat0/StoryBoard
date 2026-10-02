import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, letting later Tailwind utilities win over earlier ones.
 *
 * Without the merge step a component's own padding would be impossible to
 * override from a call site, because both classes end up in the class list and
 * specificity decides rather than intent.
 *
 * @param inputs - Class values, conditions or arrays of them
 * @returns A single deduplicated class string
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}