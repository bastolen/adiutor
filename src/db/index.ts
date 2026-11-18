/**
 * @file Database client: Drizzle ORM on a PostgreSQL connection pool. The
 * app's own client gives up connecting after a few seconds and notices a
 * database host that stopped answering, so a request (or the health check)
 * fails instead of waiting without end.
 *
 * Imported by `src/lib/auth.ts`, so it uses relative imports and no
 * `server-only` (the Better Auth CLI must be able to load it).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import { env } from '../lib/env';
import * as schema from './schema';

/** The settings of a connection pool, apart from which database it connects to. */
export type PoolOptions = Omit<PoolConfig, 'connectionString'>;

/**
 * How long the app waits for a database connection, in milliseconds: for a
 * new one to open, and for a free one when all of the pool's are in use.
 * `pg` waits without end by default, so a database host that drops packets
 * would hold every request, and `/api/health`, until the platform stops it.
 */
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * How long a connection may be silent before the operating system starts
 * asking the database's host whether it's still there (TCP keep-alive), in
 * milliseconds. A query that's waiting for its answer on a connection whose
 * host has gone (a half-open socket) then fails, about 20 seconds after the
 * silence began with the probes Node sends today, instead of waiting without
 * end. Without the delay the operating system's own applies, which is 2
 * hours on Linux. It can't help a query the host never received: the
 * operating system keeps resending that one for minutes. Few connections are
 * in that state, since the pool closes one that sat idle for 10 seconds.
 */
const KEEP_ALIVE_AFTER_MS = 10_000;

/**
 * The settings of the app's own pool.
 *
 * Time limits on statements (`statement_timeout`,
 * `idle_in_transaction_session_timeout`) are left out on purpose: `pg` sends
 * them as start-up parameters, which a pooled connection refuses (PgBouncer
 * only takes the ones it can keep track of, and so does Neon's pooler, which
 * `DATABASE_URL` points at on Vercel), so every connection would fail. Where
 * they're wanted, set them on the database role (see "Before sharing the
 * address" in `docs/deploying.md`).
 */
const APP_POOL_OPTIONS: PoolOptions = {
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: KEEP_ALIVE_AFTER_MS,
};

/**
 * Creates a Drizzle client for a database. Without `options` the pool has
 * `pg`'s defaults, which is what the tests use.
 *
 * @param connectionString - PostgreSQL connection string.
 * @param options - The pool's settings, apart from the connection string.
 * @returns The client, with its connection pool as `$client`.
 */
export function createDatabase(connectionString: string, options: PoolOptions = {}) {
  return drizzle(new Pool({ ...options, connectionString }), { schema });
}

/** A Drizzle client for this app's schema. */
export type Database = ReturnType<typeof createDatabase>;

/**
 * An open transaction, for work that must run inside one (e.g. taking a
 * transaction-scoped lock).
 */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A database client or an open transaction; services accept either. */
export type DatabaseOrTransaction = Database | DatabaseTransaction;

/**
 * The app's database client, also used by the scripts in `scripts/`, with
 * {@link APP_POOL_OPTIONS}.
 */
export const db = createDatabase(env.DATABASE_URL, APP_POOL_OPTIONS);

/**
 * Logs that a connection waiting in the pool failed (the database closed it,
 * or its host stopped answering). The pool has let it go already and opens a
 * new one when needed; without a listener, Node would treat the pool's
 * `error` event as an uncaught error and stop the server. Only the error's
 * code is logged: its message can hold connection details.
 */
db.$client.on('error', (error) => {
  const { code } = error as { code?: unknown };
  // eslint-disable-next-line no-console -- Nobody waits on an idle connection, so only the log can tell; the code only, never the message.
  console.error(
    `A database connection waiting in the pool failed${typeof code === 'string' ? ` (${code})` : ''}.`,
  );
});
