/**
 * @file Passes a page's own namespaces to its client components, so the
 * browser gets only the text the page needs (CLAUDE.md, "Ship only the code
 * a page needs"). Server only: it reads the request's messages.
 */
import { getLocale, getMessages, getTimeZone } from 'next-intl/server';
import type { ReactNode } from 'react';

import IntlClientProvider from './intl-client-provider';
import { type MessagesGroup, pickMessages } from './messages';

/** Props of {@link ClientMessages}. */
interface ClientMessagesProps {
  /**
   * The namespaces the client components below use, or just the groups
   * inside them they use (`admin.settings.general.name`); `common` always comes along.
   */
  namespaces: readonly MessagesGroup[];
  /** The part of the page with those client components. */
  children: ReactNode;
}

/**
 * Wraps client components that translate with their namespaces. Use it
 * inside the page's `<Suspense>` (it reads the request's language), around
 * the smallest part that needs it.
 */
export default async function ClientMessages({ namespaces, children }: ClientMessagesProps) {
  const [locale, messages, timeZone] = await Promise.all([
    getLocale(),
    getMessages(),
    getTimeZone(),
  ]);
  return (
    <IntlClientProvider
      locale={locale}
      messages={pickMessages(messages, ['common', ...namespaces])}
      timeZone={timeZone}
    >
      {children}
    </IntlClientProvider>
  );
}
