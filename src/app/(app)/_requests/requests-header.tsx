/**
 * @file The header of the requests across companies, which the list
 * (`/requests`) and the board (`/requests/board`) share: the title, what the
 * requests are for the reader, "New request" for those who may raise one,
 * and the List | Board toggle. Its text comes from `requests.list`.
 */
import { useTranslations } from 'next-intl';

import PageHeader from '@/components/ui/page-header';
import type { Actor } from '@/server/actor';
import { getStaffPermissionsInCompanies } from '@/server/authz';

import type { RequestFilters } from './request-filters';
import { NewRequestButton } from './request-list';
import RequestViewToggle, { type RequestView } from './request-view-toggle';

/**
 * Props for {@link RequestsHeader}.
 */
interface RequestsHeaderProps {
  /** The viewer: the staff read what every company asked, everyone else what theirs did. */
  actor: Actor;
  /** The name the staff are shown with. */
  staffName: string;
  /** Whether the viewer may raise a request in a company they see. */
  canRaise: boolean;
  /** The view the page shows. */
  view: RequestView;
  /** The filters the page shows the requests with, which the toggle keeps. */
  filters: RequestFilters;
}

/**
 * The page's title ("Requests") and description, a "New request" button for
 * those who may raise one, and below them the List | Board toggle.
 */
export default function RequestsHeader({
  actor,
  staffName,
  canRaise,
  view,
  filters,
}: RequestsHeaderProps) {
  const t = useTranslations('requests.list');
  const staff = getStaffPermissionsInCompanies(actor).has('requests:view');
  return (
    <PageHeader
      title={t('title')}
      description={t('description', { audience: staff ? 'staff' : 'company', staff: staffName })}
      actions={canRaise && <NewRequestButton label={t('new')} />}
    >
      <RequestViewToggle view={view} filters={filters} />
    </PageHeader>
  );
}
