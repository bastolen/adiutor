/**
 * @file The staff's name for the page being rendered (decision 0050): the
 * name every text shows instead of "Adiutor", read once per request for the
 * root layout, page metadata and server components.
 */
import { cache } from 'react';

import { db } from '@/db';
import { ADIUTOR_NAME } from '@/lib/branding';

import getStaffName from '../people/staff-name';

/**
 * The staff's name, read at most once per request. The error pages render
 * inside the root layout too, and the database may be what's failing: then
 * the page says "Adiutor", and the failure is logged (without any value).
 *
 * @returns The name, e.g. "Acme Support", or "Adiutor" before setup names the staff.
 */
const requestStaffName: () => Promise<string> = cache(async () => {
  try {
    return await getStaffName(db);
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the staff's name couldn't be read; nothing personal in it.
    console.warn('The staff’s name could not be read; a page says Adiutor.');
    return ADIUTOR_NAME;
  }
});

export default requestStaffName;
