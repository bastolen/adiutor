/**
 * @file The "Your companies" card on a company user's dashboard: each
 * company they're in, with their role in it, linking to the company's page.
 * It's their way to a company, and from one company to another: the menu
 * lists no companies.
 */
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { focusRing } from '@/components/ui/styles';
import type { CompanyRole } from '@/lib/authz/roles';
import cn from '@/lib/cn';

/** A company on the card. */
export interface OwnCompany {
  /** Its URL name. */
  slug: string;
  /** Its name. */
  name: string;
  /** The user's role in it. */
  role: CompanyRole;
}

/**
 * Props for {@link YourCompanies}.
 */
interface YourCompaniesProps {
  /** The user's companies, in the order to show them; at least one. */
  companies: readonly OwnCompany[];
}

/**
 * The card: a row per company, with its initials, its name and the user's
 * role. The name is the link, which covers the whole row. The card is called
 * "Your company" when there's one. Its text comes from
 * `dashboard.yourCompanies` and the `roles` namespace.
 *
 * @param props - Card props.
 * @param props.companies - The user's companies.
 * @returns The card.
 */
export default function YourCompanies({ companies }: YourCompaniesProps) {
  const t = useTranslations('dashboard.yourCompanies');
  const tRoles = useTranslations('roles');
  const count = companies.length;
  return (
    <Card flush title={t('title', { count })} description={t('description', { count })}>
      <ul className="divide-y divide-border border-t border-border">
        {companies.map(({ slug, name, role }) => (
          <li key={slug} className="group relative flex items-center gap-4 px-6 py-4">
            <Avatar name={name} />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              {/* The link covers the whole row, so the row is one click target; on its own it's
                  2px taller above and below too, like every text link (at least 24px). */}
              <Link
                href={`/companies/${slug}`}
                className={cn(
                  '-my-0.5 rounded-sm py-0.5 font-medium wrap-anywhere text-foreground group-hover:underline group-hover:underline-offset-4 after:absolute after:inset-0',
                  focusRing,
                )}
              >
                {name}
              </Link>
              <Badge>{tRoles(`${role}.label`)}</Badge>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
