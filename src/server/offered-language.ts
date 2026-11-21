/**
 * @file The refusal of a language Adiutor doesn't offer, for the services
 * that take a chosen language (the account's own, an invitation's, a new
 * user's). Staff Admins turn languages on and off on the staff page; a
 * language that's off isn't offered anywhere (decision 0029).
 */
import type { DatabaseOrTransaction } from '@/db';
import { loadLanguageSettings } from '@/lib/i18n/default-locale';
import type { Locale } from '@/lib/i18n/locales';

import { ServiceError } from './errors';

/**
 * Refuses a chosen language that's turned off. No language (Default, or
 * none chosen) is always fine.
 *
 * @param db - Database client or transaction.
 * @param locale - The chosen language, if any.
 * @throws {ServiceError} `invalid` with `errors.language.notOffered`.
 */
export default async function assertLanguageOffered(
  db: DatabaseOrTransaction,
  locale: Locale | null | undefined,
): Promise<void> {
  if (!locale) {
    return;
  }
  const { offered } = await loadLanguageSettings(db);
  if (!offered.includes(locale)) {
    throw new ServiceError('invalid', 'errors.language.notOffered');
  }
}
