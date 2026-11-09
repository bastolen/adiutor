/**
 * @file Passes a page's own namespaces to its client components, so the
 * browser gets only the text the page needs (CLAUDE.md, "Ship only the code
 * a page needs"). Server only: it reads the request's messages.
 */
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

import IntlClientProvider from './intl-client-provider';
import { type MessagesGroup, pickMessages } from './messages';

/** Props of {@link ClientMessages}. */
interface ClientMessagesProps {
  /**
   * The namespaces the client components below use, or just the groups
   * inside them they use (`admin.staff.name`); `common` always comes along.
   */
  namespaces: readonly MessagesGroup[];
  /** The part of the page with those client components. */
  children: ReactNode;
}

/**
 * Wraps client components that translate with their namespaces. Use it
 * inside the page's `<Suspense>` (it reads the request's language), around
 * the smallest part that needs it.
 *
 * @param props - The namespaces and the children.
 * @param props.namespaces - The namespaces (or groups) to pass, besides `common`.
 * @param props.children - The part of the page that uses them.
 * @returns The provider around the children.
 */
export default async function ClientMessages({ namespaces, children }: ClientMessagesProps) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <IntlClientProvider
      locale={locale}
      messages={pickMessages(messages, ['common', ...namespaces])}
    >
      {children}
    </IntlClientProvider>
  );
}
