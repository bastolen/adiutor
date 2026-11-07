/**
 * @file The service context for the running app: the real database, real
 * email sending, the configured URL and the current request's origin.
 */
import 'server-only';
import { headers } from 'next/headers';

import { db } from '@/db';
import { sendEmail } from '@/lib/email';
import { appUrl } from '@/lib/env';
import ipAddressOptions from '@/lib/request/ip-address-options';
import { requestInfoFromHeaders } from '@/lib/request/request-info';

import type { ServiceContext } from './context';

/** Service context used by pages and server actions. */
const appContext: ServiceContext = {
  db,
  sendEmail,
  baseUrl: appUrl,
  /**
   * Reads the current request's IP and browser.
   *
   * @returns Where the request came from.
   */
  requestInfo: async () => requestInfoFromHeaders(await headers(), ipAddressOptions),
};

export default appContext;
