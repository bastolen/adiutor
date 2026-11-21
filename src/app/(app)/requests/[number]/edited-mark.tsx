/**
 * @file The "Edited" mark after the time of an edited description or reply:
 * for the staff a button that opens its earlier versions, for everyone else
 * a word with the edit's time on hover. Its text comes from `requests.edit`,
 * which the page passes through `ClientMessages`.
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import Modal from '@/components/ui/modal';
import { focusRing } from '@/components/ui/styles';
import { useTransientState } from '@/components/ui/use-transient-state';
import cn from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';

/**
 * "Edited", with when on hover. With `versions` (the staff's), it's a button
 * that opens a dialog with the text's earlier versions, rendered on the
 * server; Escape and the close button return focus to it.
 *
 * @param props - Component props.
 * @param props.editedAt - When the text was last edited.
 * @param props.versions - The earlier versions, rendered, for the staff only.
 * @returns The mark.
 */
export default function EditedMark({
  editedAt,
  versions = null,
}: {
  editedAt: Date;
  versions?: ReactNode;
}) {
  const t = useTranslations('requests.edit');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  const [open, setOpen] = useTransientState(false);
  const when = t('editedAt', { time: formatDateTime(editedAt, locale, timeZone) });

  if (!versions) {
    return <span title={when}>{t('edited')}</span>;
  }
  return (
    <>
      <button
        type="button"
        title={when}
        onClick={() => setOpen(true)}
        className={cn(
          '-my-0.5 cursor-pointer rounded-sm py-0.5 underline decoration-dotted underline-offset-4 hover:text-foreground',
          focusRing,
        )}
      >
        {t('edited')}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('versionsTitle')}
        description={t('versionsDescription')}
      >
        {versions}
      </Modal>
    </>
  );
}
