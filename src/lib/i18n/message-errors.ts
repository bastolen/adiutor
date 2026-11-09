/**
 * @file What happens when a message can't be shown, shared by the server
 * config, the translator for emails and the client providers.
 *
 * TypeScript and `pnpm lint:messages` keep the catalogues complete, so a
 * missing message is a bug: outside production it throws, so tests fail on
 * it; in production it's logged with {@link MESSAGE_ERROR_PREFIX} (the
 * end-to-end tests fail on that console line too) and the key shows instead.
 */
import type { IntlError } from 'use-intl/core';

/** Starts every logged message error, so tests can recognise one. */
export const MESSAGE_ERROR_PREFIX = '[i18n]';

/**
 * Reports a message that couldn't be shown: throws outside production, logs
 * in production.
 *
 * @param error - next-intl's error, e.g. a missing message.
 * @throws {IntlError} Outside production.
 */
export function onMessageError(error: IntlError): void {
  // eslint-disable-next-line no-restricted-properties -- Shared with the browser, where `env` isn't available; Next.js inlines NODE_ENV.
  if (process.env.NODE_ENV !== 'production') {
    throw error;
  }
  // eslint-disable-next-line no-console -- A missing message is a bug to fix; the line holds only the key.
  console.error(`${MESSAGE_ERROR_PREFIX} ${error.code}: ${error.originalMessage ?? error.message}`);
}
