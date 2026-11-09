/**
 * @file "Go back" button that returns to the previous page in this tab, shown
 * only when there is one.
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import Button, { type ButtonProps } from './button';

/**
 * The tab's history never changes while this page is shown, so there's
 * nothing to subscribe to.
 *
 * @returns A function that unsubscribes (does nothing).
 */
const subscribe = () => () => {};

/**
 * Whether this tab has a previous page to go back to. Uses the Navigation
 * API where the browser has it (it knows the current position in the
 * history), otherwise any earlier entry counts.
 *
 * @returns Whether going back is possible.
 */
function canGoBack(): boolean {
  const { navigation } = window as { navigation?: { canGoBack?: boolean } };
  return navigation?.canGoBack ?? window.history.length > 1;
}

/**
 * The value while rendering on the server, where there's no history: the
 * button stays hidden until the browser can tell.
 *
 * @returns `false`.
 */
const canGoBackOnServer = () => false;

/**
 * A secondary button with an arrow that goes back one page. It renders
 * nothing when the tab has no previous page (e.g. a link opened in a new
 * tab), so it never leads nowhere.
 *
 * @param props - Button props, except `onClick` and `children`.
 * @returns The button, or nothing.
 */
export default function BackButton(props: Omit<ButtonProps, 'onClick' | 'children' | 'asChild'>) {
  const t = useTranslations('common.actions');
  const router = useRouter();
  const visible = useSyncExternalStore(subscribe, canGoBack, canGoBackOnServer);

  if (!visible) {
    return null;
  }
  return (
    <Button variant="secondary" {...props} onClick={() => router.back()}>
      <ArrowLeft aria-hidden="true" />
      {t('goBack')}
    </Button>
  );
}
