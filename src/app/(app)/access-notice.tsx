/**
 * @file Shows the note for `?notice=<code>` after users changed their own
 * access (see `access-notices.ts`), on the page they were sent to: the
 * dashboard or a company's page.
 */
'use client';

import { useSearchParams } from 'next/navigation';

import Alert from '@/components/ui/alert';
import { useTransientState } from '@/components/ui/use-transient-state';

import { getAccessNotice } from './access-notices';

/**
 * The note as an info `Alert` that takes focus (the action that sent the
 * user here had it) and can be dismissed. Dismissing is forgotten when the
 * user leaves the page, like every status message; the note itself only
 * comes with the address that carries it.
 *
 * @returns The note, or nothing.
 */
export default function AccessNotice() {
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
      dismissLabel="Dismiss this note"
    >
      {notice}
    </Alert>
  );
}
