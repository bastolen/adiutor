/**
 * @file A horizontal rule with a short label in the middle, e.g. "or", that
 * separates alternative ways to continue.
 */
import type { ReactNode } from 'react';

/**
 * Props for {@link AuthDivider}.
 */
interface AuthDividerProps {
  /** The label between the two lines, e.g. "or". */
  children: ReactNode;
}

/**
 * A line, the label and another line. The lines are decorative; the label is
 * read as text.
 *
 * @param props - Divider props.
 * @param props.children - The label.
 * @returns The divider.
 */
export default function AuthDivider({ children }: AuthDividerProps) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
