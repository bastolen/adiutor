/**
 * @file The brand an email is sent in (decisions 0049, 0050 and 0052): the
 * colours a staff Admin chose, worked out into the light palette, the
 * staff's name, which its text shows instead of "Adiutor", and the logo a
 * staff Admin uploaded. Every send loads
 * it and passes it as `EmailBaseProps.brand`. Imports no server-only code, so the
 * emails Better Auth sends can load it too.
 */
import { DEFAULT_EMAIL_COLOURS, emailColoursOf } from '@/components/email/theme';
import type { Database } from '@/db';
import type { EmailBrand } from '@/emails/base-props';
import { ADIUTOR_NAME, brandLogoPath, derivePalette } from '@/lib/branding';

import getStaffName from '../people/staff-name';
import { loadBrandImages } from './brand-images';
import loadBrandColours from './colours';

/**
 * Loads the brand for an email. An email must go out even when the brand
 * can't be read, so a failure gives Adiutor's own colours, name and logo (and is
 * logged, without any value). Takes the database, never a transaction: a failed read would
 * end the transaction it ran in, so emails are built once their change has
 * committed.
 *
 * @param db - Database client.
 * @returns The brand to pass to the email's template.
 */
export default async function loadEmailBrand(db: Database): Promise<EmailBrand> {
  try {
    const [colours, name, { logo }] = await Promise.all([
      loadBrandColours(db),
      getStaffName(db),
      loadBrandImages(db),
    ]);
    return {
      colours: emailColoursOf(derivePalette(colours)),
      name,
      ...(logo && {
        logo: { src: brandLogoPath(logo.id), width: logo.width, height: logo.height },
      }),
    };
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the brand couldn't be read; nothing personal in it.
    console.warn('The brand could not be read; an email uses Adiutor’s colours, name and logo.');
    return { colours: DEFAULT_EMAIL_COLOURS, name: ADIUTOR_NAME };
  }
}
