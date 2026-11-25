/**
 * @file Small spinning indicator for work in progress.
 */
import { LoaderCircle } from 'lucide-react';

import cn from '@/lib/cn';

/**
 * A spinner. Decorative: the surrounding control announces the busy state
 * (e.g. with `aria-busy`).
 *
 * @param props - Spinner props.
 * @param props.className - Extra classes, e.g. a size.
 */
export default function Spinner({ className = '' }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
    />
  );
}
