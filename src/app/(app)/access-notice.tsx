/**
 * @file Shows the note for `?notice=<code>` after users changed their own
 * access (see `access-notices.ts`), on the page they were sent to: the
 * dashboard or a company's page. Its text is in `common.accessNotice`, so
 * those pages needn't pass a namespace of their own for it.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import { useTransientState } from '@/components/ui/use-transient-state';

import { type AccessNoticeCode, getAccessNotice } from './access-notices';

/**
 * Words the note for a notice code.
 *
 * @param t - Translates the `common` namespace.
 * @param code - The notice.
 * @returns The note, e.g. "You left the company. …".
 */
function noteText(t: ReturnType<typeof useTranslations<'common'>>, code: AccessNoticeCode): string {
  switch (code) {
    case 'stepped-down':
      return t('accessNotice.steppedDown');
    case 'left-staff':
      return t('accessNotice.leftStaff');
    case 'left-company':
      return t('accessNotice.leftCompany');
    default:
      return t('accessNotice.companySteppedDown');
  }
}

/**
 * The note as an info `Alert` that takes focus (the action that sent the
 * user here had it) and can be dismissed. Dismissing is forgotten when the
 * user leaves the page, like every status message; the note itself only
 * comes with the address that carries it.
 *
 * @returns The note, or nothing.
 */
export default function AccessNotice() {
  const t = useTranslations('common');
  const notice = getAccessNotice(useSearchParams().get('notice'));
  const [dismissed, setDismissed] = useTransientState<string | null>(null);
  if (!notice || dismissed === notice) {
    return null;
  }

  return (
    <Alert
      tone="info"
      focusOnShow
      onDismiss={() => setDismissed(notice)}
      dismissLabel={t('accessNotice.dismiss')}
    >
      {noteText(t, notice)}
    </Alert>
  );
}
