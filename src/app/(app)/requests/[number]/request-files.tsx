/**
 * @file The Files card of a request's page, under its details: every file on
 * the request the reader may open, wherever its text is, so they're easy to
 * find (`getRequest`'s `files`). Each row has the file's preview or icon, its
 * name, its size and where it was sent (the description, a reply or an
 * internal note, by its author and date), which links to that text; the row
 * opens the file in the page's viewer, and has a Download button of its own.
 * The first few show, then "Show all". Its text comes from
 * `requests.attachments`.
 */
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server';
import { createElement } from 'react';

import Card from '@/components/ui/card';
import ShowMoreList from '@/components/ui/show-more-list';
import formatDate, { formatFileSize } from '@/lib/format';
import { DESCRIPTION_ANCHOR, entryAnchor, requestPathAt } from '@/lib/requests';
import type { RequestDetail, RequestFileView } from '@/server/requests';

import attachmentIcon, { previewLook } from '../../_requests/attachment-icon';
import { personName, requestSideNames } from '../../_requests/request-person';
import ViewableAttachmentRow from '../../_requests/viewable-attachment-row';
import TextSourceLink from './text-source-link';

/** How many files the card shows until "Show all" is pressed. */
export const FILES_SHOWN = 5;

/**
 * The Files card, or nothing for a request without files the reader may
 * open. Removed files aren't listed: their place in their text says who
 * removed them.
 *
 * @param props - Component props.
 * @param props.detail - The request, as its reader gets it.
 */
export default async function RequestFiles({ detail }: { detail: RequestDetail }) {
  if (detail.files.length === 0) {
    return null;
  }
  const [t, locale, timeZone] = await Promise.all([
    getTranslations('requests.attachments'),
    getLocale(),
    getTimeZone(),
  ]);
  const names = requestSideNames(detail);

  /**
   * Where a file was sent, as the link to that text says it.
   *
   * @param entry - The reply or note it was sent with; `null` for the description.
   * @returns The link's text.
   */
  const sentWith = (entry: RequestFileView['entry']): string => {
    if (entry === null) {
      return t('overview.fromDescription');
    }
    const values = {
      own: entry.author.isViewer ? 'yes' : 'no',
      name: personName(entry.author, names),
      date: formatDate(entry.at, locale, timeZone),
    };
    return entry.kind === 'note' ? t('overview.fromNote', values) : t('overview.fromReply', values);
  };

  const count = detail.files.length;
  return (
    <Card title={t('overview.title', { count })}>
      <ShowMoreList
        label={t('overview.listLabel')}
        shown={FILES_SHOWN}
        moreLabel={t('overview.showAll', { count })}
        items={detail.files.map((file) => {
          const size = formatFileSize(file.size, locale);
          const anchor = file.entry === null ? DESCRIPTION_ANCHOR : entryAnchor(file.entry.id);
          return {
            key: file.id,
            content: (
              <ViewableAttachmentRow
                id={file.id}
                name={file.name}
                // Its size, then where it was sent on a line of its own: a long name wraps without a separator left over.
                detail={
                  <span className="flex flex-col items-start">
                    <span>{size}</span>
                    <TextSourceLink href={requestPathAt(detail.number, anchor)} anchor={anchor}>
                      {sentWith(file.entry)}
                    </TextSourceLink>
                  </span>
                }
                icon={createElement(attachmentIcon(file.name), { 'aria-hidden': true })}
                thumbnail={file.preview ? `/attachments/${file.id}/preview` : undefined}
                {...previewLook(file.name)}
                openLabel={t('open', { name: file.name, size })}
                downloadLabel={t('download', { name: file.name, size })}
              />
            ),
          };
        })}
      />
    </Card>
  );
}
