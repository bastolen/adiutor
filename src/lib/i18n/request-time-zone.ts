/**
 * @file The current request's time zone, for Server Components, server
 * actions and next-intl's request config (`next/headers`): the time zone
 * cookie, which mirrors the signed-in account's zone, else Adiutor's default
 * zone. Code outside a Next.js request (emails, jobs) takes the zone as an
 * argument instead (`recipientTimeZone`).
 */
import { cookies } from 'next/headers';
import { cache } from 'react';

import { db } from '@/db';

import loadDefaultTimeZone from './default-time-zone';
import { isTimeZone, TIME_ZONE_COOKIE } from './time-zones';

/** Adiutor's default time zone, read at most once per request. */
const defaultTimeZone = cache(() => loadDefaultTimeZone(db));

/**
 * Works out the current request's time zone: the cookie's, else Adiutor's
 * default. The default is only read from the database when there's no
 * cookie, which signed-in people with a zone always have.
 *
 * @returns The zone to show times in.
 */
export default async function requestTimeZone(): Promise<string> {
  const chosen = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return isTimeZone(chosen) ? chosen : defaultTimeZone();
}
