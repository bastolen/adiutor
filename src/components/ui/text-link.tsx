/**
 * @file Inline text link in the brand style.
 */
import Link from 'next/link';
import type { ComponentProps } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/**
 * A Next.js link styled as an inline text link: the highlight colour,
 * underlined on hover with a comfortable offset. Its box reaches 2px above and
 * below the text (`py-0.5`, cancelled by `-my-0.5` so nothing around it
 * moves), so a link on its own line is at least 24px tall to tap (WCAG 2.5.8);
 * inside a sentence the padding leaves the line as it is.
 *
 * @param props - Link props.
 * @param props.className - Extra classes.
 * @returns The link.
 */
export default function TextLink({ className = '', ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        '-my-0.5 rounded-sm py-0.5 font-medium text-highlight underline-offset-4 hover:underline',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
