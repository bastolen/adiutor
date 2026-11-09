/**
 * @file Signs everyone out, or one user, on every device, and forgets their
 * trusted devices: for after a suspected leak of the database, the auth
 * secret or a session (see "After a suspected leak" in `docs/deploying.md`).
 * Recorded in the audit log; one user is also emailed.
 *
 * Usage: `pnpm sessions:revoke-all --yes` (everyone) or
 * `pnpm sessions:revoke-all --user user@adiutor.dev` (one user).
 */
import { parseArgs } from 'node:util';

import { db } from '../src/db';
import { sendEmail } from '../src/lib/email';
import { appUrl } from '../src/lib/env';
import { DEFAULT_LOCALE } from '../src/lib/i18n/locales';
import { installLogRedaction } from '../src/lib/log-redaction';
import { revokeAllSessions } from '../src/server/auth/sessions';
import { ServiceError, serviceErrorMessage } from '../src/server/errors';

/** How to call the script. */
const USAGE =
  'Usage: pnpm sessions:revoke-all --yes (signs everyone out) or pnpm sessions:revoke-all --user <email>';

/**
 * Reads the options, ends the sessions and reports how many.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { user: { type: 'string' }, yes: { type: 'boolean' } },
  });
  // Signing everyone out must be asked for explicitly.
  if (!values.user && !values.yes) {
    console.error(USAGE);
    return 1;
  }

  try {
    const result = await revokeAllSessions(
      { db, sendEmail, baseUrl: appUrl },
      { email: values.user },
    );
    if (!result.email) {
      console.info(`Signed everyone out: ended ${result.count} sessions.`);
    } else {
      console.info(`Signed ${result.email} out: ended ${result.count} sessions.`);
      console.info(
        result.emailed
          ? 'They were emailed.'
          : 'Emailing them failed (see the error above); tell them yourself.',
      );
    }
    return 0;
  } catch (error) {
    // Said in English (US), like the rest of the script's output.
    if (error instanceof ServiceError) {
      console.error(serviceErrorMessage(error, DEFAULT_LOCALE));
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
