/**
 * @file Reads where a request came from (IP address and browser) from its
 * headers.
 *
 * The IP address is resolved exactly like Better Auth does for its rate
 * limits (`getIP` with the same `ipAddress` options, see
 * `src/lib/request/ip-address-options.ts`), so the audit log, security emails and the
 * app's own rate limits see the same address Better Auth does.
 */
import { getIP } from 'better-auth/api';

/** Where a request came from. */
export interface RequestInfo {
  /** The client's IP address, if known. */
  ip: string | null;
  /** The client's browser (user agent), if known. */
  userAgent: string | null;
}

/** How to find the client's IP address in the request headers. */
export interface IpAddressOptions {
  /** Headers to read, in order, e.g. `['x-forwarded-for']`. */
  ipAddressHeaders?: string[];
  /** Reverse proxies whose hops are skipped in a forwarded chain. */
  trustedProxies?: string[];
}

/**
 * Reads the client's IP and user agent. Without trusted proxies, only a
 * single-value IP header counts (a chain like `client, proxy` can be forged
 * from its left end); with them, the chain is read from the right, skipping
 * the proxies.
 *
 * @param headers - The request headers.
 * @param ipAddress - Which headers and proxies to trust.
 * @returns The IP address and user agent, each `null` when unknown.
 */
export function requestInfoFromHeaders(
  headers: Headers | null | undefined,
  ipAddress: IpAddressOptions = {},
): RequestInfo {
  if (!headers) {
    return { ip: null, userAgent: null };
  }
  return {
    ip: getIP(headers, { advanced: { ipAddress } }),
    userAgent: headers.get('user-agent') || null,
  };
}
