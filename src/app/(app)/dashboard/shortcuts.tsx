/**
 * @file The shortcuts on the dashboard: a tile for Requests, which everyone
 * gets (`requests-section.ts`), then one for each staff section the user may
 * see (`staff-sections.ts`).
 */
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import IconTile from '@/components/ui/icon-tile';
import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';

import REQUESTS_SECTION from '../requests-section';
import { type StaffSectionKey, staffSections } from '../staff-sections';

/** A tile's section: Requests, or a staff section. */
type ShortcutKey = typeof REQUESTS_SECTION.key | StaffSectionKey;

/**
 * Props for {@link Shortcuts}.
 */
interface ShortcutsProps {
  /** The staff sections the user may see (`staffSectionKeys`); none for company users. */
  sections: readonly StaffSectionKey[];
}

/**
 * A grid of shortcut tiles, each a link with an icon, title and description.
 * One column on phones, and never more than two from 640px, however many
 * tiles there are: an odd last tile keeps the others' width, and so does the
 * single Requests tile of a company user. Its text comes from the `dashboard`
 * namespace.
 *
 * @param props - Shortcuts props.
 * @param props.sections - The staff sections to show after Requests.
 * @returns The list of tiles.
 */
export default function Shortcuts({ sections }: ShortcutsProps) {
  const t = useTranslations('dashboard');
  const text: Record<ShortcutKey, { title: string; description: string }> = {
    requests: {
      title: t('shortcuts.requests.title'),
      description: t('shortcuts.requests.description'),
    },
    users: { title: t('shortcuts.users.title'), description: t('shortcuts.users.description') },
    companies: {
      title: t('shortcuts.companies.title'),
      description: t('shortcuts.companies.description'),
    },
    staff: { title: t('shortcuts.staff.title'), description: t('shortcuts.staff.description') },
    logs: { title: t('shortcuts.logs.title'), description: t('shortcuts.logs.description') },
  };

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {[REQUESTS_SECTION, ...staffSections(sections)].map(({ key, href, icon }) => (
        <li key={href}>
          <Link
            href={href}
            className={cn(
              'group flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs transition-colors hover:border-border-strong',
              focusRing,
            )}
          >
            <IconTile icon={icon} tone="primary" />
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {text[key].title}
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="text-sm text-muted-foreground">{text[key].description}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
