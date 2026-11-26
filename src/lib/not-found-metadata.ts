/**
 * @file The metadata of the 404 page, for that page and for pages someone may
 * not see (they get the 404 page, so its title too), in the request's
 * language and with the staff's name. Server only: it reads the request's
 * messages and the staff's name (`requestStaffName`).
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requestStaffName } from '@/server/branding';

/**
 * Metadata for a page or layout the user may not see. `absolute` ignores a
 * parent's title template (a company page's would add the company's name),
 * and `template` (without `%s`) gives every page below a layout the same
 * title, whatever title they set themselves.
 *
 * @returns The metadata, e.g. the title "Not found · Adiutor" (with the staff's name).
 */
export default async function notFoundMetadata(): Promise<Metadata> {
  const [t, staff] = await Promise.all([getTranslations('common'), requestStaffName()]);
  const title = t('documentTitle', { page: t('notFound.title'), staff });
  return { title: { absolute: title, template: title } };
}
