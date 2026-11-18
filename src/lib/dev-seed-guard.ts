/**
 * @file The checks the development seed (`scripts/seed-dev.ts`, `pnpm db:seed`)
 * runs before it writes anything. The seed deletes all data and adds a staff
 * Admin whose password, authenticator secret and backup codes are in the
 * repository, so it must only ever run on a developer's own computer. Pure,
 * so the checks can be tested without running the script.
 */
import databaseAddress from './database-address';
import isLocalHostname from './local-host';

/** The settings the seed is about to run with. */
interface DevSeedSettings {
  /** `NODE_ENV`, if set. */
  nodeEnv: string | undefined;
  /** `DATABASE_URL`: the database the seed would empty. */
  databaseUrl: string;
  /** `BETTER_AUTH_URL`: where the app runs. */
  authUrl: string;
}

/**
 * Says why the development seed mustn't run with these settings, or nothing
 * when it may. It refuses:
 * - `NODE_ENV=production`;
 * - a `BETTER_AUTH_URL` whose host isn't this computer (`isLocalHostname`):
 *   a server's `.env` usually has no `NODE_ENV`, but its app address is
 *   public, so this catches a seed run on a server whose database happens to
 *   listen on `localhost`;
 * - a database on another computer, going by the host the driver connects
 *   to (`databaseAddress`), not the one the URL starts with: a `host`
 *   parameter wins, as in `…@localhost/adiutor?host=db.adiutor.dev`. A
 *   socket's folder (the usual way to write a Cloud SQL database, which is
 *   elsewhere) and a list of hosts count as another computer, and so does a
 *   URL without a host;
 * - the test database (`…_test`), which the tests manage themselves.
 *
 * @param settings - The settings.
 * @param settings.nodeEnv - `NODE_ENV`, if set.
 * @param settings.databaseUrl - `DATABASE_URL`.
 * @param settings.authUrl - `BETTER_AUTH_URL`.
 * @returns What to tell the operator, or `null` when the seed may run.
 * @throws {Error} When the driver couldn't read `DATABASE_URL` either (see
 *   `databaseAddress`); nothing is seeded then.
 */
export default function devSeedRefusal({
  nodeEnv,
  databaseUrl,
  authUrl,
}: DevSeedSettings): string | null {
  if (nodeEnv === 'production') {
    return 'Refusing to seed: NODE_ENV is production.';
  }
  if (!isLocalHostname(new URL(authUrl).hostname)) {
    return 'Refusing to seed: BETTER_AUTH_URL is not on this computer, so this looks like a server. The seed deletes all data and adds accounts whose passwords are public. To seed your local database, set BETTER_AUTH_URL to a local address such as http://localhost:3000.';
  }
  const { host, database } = databaseAddress(databaseUrl);
  // A folder or a list can end in a local name (`/run/db.localhost`, `db.adiutor.dev,localhost`).
  if (host.startsWith('/') || host.includes(',') || !isLocalHostname(host)) {
    return 'Refusing to seed a database on another computer: this deletes all its data.';
  }
  if (database.endsWith('_test')) {
    return 'Refusing to seed a test database; the tests manage it themselves.';
  }
  return null;
}
