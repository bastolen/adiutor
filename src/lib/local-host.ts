/**
 * @file Whether a host name is this computer, for the settings that are only
 * allowed for local development: plain `http://` and unencrypted SMTP in
 * production (`env-schema.ts`, which the end-to-end tests rely on, and a
 * webhook's address, `src/lib/webhooks.ts`), and the development seed
 * (`src/lib/dev-seed-guard.ts`). Pure.
 */

/** The loopback names and addresses, as `URL.hostname` gives them (IPv6 in brackets). */
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** The special-use domain whose names all point to this computer (RFC 6761), e.g. `app.localhost`. */
const LOCALHOST_DOMAIN = '.localhost';

/**
 * Whether a host name is this computer: `localhost`, `127.0.0.1`, `::1` (or
 * `[::1]`, as `URL.hostname` writes it) or a name ending in `.localhost`.
 * Case doesn't matter (`URL` keeps the case of hosts in `smtp://` and
 * `postgresql://` URLs). Anything else counts as another computer, including
 * other loopback addresses such as `127.0.0.2` and names with a trailing dot,
 * so the checks that use it refuse when in doubt.
 *
 * @param hostname - The host name, e.g. `new URL(url).hostname`.
 * @returns Whether it's this computer.
 */
export default function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    LOCAL_HOSTNAMES.has(host) ||
    (host.endsWith(LOCALHOST_DOMAIN) && host.length > LOCALHOST_DOMAIN.length)
  );
}

/**
 * Whether a web address is fit for production: `https://`, or `http://` on
 * this computer ({@link isLocalHostname}), as the end-to-end tests run a
 * production build on `http://localhost`. Anything else (`ftp://`, plain
 * `http://` to another computer) isn't.
 *
 * @param url - The address, parsed.
 * @returns Whether it may be used in production.
 */
export function isSecureOrLocalUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHostname(url.hostname));
}
