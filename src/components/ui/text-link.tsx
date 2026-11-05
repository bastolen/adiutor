/**
 * @file Inline text link in the brand style.
 */
import Link from 'next/link';
import type { ComponentProps } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/**
 * A Next.js link styled as an inline text link: the highlight colour,
 * underlined on hover with a comfortable offset.
 *
 * @param props - Link props.
 * @param props.className - Extra classes.
 * @returns The link.
 */
export default function TextLink({ className = '', ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        'rounded-sm font-medium text-highlight underline-offset-4 hover:underline',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
