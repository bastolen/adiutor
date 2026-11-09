/**
 * @file The "Companies" card on the user detail page: the companies the user
 * belongs to, sorted and paginated (`USER_COMPANIES_TABLE`). Staff who may
 * manage members (`members:manage`) also add them to a company, change their
 * role in one and remove them from one, on their own page too (worded for
 * themselves).
 */
import { useLocale } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SelectField from '@/components/ui/select-field';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import { COMPANY_ROLES, ROLE_LABELS, roleOptions } from '@/lib/authz/roles';
import formatDate from '@/lib/format';
import { type Paged, showsPagination, type TableLinks } from '@/lib/tables/table-state';
import type { UserCompanySort } from '@/lib/tables/tables';
import type { AddableCompany } from '@/server/people/members';
import type { UserCompany } from '@/server/people/user-admin';

import {
  addMemberAction,
  changeRoleAction,
  removeMemberAction,
} from '../../../_people/member-actions';
import RoleSelect from '../../../_people/role-select';

/**
 * Props for {@link CompaniesCard}.
 */
interface CompaniesCardProps {
  /** The user's ID. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** Whether it's the viewer's own page, which words the controls for themselves. */
  isSelf: boolean;
  /** The page of their companies to show. */
  companies: Paged<UserCompany>;
  /** The companies table's links (sorts and pages). */
  table: TableLinks<UserCompanySort>;
  /** Whether the viewer may add, change and remove memberships. */
  canManageMembers: boolean;
  /** The companies they can still be added to (empty when the viewer may not manage members). */
  addable: AddableCompany[];
}

/**
 * The user's companies, with the membership controls when allowed.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.isSelf - Whether it's the viewer's own page.
 * @param props.companies - The page of companies to show.
 * @param props.table - The table's links.
 * @param props.canManageMembers - Whether the viewer may manage memberships.
 * @param props.addable - The companies they can be added to.
 * @returns The card.
 */
export default function CompaniesCard({
  userId,
  userName,
  isSelf,
  companies,
  table,
  canManageMembers,
  addable,
}: CompaniesCardProps) {
  const locale = useLocale();
  const companyRoleOptions = roleOptions(COMPANY_ROLES);
  return (
    <Card
      id={table.section}
      title="Companies"
      description={
        companies.total === 0 ? 'Not a member of any company.' : 'The companies they belong to.'
      }
      actions={
        (canManageMembers || companies.total > 0) && (
          <>
            {companies.total > 0 && <SortMenu label="companies" options={table.sortOptions()} />}
            {canManageMembers && (
              // Stays (disabled) when there's no company left, so its last message stays visible.
              <ActionDialog
                disabled={addable.length === 0}
                action={addMemberAction}
                fields={{ userId }}
                triggerLabel="Add to company"
                title={isSelf ? 'Add yourself to a company' : `Add ${userName} to a company`}
                description={
                  isSelf
                    ? 'You become a member right away, with the role you choose, and get an email.'
                    : 'They become a member right away, with the role you choose, and get an email.'
                }
                confirmLabel="Add to company"
                tone="primary"
              >
                <SelectField
                  label="Company"
                  name="companyId"
                  options={addable.map((company) => ({ value: company.id, label: company.name }))}
                  defaultValue={addable[0]?.id}
                />
                <SelectField
                  label="Role"
                  name="role"
                  options={companyRoleOptions}
                  defaultValue="client"
                />
              </ActionDialog>
            )}
          </>
        )
      }
      flush={companies.total > 0}
      footer={
        showsPagination(companies.total) && (
          <Pagination {...table.pagination(companies, 'companies')} />
        )
      }
    >
      {companies.total > 0 && (
        <Table caption={table.caption(`Companies of ${userName}`, companies)}>
          <thead>
            <tr>
              <Th aria-sort={table.ariaSort('name')}>Company</Th>
              <Th className="hidden sm:table-cell">Role</Th>
              <Th aria-sort={table.ariaSort('joined')} className="hidden md:table-cell">
                Joined
              </Th>
              {canManageMembers && (
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {companies.items.map((membership) => {
              const membershipFields = {
                companyId: membership.id,
                membershipId: membership.membershipId,
              };
              // Shown in its own column on wider screens and below the name on phones.
              const role = canManageMembers ? (
                <RoleSelect
                  action={changeRoleAction}
                  fields={membershipFields}
                  memberName={`${userName} in ${membership.name}`}
                  currentRole={membership.role}
                  roles={companyRoleOptions}
                  target="company"
                />
              ) : (
                <Badge>{ROLE_LABELS[membership.role]}</Badge>
              );
              return (
                <Tr key={membership.id}>
                  <Td>
                    <div className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <TextLink href={`/companies/${membership.slug}`} className="wrap-anywhere">
                          {membership.name}
                        </TextLink>
                        {membership.deactivated && <Badge tone="danger">Deactivated</Badge>}
                      </span>
                      {/* Below tablet width, when they joined goes here. */}
                      <span className="text-xs text-muted-foreground md:hidden">
                        Joined {formatDate(membership.joinedAt, locale)}
                      </span>
                      <div className="sm:hidden">{role}</div>
                    </div>
                  </Td>
                  <Td className="hidden sm:table-cell">{role}</Td>
                  <Td className="hidden text-muted-foreground md:table-cell">
                    {formatDate(membership.joinedAt, locale)}
                  </Td>
                  {canManageMembers && (
                    <Td className="text-right">
                      <RowAction
                        action={removeMemberAction}
                        fields={membershipFields}
                        label="Remove"
                        ariaLabel={`Remove ${userName} from ${membership.name}`}
                        doneMessage={`${userName} was removed from ${membership.name}.`}
                        variant="danger-subtle"
                        confirm={
                          isSelf
                            ? {
                                title: `Remove yourself from ${membership.name}?`,
                                confirmLabel: 'Remove member',
                                // Staff keep working with every company through their staff role.
                                description: `You'll no longer be a member of ${membership.name}. Your staff role still lets you work with it, and you can add yourself again later.`,
                              }
                            : {
                                title: `Remove ${userName} from ${membership.name}?`,
                                confirmLabel: 'Remove member',
                                description: `They'll lose access to ${membership.name}. Their account stays, and you can add them again later.`,
                              }
                        }
                      />
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
