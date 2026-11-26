/**
 * @file The brand an email is sent in (decision 0047): the colours a staff
 * Admin chose, worked out into the light palette. Every send loads it and
 * passes it as `EmailBaseProps.brand`. Imports no server-only code, so the
 * emails Better Auth sends can load it too.
 */
import { DEFAULT_EMAIL_COLOURS, emailColoursOf } from '@/components/email/theme';
import type { Database } from '@/db';
import type { EmailBrand } from '@/emails/base-props';
import { derivePalette } from '@/lib/branding';

import loadBrandColours from './colours';

/**
 * Loads the brand for an email. An email must go out even when the colours
 * can't be read, so a failure gives the theme's own (and is logged, without
 * any value). Takes the database, never a transaction: a failed read would
 * end the transaction it ran in, so emails are built once their change has
 * committed.
 *
 * @param db - Database client.
 * @returns The brand to pass to the email's template.
 */
export default async function loadEmailBrand(db: Database): Promise<EmailBrand> {
  try {
    return { colours: emailColoursOf(derivePalette(await loadBrandColours(db))) };
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the brand colours couldn't be read; nothing personal in it.
    console.warn('The brand colours could not be read; an email uses the theme’s colours.');
    return { colours: DEFAULT_EMAIL_COLOURS };
  }
}
