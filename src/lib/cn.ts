/**
 * @file Combines class names, letting later Tailwind classes override earlier
 * conflicting ones (e.g. a `className` prop overriding a default padding).
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and resolves Tailwind conflicts.
 *
 * @param inputs - Class names, arrays or `{ class: condition }` objects.
 * @returns The combined class string.
 */
export default function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
