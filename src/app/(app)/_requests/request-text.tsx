/**
 * @file Shows a text someone wrote in a request: its description or a reply.
 * Every such text goes through this component, so the day texts can be
 * written in another format (Markdown), this is the one place that changes.
 */
import { useTranslations } from 'next-intl';

import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import { splitLinks, type TextPart } from '@/lib/requests';
import type { RequestText as RequestTextValue } from '@/server/requests';

/** A piece of a text with where it starts, which makes a stable key. */
interface PlacedPart extends TextPart {
  /** The piece's offset in the text. */
  offset: number;
}

/**
 * Notes where each piece of a text starts.
 *
 * @param parts - The pieces, in order.
 * @returns The pieces with their offsets.
 */
function placed(parts: TextPart[]): PlacedPart[] {
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.text.length;
    return { ...part, offset: at };
  });
}

/**
 * A request's text as it was written: plain text with its line breaks, in
 * its own writing direction (`dir="auto"`, so a text in a right-to-left
 * script can't reorder the page around it). Web addresses written with
 * `http://` or `https://` are links that open in a new tab, which a screen
 * reader hears. They're links someone else wrote, so the page they open gets
 * no referrer, no way back to this window and no ranking from the link.
 *
 * @param props - Component props.
 * @param props.text - The text and its format.
 * @param props.className - Extra classes for the paragraph.
 * @returns The text.
 */
export default function RequestText({
  text,
  className = '',
}: {
  text: RequestTextValue;
  className?: string;
}) {
  const t = useTranslations('requests.text');
  // Only plain text exists today; another format gets its own rendering here.
  return (
    <p dir="auto" className={cn('wrap-anywhere whitespace-pre-wrap', className)}>
      {placed(splitLinks(text.text)).map((part) =>
        part.href === null ? (
          part.text
        ) : (
          <a
            key={part.offset}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              'rounded-sm font-medium text-highlight underline underline-offset-4',
              focusRing,
            )}
          >
            {part.text}
            <span className="sr-only"> {t('newTab')}</span>
          </a>
        ),
      )}
    </p>
  );
}
