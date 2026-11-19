/**
 * @file Shows a text someone wrote in a request: its description or a reply.
 * Every such text goes through this component, which shows it in the format
 * it was written in: plain text, or Markdown.
 */
import ExternalLink from '@/components/ui/external-link';
import MarkdownText from '@/components/ui/markdown/markdown-text';
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
 * A text as it was written: plain text with its line breaks, in its own
 * writing direction (`dir="auto"`, so a text in a right-to-left script can't
 * reorder the page around it). Web addresses written with `http://` or
 * `https://` are links ({@link ExternalLink}).
 *
 * @param props - Component props.
 * @param props.text - The text.
 * @param props.className - Extra classes for the paragraph.
 * @returns The text.
 */
function PlainText({ text, className }: { text: string; className: string }) {
  return (
    <p dir="auto" className={cn('wrap-anywhere whitespace-pre-wrap', className)}>
      {placed(splitLinks(text)).map((part) =>
        part.href === null ? (
          part.text
        ) : (
          <ExternalLink key={part.offset} href={part.href}>
            {part.text}
          </ExternalLink>
        ),
      )}
    </p>
  );
}

/**
 * A request's text, in the format it was stored with. A plain text is shown
 * as it was written. A Markdown text is shown formatted ({@link MarkdownText}),
 * unless formatting it would cost too much (a text nested hundreds of levels
 * deep): then it's shown as it was written, too.
 *
 * @param props - Component props.
 * @param props.text - The text and its format.
 * @param props.id - A name no other text on the page has, for the IDs inside a formatted text.
 * @param props.className - Extra classes for the element around the text.
 * @returns The text.
 */
export default function RequestText({
  text,
  id,
  className = '',
}: {
  text: RequestTextValue;
  id: string;
  className?: string;
}) {
  const plain = <PlainText text={text.text} className={className} />;
  if (text.format === 'markdown') {
    return <MarkdownText text={text.text} id={id} className={className} fallback={plain} />;
  }
  return plain;
}
