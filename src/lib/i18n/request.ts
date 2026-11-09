/**
 * @file next-intl's configuration for each request (loaded through the
 * plugin in `next.config.ts`): the request's language, its messages and
 * the time zone dates are shown in.
 *
 * Reading the language reads the request's cookies. That costs nothing
 * extra: every page already renders per request for the Content Security
 * Policy's nonce (docs/decisions/0006). Text in a route's static shell
 * (outside its `<Suspense>`) still comes from client components that read
 * the root provider, so Partial Prefetching can prefetch the shell
 * (docs/i18n.md, "Server and client components").
 * @see https://next-intl.dev/docs/usage/configuration
 */
import { getRequestConfig } from 'next-intl/server';

import { isLocale } from './locales';
import { onMessageError } from './message-errors';
import { messagesFor } from './messages';
import requestLocale from './request-locale';
import { TIME_ZONE } from './time-zone';

export default getRequestConfig(async ({ locale: asked }) => {
  // `getTranslations({ locale })` asks for a language explicitly; otherwise the request's.
  const locale = isLocale(asked) ? asked : await requestLocale();
  return {
    locale,
    messages: messagesFor(locale),
    timeZone: TIME_ZONE,
    onError: onMessageError,
  };
});
