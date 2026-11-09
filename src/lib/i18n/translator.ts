/**
 * @file Translations for a given language outside React and outside a
 * Next.js request: emails, services, the sign-in guards, the hourly job and
 * scripts. Pages, components and server actions use next-intl's
 * `useTranslations` and `getTranslations` instead.
 * @see https://next-intl.dev/docs/environments/core-library
 */
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'use-intl/core';

import type { Locale } from './locales';
import { onMessageError } from './message-errors';
import { type Messages, messagesFor } from './messages';
import { TIME_ZONE } from './time-zone';

/** A namespace of the catalogues, e.g. `common` or `emails.invitation`. */
export type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

/**
 * Creates a translator for one namespace in one language.
 *
 * @param locale - The language.
 * @param namespace - The namespace whose keys `t` takes, e.g. `emails.invitation`.
 * @returns `t`, as from `useTranslations(namespace)`.
 */
export default function translator<const N extends Namespace>(locale: Locale, namespace: N) {
  return createTranslator<Messages, N>({
    locale,
    messages: messagesFor(locale),
    namespace,
    timeZone: TIME_ZONE,
    onError: onMessageError,
  });
}
