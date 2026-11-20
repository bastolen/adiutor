/**
 * @file Shows a text someone wrote in a request: its description or a reply.
 * Every such text goes through this component, which shows it in the format
 * it was written in: plain text, or Markdown.
 */
import { useLocale, useTranslations } from 'next-intl';

import ExternalLink from '@/components/ui/external-link';
import type { ShownMention } from '@/components/ui/markdown/elements';
import MarkdownText from '@/components/ui/markdown/markdown-text';
import cn from '@/lib/cn';
import formatDate from '@/lib/format';
import { nameStoredMentions, splitLinks, type TextPart } from '@/lib/requests';
import type { RequestText as RequestTextValue } from '@/server/requests';

import { personName, type SideNames } from './request-person';

/**
 * Where a text is from: what the note above code copied from it says, so
 * the code can be traced back to the request once it's pasted somewhere.
 */
export interface TextSource {
  /** The whole address of the page of the request the text is in. */
  url: string;
  /**
   * Who wrote it, as the page names them (`personName`): what the reader
   * sees next to the text already, never more.
   */
  writer: string;
  /** When they wrote it. */
  at: Date;
}

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
 * The people a text mentions, as the text shows them: by the name the page
 * gives them (their own, or their side's), set apart when it's the reader,
 * and linked to the user's page for a reader who got their ID (the staff).
 * Someone shown by their side's name is never a link, as elsewhere.
 *
 * @param mentions - The text's mentions, as the request's service gave them.
 * @param names - The names of the two sides.
 * @returns The mentions, by the ID their marker in the text names.
 */
function shownMentions(
  mentions: RequestTextValue['mentions'],
  names: SideNames,
): Record<string, ShownMention> {
  return Object.fromEntries(
    Object.entries(mentions ?? {}).map(([id, person]) => [
      id,
      {
        name: personName(person, names),
        isViewer: person.isViewer,
        href:
          person.userId !== null && person.name !== null ? `/admin/users/${person.userId}` : null,
      },
    ]),
  );
}

/**
 * A Markdown text, formatted ({@link MarkdownText}). Code copied from it
 * starts with a note of where it's from: the request's address, then who
 * wrote the text and on which day, in the reader's language. The people it
 * mentions are named as the page names them; a text that's shown as it was
 * written, because formatting it would cost too much, names them too.
 *
 * @param props - Component props.
 * @param props.text - The text.
 * @param props.id - The text's name on the page.
 * @param props.className - Extra classes for the element around the text.
 * @param props.source - Where the text is from.
 * @param props.mentions - The people the text mentions.
 * @returns The text.
 */
function FormattedText({
  text,
  id,
  className,
  source,
  mentions,
}: {
  text: string;
  id: string;
  className: string;
  source: TextSource;
  mentions: Record<string, ShownMention>;
}) {
  const t = useTranslations('requests.codeNote');
  const locale = useLocale();
  const named = nameStoredMentions(text, (mention) =>
    Object.hasOwn(mentions, mention) ? (mentions[mention]?.name ?? null) : null,
  );
  return (
    <MarkdownText
      text={text}
      id={id}
      className={className}
      codeNote={[
        t('source', { url: source.url }),
        t('writtenBy', { name: source.writer, date: formatDate(source.at, locale) }),
      ]}
      mentions={mentions}
      fallback={<PlainText text={named} className={className} />}
    />
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
 * @param props.source - Where the text is from, for the note above code copied from it.
 * @param props.names - The names of the two sides, for the people the text mentions.
 * @returns The text.
 */
export default function RequestText({
  text,
  id,
  className = '',
  source,
  names,
}: {
  text: RequestTextValue;
  id: string;
  className?: string;
  source: TextSource;
  names: SideNames;
}) {
  if (text.format === 'markdown') {
    return (
      <FormattedText
        text={text.text}
        id={id}
        className={className}
        source={source}
        mentions={shownMentions(text.mentions, names)}
      />
    );
  }
  return <PlainText text={text.text} className={className} />;
}
