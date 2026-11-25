/**
 * @file Inline text link in the brand style.
 */
import Link from 'next/link';
import type { ComponentProps } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/**
 * Props for {@link TextLink}: a Next.js `Link`'s props, plus whether the
 * link stands on its own.
 */
interface TextLinkProps extends ComponentProps<typeof Link> {
  /**
   * The link isn't part of a sentence: it has a line, a table cell or a place
   * in a row of details to itself (a name in a list, "Forgot password?"
   * under its field). It's then underlined on hover only. Leave it off for a
   * link inside running text, which is underlined at rest.
   */
  standalone?: boolean;
}

/**
 * A Next.js link styled as a text link: the highlight colour and a medium
 * weight. Inside a sentence it's underlined, thinly at rest and thicker on
 * hover, so it's told apart from the text around it by more than its colour
 * (the highlight colour is 2.2:1 against body text in light mode and 1.6:1 in
 * dark mode; WCAG 1.4.1 asks for 3:1 or another cue). A `standalone` link,
 * with no text around it to be told apart from, is underlined on hover only.
 *
 * Its box reaches 2px above and below the text (`py-0.5`, cancelled by
 * `-my-0.5` so nothing around it moves), so a link on its own line is at
 * least 24px tall to tap (WCAG 2.5.8); inside a sentence the padding leaves
 * the line as it is.
 */
export default function TextLink({ standalone = false, className = '', ...props }: TextLinkProps) {
  return (
    <Link
      className={cn(
        '-my-0.5 rounded-sm py-0.5 font-medium text-highlight underline-offset-4',
        standalone ? 'hover:underline' : 'underline decoration-1 hover:decoration-2',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
