/**
 * @file Where to find the client's IP address, from `CLIENT_IP_HEADERS` and
 * `TRUSTED_PROXIES`. Shared by Better Auth (`src/lib/auth.ts`) and the app
 * (`src/lib/request/request-info.ts`), so both resolve the same address.
 */
import { env } from '../env';
import type { IpAddressOptions } from './request-info';

/** The configured IP headers and trusted proxies. */
const ipAddressOptions: IpAddressOptions = {
  ipAddressHeaders: env.CLIENT_IP_HEADERS,
  ...(env.TRUSTED_PROXIES.length > 0 && { trustedProxies: env.TRUSTED_PROXIES }),
};

export default ipAddressOptions;
