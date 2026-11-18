/**
 * @file The "Companies" card on the user detail page: the companies the user
 * belongs to, sorted and paginated (`USER_COMPANIES_TABLE`). Staff who may
 * manage members (`members:manage`) also add them to a company, change their
 * role in one and remove them from one, on their own page too (worded for
 * themselves). It offers only what the services allow: a deactivated
 * company's membership shows its role and nothing to press, and a
 * deactivated account can't be added to a company, which the card says. Text
 * from `admin.user.companies`; the role selects in it translate with
 * `people`, which the page passes with `ClientMessages`.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { paginationFooter } from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SelectField from '@/components/ui/select-field';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import { COMPANY_ROLES, roleOptions } from '@/lib/authz/roles';
import formatDate from '@/lib/format';
import { type TableLinks } from '@/lib/tables/page-url';
import { type Paged } from '@/lib/tables/table-state';
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
  /**
   * Whether the user's account is deactivated. It can't be added to a company
   * until it's reactivated (`addMember` refuses it), so "Add to company" is
   * turned off and the card says why.
   */
  userDeactivated: boolean;
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
 * The user's companies, with the membership controls when allowed. A
 * membership of a deactivated company has none (its role is a badge): the
 * services refuse every change there until the company is reactivated, as
 * the company's own Members page shows. "Add to company" is turned off for a
 * deactivated account, staying focusable with its reason below the table.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.isSelf - Whether it's the viewer's own page.
 * @param props.userDeactivated - Whether the user's account is deactivated.
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
  userDeactivated,
  companies,
  table,
  canManageMembers,
  addable,
}: CompaniesCardProps) {
  const locale = useLocale();
  const t = useTranslations('admin.user.companies');
  const tRoles = useTranslations('roles');
  const companyRoleOptions = roleOptions(COMPANY_ROLES, tRoles);
  // A deactivated account can't be added to a company: the button is off and the card says why.
  const addRefused = canManageMembers && userDeactivated;
  const addRefusedId = useId();
  // Memberships of deactivated companies have nothing to press; without any other, no column.
  const hasActions =
    canManageMembers && companies.items.some((membership) => !membership.deactivated);
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
                disabled={addable.length === 0 || userDeactivated}
                // Adding the last company leaves none to add; it keeps focus then. For a
                // deactivated account it stays reachable, so its reason can be read.
                focusableWhenDisabled
                describedBy={userDeactivated ? addRefusedId : undefined}
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
      flush={companies.total > 0 || addRefused}
      footer={paginationFooter(table, companies, t('rows'))}
    >
      {/* One child or none: the card keeps its bottom space only when there's nothing below. */}
      {(companies.total > 0 || addRefused) && (
        <>
          {companies.total > 0 && (
            <Table caption={table.caption(t('caption', { name: userName }), companies)}>
              <thead>
                <tr>
                  <Th aria-sort={table.ariaSort('name')}>{t('columns.company')}</Th>
                  <Th className="hidden sm:table-cell">{t('columns.role')}</Th>
                  <Th aria-sort={table.ariaSort('joined')} className="hidden md:table-cell">
                    {t('columns.joined')}
                  </Th>
                  {hasActions && (
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
                  // Nothing in a deactivated company can be changed until it's reactivated.
                  const manageable = canManageMembers && !membership.deactivated;
                  // Shown in its own column on wider screens and below the name on phones.
                  const role = manageable ? (
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
                            <TextLink
                              standalone
                              href={`/companies/${membership.slug}`}
                              className="wrap-anywhere"
                            >
                              {membership.name}
                            </TextLink>
                            {membership.deactivated && (
                              <Badge tone="danger">{t('deactivated')}</Badge>
                            )}
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
                      {hasActions && (
                        <Td className="text-right">
                          {manageable && (
                            <RowAction
                              action={removeMemberAction}
                              fields={membershipFields}
                              label={t('remove.label')}
                              ariaLabel={t('remove.ariaLabel', {
                                user: userName,
                                company: membership.name,
                              })}
                              doneMessage={t('remove.done', {
                                user: userName,
                                company: membership.name,
                              })}
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
                                      description: t('remove.description', {
                                        company: membership.name,
                                      }),
                                    }
                              }
                            />
                          )}
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {addRefused && (
            // Why "Add to company" is off, which the button points to (`describedBy`).
            <p
              id={addRefusedId}
              className="border-t border-border px-6 py-3 text-xs text-muted-foreground"
            >
              {t('add.accountDeactivated')}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
