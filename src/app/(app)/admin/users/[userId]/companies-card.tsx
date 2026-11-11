/**
 * @file The "Companies" card on the user detail page: the companies the user
 * belongs to, sorted and paginated (`USER_COMPANIES_TABLE`). Staff who may
 * manage members (`members:manage`) also add them to a company, change their
 * role in one and remove them from one, on their own page too (worded for
 * themselves). Text from `admin.user.companies`; the role selects in it
 * translate with `people`, which the page passes with `ClientMessages`.
 */
import { useLocale, useTranslations } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SelectField from '@/components/ui/select-field';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import { COMPANY_ROLES, roleOptions } from '@/lib/authz/roles';
import formatDate from '@/lib/format';
import { type TableLinks } from '@/lib/tables/page-url';
import { type Paged, showsPagination } from '@/lib/tables/table-state';
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
  const t = useTranslations('admin.user.companies');
  const tRoles = useTranslations('roles');
  const companyRoleOptions = roleOptions(COMPANY_ROLES, tRoles);
  return (
    <Card
      id={table.section}
      title={t('title')}
      description={companies.total === 0 ? t('descriptionNone') : t('descriptionSome')}
      actions={
        (canManageMembers || companies.total > 0) && (
          <>
            {companies.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
            {canManageMembers && (
              // Stays (disabled) when there's no company left, so its last message stays visible.
              <ActionDialog
                disabled={addable.length === 0}
                action={addMemberAction}
                fields={{ userId }}
                triggerLabel={t('add.label')}
                title={isSelf ? t('add.titleSelf') : t('add.title', { name: userName })}
                description={isSelf ? t('add.descriptionSelf') : t('add.description')}
                confirmLabel={t('add.confirmLabel')}
                tone="primary"
              >
                <SelectField
                  label={t('add.company')}
                  name="companyId"
                  options={addable.map((company) => ({ value: company.id, label: company.name }))}
                  defaultValue={addable[0]?.id}
                />
                <SelectField
                  label={t('add.role')}
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
          <Pagination {...table.pagination(companies, t('rows'))} />
        )
      }
    >
      {companies.total > 0 && (
        <Table caption={table.caption(t('caption', { name: userName }), companies)}>
          <thead>
            <tr>
              <Th aria-sort={table.ariaSort('name')}>{t('columns.company')}</Th>
              <Th className="hidden sm:table-cell">{t('columns.role')}</Th>
              <Th aria-sort={table.ariaSort('joined')} className="hidden md:table-cell">
                {t('columns.joined')}
              </Th>
              {canManageMembers && (
                <Th className="text-right">
                  <span className="sr-only">{t('columns.actions')}</span>
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
                  memberName={t('memberName', { user: userName, company: membership.name })}
                  currentRole={membership.role}
                  roles={companyRoleOptions}
                  target="company"
                />
              ) : (
                <Badge>{tRoles(`${membership.role}.label`)}</Badge>
              );
              return (
                <Tr key={membership.id}>
                  <Td>
                    <div className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <TextLink href={`/companies/${membership.slug}`} className="wrap-anywhere">
                          {membership.name}
                        </TextLink>
                        {membership.deactivated && <Badge tone="danger">{t('deactivated')}</Badge>}
                      </span>
                      {/* Below tablet width, when they joined goes here. */}
                      <span className="text-xs text-muted-foreground md:hidden">
                        {t('joinedOn', { date: formatDate(membership.joinedAt, locale) })}
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
                        label={t('remove.label')}
                        ariaLabel={t('remove.ariaLabel', {
                          user: userName,
                          company: membership.name,
                        })}
                        doneMessage={t('remove.done', { user: userName, company: membership.name })}
                        variant="danger-subtle"
                        confirm={
                          isSelf
                            ? {
                                title: t('remove.titleSelf', { company: membership.name }),
                                confirmLabel: t('remove.confirmLabel'),
                                // Staff keep working with every company through their staff role.
                                description: t('remove.descriptionSelf', {
                                  company: membership.name,
                                }),
                              }
                            : {
                                title: t('remove.title', {
                                  user: userName,
                                  company: membership.name,
                                }),
                                confirmLabel: t('remove.confirmLabel'),
                                description: t('remove.description', { company: membership.name }),
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
