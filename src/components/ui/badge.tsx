/**
 * @file Small label for statuses and roles. Always carries text, so meaning
 * never depends on colour alone. A status keeps the same tone on every screen
 * (`badge-tones.test.ts` checks it).
 */
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

/** Classes per badge tone. */
const toneClasses = {
  /** Neutral information, e.g. a role. */
  neutral: 'border-border bg-muted text-foreground',
  /** Something good or active. */
  success: 'border-transparent bg-success-soft text-success',
  /** Something that needs attention, e.g. expired. */
  warning: 'border-transparent bg-warning-soft text-warning',
  /** Something stopped or failed, e.g. deactivated or revoked. */
  danger: 'border-transparent bg-danger-soft text-danger',
  /** Brand emphasis, e.g. the staff. */
  brand: 'border-transparent bg-primary text-primary-foreground',
  /**
   * Outlined in the accent colour links use, for what's about the viewer,
   * e.g. "You" on their own row in a table of people.
   */
  accent: 'border-highlight bg-transparent text-highlight',
} as const;

/** A badge tone. */
export type BadgeTone = keyof typeof toneClasses;

/**
 * Props for {@link Badge}.
 */
interface BadgeProps {
  /** Colour meaning. Defaults to `neutral`. */
  tone?: BadgeTone;
  /** The label. */
  children: ReactNode;
}

/**
 * A small rounded label.
 *
 * @param props - Badge props.
 * @param props.tone - Colour meaning.
 * @param props.children - The label.
 * @returns The badge.
 */
export default function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
