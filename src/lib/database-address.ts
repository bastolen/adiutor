/**
 * @file Which database a PostgreSQL connection URL really names: the host,
 * port and database the driver (`pg`) connects to. A URL's own host isn't
 * always it: `pg` reads the URL with `pg-connection-string`, where a `host`
 * or `port` query parameter wins over the URL's, as in
 * `postgresql://user@localhost/db?host=/cloudsql/project:region:instance`.
 * The checks that must know where a database is (the development seed's
 * guard, the test database's) use this, so they never judge another address
 * than the one that's connected to. Pure, apart from what
 * `pg-connection-string` does itself: it reads the certificate files a URL
 * names (`sslcert`, `sslkey`, `sslrootcert`), as the driver would.
 */
import { parse } from 'pg-connection-string';

/** PostgreSQL's port, which the driver uses when a URL names none. */
const DEFAULT_PORT = '5432';

/** Where a connection URL points, as the driver reads it. */
export interface DatabaseAddress {
  /**
   * The host: a name or an address (IPv6 without brackets), a socket's
   * folder (starting with `/`), whatever a `host` parameter says (a list
   * with commas included), or empty when the URL names none.
   */
  host: string;
  /** The port, `5432` when the URL names none. */
  port: string;
  /** The database's name, or empty when the URL names none. */
  database: string;
}

/**
 * Reads a connection URL as the driver does.
 *
 * @param connectionUrl - The PostgreSQL connection URL.
 * @returns The host, port and database it connects to.
 * @throws {Error} When the driver couldn't read it either, e.g. a certificate
 *   file it names is missing; the error never holds the URL, which has the
 *   password.
 */
export default function databaseAddress(connectionUrl: string): DatabaseAddress {
  const { host, port, database } = parse(connectionUrl);
  return { host: host ?? '', port: port || DEFAULT_PORT, database: database ?? '' };
}
