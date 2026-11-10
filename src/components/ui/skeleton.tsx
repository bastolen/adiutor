/**
 * @file Loading placeholders that match the size of the content they stand
 * in for, so nothing jumps when it arrives. Fixed widths always come with
 * `max-w-full`, so a placeholder never makes a narrow screen scroll sideways.
 */
import cn from '@/lib/cn';

import LoadingStatus from './loading-status';

/**
 * A grey placeholder block. Decorative.
 *
 * @param props - Skeleton props.
 * @param props.className - Size and shape classes.
 * @returns The block.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
    />
  );
}

/**
 * A loading page: a heading placeholder and a card placeholder. Screen readers
 * hear "Loading…" and the region is marked busy.
 *
 * @param props - Skeleton props.
 * @param props.header - Whether to include the heading placeholder; off for a page whose layout
 *   shows the header (with {@link PageHeaderSkeleton} while it loads).
 * @returns The loading state.
 */
export function PageSkeleton({ header = true }: { header?: boolean } = {}) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <LoadingStatus />
      {header && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      )}
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

/**
 * A loading page header with section tabs, for a layout that loads its header
 * apart from the page: an avatar, a heading, a description and a row of tabs.
 * It doesn't announce anything: the page's own skeleton says "Loading…".
 *
 * The text column needs `min-w-0`, like the real `PageHeader`'s: a flex item
 * can't get narrower than its content, and `max-w-full` on the placeholders
 * doesn't count toward that minimum, so without it the column stays 320px
 * wide and the page scrolls sideways on a narrow screen while it loads.
 *
 * @returns The loading header.
 */
export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-10 w-64 max-w-full" />
    </div>
  );
}

/**
 * A loading form: a heading and a few field placeholders. Screen readers hear
 * "Loading…" and the region is marked busy.
 *
 * @returns The loading state.
 */
export function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <LoadingStatus />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
