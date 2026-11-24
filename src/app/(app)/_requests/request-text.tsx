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
import { appUrl as ownAddress } from '@/lib/env';
import formatDate from '@/lib/format';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';
import {
  nameStoredMentions,
  splitLinks,
  staffLinksAsLabels,
  type TextPart,
  textLinkTarget,
} from '@/lib/requests';
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
 * A stored text as it's shown as it was written: in a text the company
 * reads, a link written in Markdown to one of the staff's pages keeps only
 * its label (`staffLinksAsLabels`), so its address never shows. Done to the
 * text as it's stored, before the people it mentions are named, so no name
 * can change how its links read.
 *
 * @param text - The text as it's stored.
 * @param appUrl - Adiutor's own address, for a text the company reads; `null` otherwise.
 */
function asWritten(text: string, appUrl: string | null): string {
  return appUrl === null ? text : staffLinksAsLabels(text, appUrl);
}

/**
 * A text as it was written ({@link asWritten}): plain text with its line
 * breaks, in its own writing direction (`dir="auto"`, so a text in a
 * right-to-left script can't reorder the page around it). Web addresses
 * written with `http://` or `https://` are links ({@link ExternalLink}), but
 * not one of the staff's pages in a text the company reads (`textLinkTarget`),
 * nor one too long to be real (`splitLinks`).
 *
 * @param props - Component props.
 * @param props.text - The text, as {@link asWritten} gives it.
 * @param props.className - Extra classes for the paragraph.
 * @param props.appUrl - Adiutor's own address, for a text the company reads; `null` otherwise.
 */
function PlainText({
  text,
  className,
  appUrl,
}: {
  text: string;
  className: string;
  appUrl: string | null;
}) {
  return (
    <p dir="auto" className={cn('wrap-anywhere whitespace-pre-wrap', className)}>
      {placed(splitLinks(text)).map((part) => {
        const href = part.href === null ? null : textLinkTarget(part.href, appUrl);
        return href === null ? (
          part.text
        ) : (
          <ExternalLink key={part.offset} href={href}>
            {part.text}
          </ExternalLink>
        );
      })}
    </p>
  );
}

/**
 * The people a text mentions, as the text shows them: by the name the page
 * gives them (their own, or their side's), set apart when it's the reader,
 * and linked to the user's page for a reader who got their ID (the staff).
 * Someone shown by their side's name is never a link, as elsewhere. A reader
 * who may write in the request got each person's key, which the mention
 * carries for the editor.
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
        key: person.key,
      },
    ]),
  );
}

/**
 * A Markdown text shown as it was written, because formatting it would cost
 * too much ({@link asWritten}), with the people it mentions named as the
 * page names them. Only worked out when it's shown.
 *
 * @param props - Component props.
 * @param props.text - The text as it's stored.
 * @param props.className - Extra classes for the paragraph.
 * @param props.mentions - The people the text mentions.
 * @param props.appUrl - Adiutor's own address, for a text the company reads; `null` otherwise.
 */
function UnformattedText({
  text,
  className,
  mentions,
  appUrl,
}: {
  text: string;
  className: string;
  mentions: Record<string, ShownMention>;
  appUrl: string | null;
}) {
  const named = nameStoredMentions(asWritten(text, appUrl), (mention) =>
    Object.hasOwn(mentions, mention) ? (mentions[mention]?.name ?? null) : null,
  );
  return <PlainText text={named} className={className} appUrl={appUrl} />;
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
 * @param props.staffOnly - Whether only the staff read the text, which then links to their pages.
 */
function FormattedText({
  text,
  id,
  className,
  source,
  mentions,
  staffOnly,
}: {
  text: string;
  id: string;
  className: string;
  source: TextSource;
  mentions: Record<string, ShownMention>;
  staffOnly: boolean;
}) {
  const t = useTranslations('requests.codeNote');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  return (
    <MarkdownText
      text={text}
      id={id}
      className={className}
      codeNote={[
        t('source', { url: source.url }),
        t('writtenBy', { name: source.writer, date: formatDate(source.at, locale, timeZone) }),
      ]}
      mentions={mentions}
      staffOnly={staffOnly}
      fallback={
        <UnformattedText
          text={text}
          className={className}
          mentions={mentions}
          appUrl={staffOnly ? null : ownAddress}
        />
      }
    />
  );
}

/**
 * A request's text, in the format it was stored with. A plain text is shown
 * as it was written. A Markdown text is shown formatted ({@link MarkdownText}),
 * unless formatting it would cost too much (a text nested hundreds of levels
 * deep): then it's shown as it was written, too. Either way a link to one of
 * the staff's pages shows as its text, without its address, unless only the
 * staff read the text (an internal note, `staffOnly`).
 *
 * @param props - Component props.
 * @param props.text - The text and its format.
 * @param props.id - A name no other text on the page has, for the IDs inside a formatted text.
 * @param props.className - Extra classes for the element around the text.
 * @param props.source - Where the text is from, for the note above code copied from it.
 * @param props.names - The names of the two sides, for the people the text mentions.
 * @param props.staffOnly - Whether only the staff read the text (an internal note).
 */
export default function RequestText({
  text,
  id,
  className = '',
  source,
  names,
  staffOnly = false,
}: {
  text: RequestTextValue;
  id: string;
  className?: string;
  source: TextSource;
  names: SideNames;
  staffOnly?: boolean;
}) {
  if (text.format === 'markdown') {
    return (
      <FormattedText
        text={text.text}
        id={id}
        className={className}
        source={source}
        mentions={shownMentions(text.mentions, names)}
        staffOnly={staffOnly}
      />
    );
  }
  const appUrl = staffOnly ? null : ownAddress;
  return <PlainText text={asWritten(text.text, appUrl)} className={className} appUrl={appUrl} />;
}
