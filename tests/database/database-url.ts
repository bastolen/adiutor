/**
 * @file Works out which database the tests use. Shared by the integration
 * tests (Vitest), the end-to-end tests (Playwright) and its configuration.
 * The tests empty that database, so it must be a test database: one whose
 * name ends in `_test` that isn't the development database.
 */

/** Database name used for tests when no URL is configured. */
const TEST_DATABASE = 'adiutor_test';

/** The variables the test database URL comes from. */
interface TestDatabaseSettings {
  /** `DATABASE_URL_TEST`, if set. */
  explicit: string | undefined;
  /** `DATABASE_URL` (the development database), if set. */
  base: string | undefined;
}

/**
 * Identifies a database by server and name: host, port (PostgreSQL's 5432
 * when left out) and database name.
 *
 * @param url - A connection URL.
 * @returns The identity, comparable as a string.
 */
function databaseIdentity(url: URL): string {
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

/**
 * Returns the test database URL: `explicit` if set, otherwise `base` with the
 * database name replaced by `adiutor_test`. Refuses anything that may not be
 * a test database, because the tests empty it: a name that doesn't end in
 * `_test` (a pasted development, staging or production URL), or the same
 * database as `base` (same host, port and name). Errors name the database,
 * never the URL, which holds the password.
 *
 * @param settings - The variables.
 * @param settings.explicit - `DATABASE_URL_TEST`, if set.
 * @param settings.base - `DATABASE_URL`, if set.
 * @returns The PostgreSQL connection string for tests.
 * @throws {Error} If neither is set, or the result may not be a test database.
 */
export function resolveTestDatabaseUrl({ explicit, base }: TestDatabaseSettings): string {
  const connection = explicit || base;
  if (!connection) {
    throw new Error('Set DATABASE_URL_TEST (or DATABASE_URL) to run database tests.');
  }

  const url = new URL(connection);
  if (!explicit) {
    url.pathname = `/${TEST_DATABASE}`;
  }
  const name = url.pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(
      `The test database's name must end in _test, so the tests never empty another database (got "${name}").`,
    );
  }
  if (base && databaseIdentity(new URL(base)) === databaseIdentity(url)) {
    throw new Error(
      `The test database must not be the development database (DATABASE_URL, "${name}").`,
    );
  }
  return url.toString();
}

/**
 * Returns the test database URL from `.env` and the environment (see
 * {@link resolveTestDatabaseUrl}).
 *
 * @returns The PostgreSQL connection string for tests.
 * @throws {Error} If neither variable is set, or the result may not be a test database.
 */
export default function getTestDatabaseUrl(): string {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file (e.g. in CI); the variables come from the environment.
  }
  return resolveTestDatabaseUrl({
    explicit: process.env.DATABASE_URL_TEST,
    base: process.env.DATABASE_URL,
  });
}
