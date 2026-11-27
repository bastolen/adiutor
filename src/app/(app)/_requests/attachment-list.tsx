/**
 * @file The files attached to a request's text (its description, a reply or
 * an internal note), under the text: a tile each, which downloads the file
 * from `/attachments/<id>`, with its preview when it has one (from
 * `/attachments/<id>/preview`, decision 0057), and in a removed
 * file's place a tile that says who removed it. The service gives only the
 * files the reader may see (a note's only to the staff). Its text comes from
 * `requests.attachments`.
 */
import { useLocale, useTranslations } from 'next-intl';

import FileTile from '@/components/ui/file-tile';
import RowAction from '@/components/ui/row-action';
import type { ActionResult } from '@/lib/action-result';
import { formatFileSize } from '@/lib/format';
import type { RequestAttachmentView } from '@/server/requests';

import attachmentIcon from './attachment-icon';
import { personName, type SideNames } from './request-person';
import SignedInAsMark from './signed-in-as-mark';

/** What removing a file needs: the request, and the action that removes it. */
export interface AttachmentRemoval {
  /** The request's number. */
  request: number;
  /** The server action that removes a file (fields `request` and `attachment`). */
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}

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
 * A text's files as a list of tiles, or nothing without any. A removed
 * file's tile is dashed, without a link, and says who removed it (and the
 * staff member signed in as them, for the readers who are told). With
 * `removal` (the staff who work on requests, as the page's rules decide),
 * each file has a Remove button, which asks first; focus then goes to the
 * card's heading (`RowAction`).
 *
 * @param props - List props.
 * @param props.attachments - The text's files, oldest first, as the service gave them.
 * @param props.names - The names of the two sides, for who removed a file.
 * @param props.removal - What removing a file needs, for a reader who may.
 */
export default function AttachmentList({
  attachments,
  names,
  removal = null,
}: {
  attachments: readonly RequestAttachmentView[] | undefined;
  names: SideNames;
  removal?: AttachmentRemoval | null;
}) {
  const t = useTranslations('requests.attachments');
  const locale = useLocale();
  if (!attachments || attachments.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label={t('label', { count: attachments.length })}
      className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
    >
      {attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment.name);
        const icon = <Icon aria-hidden="true" />;
        if (attachment.removed) {
          const { by, signedInAs } = attachment.removed;
          return (
            <li key={attachment.id}>
              <FileTile
                name={attachment.name}
                detail={t('removedBy', { name: personName(by, names) })}
                icon={icon}
                gone
              >
                <span className="flex flex-wrap items-center gap-1 text-xs">
                  <SignedInAsMark mark={signedInAs} author={by} names={names} separated={false} />
                </span>
              </FileTile>
            </li>
          );
        }
        const href = `/attachments/${attachment.id}`;
        const size = formatFileSize(attachment.size, locale);
        return (
          <li key={attachment.id}>
            <FileTile
              name={attachment.name}
              detail={size}
              icon={icon}
              thumbnail={attachment.preview ? `${href}/preview` : undefined}
              href={href}
              linkLabel={t('download', { name: attachment.name, size })}
              actions={
                removal && (
                  <RowAction
                    action={removal.action}
                    fields={{ request: String(removal.request), attachment: attachment.id }}
                    label={t('removeShort')}
                    ariaLabel={t('remove', { name: attachment.name })}
                    variant="danger-subtle"
                    confirm={{
                      title: t('removeTitle', { name: attachment.name }),
                      description: t('removeDescription'),
                      confirmLabel: t('removeConfirm'),
                    }}
                    allowedWhileSignedInAs
                  />
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
