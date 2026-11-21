/**
 * @file The provider that gives client components their messages
 * (`useTranslations`). A client component of its own, because the error
 * handler can't be passed from the server. The root layout renders it with
 * the shared `common` messages, and `ClientMessages` with a page's own.
 */
'use client';

import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import type { Locale } from './locales';
import { onMessageError } from './message-errors';
import type { Messages } from './messages';

/** Props of {@link IntlClientProvider}. */
interface IntlClientProviderProps {
  /** The request's language. */
  locale: Locale;
  /** The namespaces the client components below use (`pickMessages`). */
  messages: Partial<Messages>;
  /** The request's time zone (`getTimeZone()`), for the times client components show. */
  timeZone: string;
  /** The components that translate. */
  children: ReactNode;
}

/**
 * Provides a language, its messages and the time zone to the client
 * components below. An
 * inner provider replaces the messages of an outer one, so each passes
 * `common` along with its own namespaces.
 *
 * @param props - The language, the messages and the children.
 * @param props.locale - The request's language.
 * @param props.messages - The namespaces the components below use.
 * @param props.timeZone - The request's time zone.
 * @param props.children - The components that translate.
 * @returns The provider.
 */
export default function IntlClientProvider({
  locale,
  messages,
  timeZone,
  children,
}: IntlClientProviderProps) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      onError={onMessageError}
    >
      {children}
    </NextIntlClientProvider>
  );
}
