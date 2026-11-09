/**
 * @file The metadata of the 404 page, for that page and for pages someone may
 * not see (they get the 404 page, so its title too), in the request's
 * language. Server only: it reads the request's messages.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

/**
 * Metadata for a page or layout the user may not see. `absolute` ignores a
 * parent's title template (a company page's would add the company's name),
 * and `template` (without `%s`) gives every page below a layout the same
 * title, whatever title they set themselves.
 *
 * @returns The metadata, e.g. the title "Not found · Adiutor".
 */
export default async function notFoundMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  const title = t('documentTitle', { page: t('notFound.title') });
  return { title: { absolute: title, template: title } };
}
