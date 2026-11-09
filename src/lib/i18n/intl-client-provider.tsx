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
import { TIME_ZONE } from './time-zone';

/** Props of {@link IntlClientProvider}. */
interface IntlClientProviderProps {
  /** The request's language. */
  locale: Locale;
  /** The namespaces the client components below use (`pickMessages`). */
  messages: Partial<Messages>;
  /** The components that translate. */
  children: ReactNode;
}

/**
 * Provides a language and its messages to the client components below. An
 * inner provider replaces the messages of an outer one, so each passes
 * `common` along with its own namespaces.
 *
 * @param props - The language, the messages and the children.
 * @param props.locale - The request's language.
 * @param props.messages - The namespaces the components below use.
 * @param props.children - The components that translate.
 * @returns The provider.
 */
export default function IntlClientProvider({
  locale,
  messages,
  children,
}: IntlClientProviderProps) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={TIME_ZONE}
      onError={onMessageError}
    >
      {children}
    </NextIntlClientProvider>
  );
}
