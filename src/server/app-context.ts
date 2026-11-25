/**
 * @file The service context for the running app: the real database, real
 * email sending, the configured URL, the file storage chosen now and the
 * current request's origin and language.
 */
import 'server-only';
import { headers } from 'next/headers';

import { db } from '@/db';
import { sendEmail } from '@/lib/email';
import { appUrl } from '@/lib/env';
import requestLocale from '@/lib/i18n/request-locale';
import ipAddressOptions from '@/lib/request/ip-address-options';
import { requestInfoFromHeaders } from '@/lib/request/request-info';

import type { ServiceContext } from './context';
import { activeStorage } from './storage';

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
  /**
   * Reads the current request's language (`requestLocale`).
   *
   * @returns The locale.
   */
  requestLocale,
  /**
   * The storage files go to now: the environment's, or Settings'.
   *
   * @returns The storage, or `null`.
   */
  storage: () => activeStorage(db),
};

export default appContext;
