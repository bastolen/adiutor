/**
 * @file Names the staff and creates its first Admin from the command line,
 * for scripted deployments. The same can be done in the browser at `/setup`.
 *
 * Usage: `pnpm setup:platform --staff-name "Adiutor" --email you@adiutor.dev --name "Your Name"`
 *
 * Works only once: if the staff already exists, it refuses. Unlike the web
 * form, it may make an existing account the Admin (to recover an
 * installation whose settings were lost). A new account has no password;
 * sign in with an email link, or set a password with "Forgot password?" on
 * the sign-in page.
 */
import { parseArgs } from 'node:util';

import { db } from '../src/db';
import { installLogRedaction } from '../src/lib/log-redaction';
import { ServiceError } from '../src/server/errors';
import { setUpPlatform } from '../src/server/setup';

/** How to call the script. */
const USAGE = 'Usage: pnpm setup:platform --staff-name <name> --email <email> --name <your name>';

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
    },
  });
  if (!values['staff-name'] || !values.email || !values.name) {
    console.error(USAGE);
    return 1;
  }

  try {
    const result = await setUpPlatform(
      db,
      { staffName: values['staff-name'], email: values.email, name: values.name },
      // Unlike the web form, may make an existing account the Admin (to recover).
      { allowExistingAccount: true },
    );
    console.info(
      `Set up ${values['staff-name']}. ${result.email} is its Admin${result.createdUser ? ' (new account)' : ''}.`,
    );
    console.info('Sign in at /auth with an email link, or set a password with "Forgot password?".');
    return 0;
  } catch (error) {
    if (error instanceof ServiceError) {
      console.error(error.message);
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
