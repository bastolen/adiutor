/**
 * @file The "You" badge on the viewer's own row in a table of people (users,
 * staff, a company's members), next to the accent bar of `ownRowCell`.
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';

/**
 * Says which row is the viewer's own, in the accent tone, so it stands apart
 * from roles and statuses.
 *
 * @returns The badge.
 */
export default function YouBadge() {
  const t = useTranslations('people');
  return <Badge tone="accent">{t('you')}</Badge>;
}
