/**
 * @file Names the staff, sets Adiutor's default language and creates its
 * first Admin from the command line, for scripted deployments. The same can
 * be done in the browser at `/setup`.
 *
 * Usage: `pnpm setup:platform --staff-name "Adiutor" --email you@adiutor.dev --name "Your Name"
 * [--default-language nl-NL]` (the default language is English (US) unless given).
 *
 * Works only once: if the staff already exists, it refuses. Unlike the web
 * form, it may make an existing account the Admin (to recover an
 * installation whose settings were lost). A new account has no password;
 * sign in with an email link, or set a password with "Forgot password?" on
 * the sign-in page.
 */
import { parseArgs } from 'node:util';

import { ZodError } from 'zod';

import { db } from '../src/db';
import { DEFAULT_LOCALE, isLocale, LOCALES } from '../src/lib/i18n/locales';
import { installLogRedaction } from '../src/lib/log-redaction';
import { ServiceError, serviceErrorMessage, validationErrorMessage } from '../src/server/errors';
import { setUpPlatform } from '../src/server/setup';

/** How to call the script. */
const USAGE =
  'Usage: pnpm setup:platform --staff-name <name> --email <email> --name <your name> [--default-language <language>]';

/**
 * Reads the options, runs setup and reports the result.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'staff-name': { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      'default-language': { type: 'string' },
    },
  });
  if (!values['staff-name'] || !values.email || !values.name) {
    console.error(USAGE);
    return 1;
  }
  const defaultLocale = values['default-language'];
  if (defaultLocale !== undefined && !isLocale(defaultLocale)) {
    console.error(`--default-language must be one of: ${LOCALES.join(', ')}.`);
    return 1;
  }

  try {
    const result = await setUpPlatform(
      { db },
      { staffName: values['staff-name'], email: values.email, name: values.name, defaultLocale },
      // Unlike the web form, may make an existing account the Admin (to recover).
      { allowExistingAccount: true },
    );
    console.info(
      `Set up ${values['staff-name']}. ${result.email} is its Admin${result.createdUser ? ' (new account)' : ''}.`,
    );
    console.info('Sign in at /auth with an email link, or set a password with "Forgot password?".');
    return 0;
  } catch (error) {
    // Said in English (US), like the rest of the script's output.
    if (error instanceof ServiceError) {
      console.error(serviceErrorMessage(error, DEFAULT_LOCALE));
      return 1;
    }
    if (error instanceof ZodError) {
      console.error(validationErrorMessage(error, DEFAULT_LOCALE));
      return 1;
    }
    throw error;
  }
}

// Database errors are logged without the values they were sent.
installLogRedaction();

main()
  .then(async (code) => {
    await db.$client.end();
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
