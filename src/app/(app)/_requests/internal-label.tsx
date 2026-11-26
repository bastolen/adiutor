/**
 * @file What shows where an internal request's company would be: a lock and
 * "Internal". An internal request has no company and only the staff read it
 * (decision 0048). The list, the board and the request's page show it the
 * same way, in the text around it. Its text comes from `requests.internal`.
 */
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * "Internal", with a lock, in place of a company's name.
 */
export default function InternalLabel() {
  const t = useTranslations('requests.internal');
  return (
    <span className="inline-flex items-center gap-1">
      <Lock aria-hidden="true" className="size-3 shrink-0" />
      {t('label')}
    </span>
  );
}
