/**
 * @file The files attached to a request's text (its description, a reply or
 * an internal note), under the text: a tile each, which downloads the file
 * from `/attachments/<id>`, with a thumbnail for an image. The service gives
 * only the files the reader may see (a note's only to the staff). Its text
 * comes from `requests.attachments`.
 */
import { useLocale, useTranslations } from 'next-intl';

import FileTile from '@/components/ui/file-tile';
import { formatFileSize } from '@/lib/format';
import type { RequestAttachmentView } from '@/server/requests';

import attachmentIcon from './attachment-icon';

/**
 * How many files a text has that aren't removed: what counts towards the
 * most it may have.
 *
 * @param attachments - The text's files, as the service gave them.
 * @returns How many.
 */
export function attachedCount(attachments: readonly RequestAttachmentView[] | undefined): number {
  return attachments?.filter((attachment) => attachment.removed === null).length ?? 0;
}

/**
 * A text's files as a list of tiles, or nothing without any.
 *
 * @param props - List props.
 * @param props.attachments - The text's files, oldest first, as the service gave them.
 */
export default function AttachmentList({
  attachments,
}: {
  attachments: readonly RequestAttachmentView[] | undefined;
}) {
  const t = useTranslations('requests.attachments');
  const locale = useLocale();
  const shown = attachments?.filter((attachment) => attachment.removed === null) ?? [];
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label={t('label', { count: shown.length })}
      className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
    >
      {shown.map((attachment) => {
        const href = `/attachments/${attachment.id}`;
        const size = formatFileSize(attachment.size, locale);
        const Icon = attachmentIcon(attachment.name);
        return (
          <li key={attachment.id}>
            <FileTile
              name={attachment.name}
              detail={size}
              icon={<Icon aria-hidden="true" />}
              thumbnail={attachment.thumbnail ? href : undefined}
              href={href}
              linkLabel={t('download', { name: attachment.name, size })}
            />
          </li>
        );
      })}
    </ul>
  );
}
