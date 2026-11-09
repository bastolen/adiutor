/**
 * @file The "Staff access" card on the user detail page, for staff Admins
 * (`staff:manage`) on someone else's page: make the user staff, change their
 * staff role or remove their staff access. Giving a staff role needs the
 * Admin's recent confirmation, so the dialog and role select ask first, and
 * come back to this card (`staff-access`). Text from `admin.user.staffAccess`; the
 * role select in it translates with `people`, which the page passes with
 * `ClientMessages`.
 */
import { useTranslations } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import SelectField from '@/components/ui/select-field';
import { PLATFORM_ROLES, roleOptions, type PlatformRole } from '@/lib/authz/roles';

import RoleSelect from '../../../_people/role-select';
import { changeStaffRoleAction, removeFromStaffAction } from '../../../_people/staff-actions';

/**
 * Props for {@link StaffAccessCard}.
 */
interface StaffAccessCardProps {
  /** The user's ID. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** Their staff role, or `null` when they aren't staff. */
  staffRole: PlatformRole | null;
}

/**
 * The user's staff access, with the controls to change it.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.staffRole - Their staff role, if any.
 * @returns The card.
 */
export default function StaffAccessCard({ userId, userName, staffRole }: StaffAccessCardProps) {
  const t = useTranslations('admin.user.staffAccess');
  const tRoles = useTranslations('roles');
  const fields = { userId };
  const staffRoleOptions = roleOptions(PLATFORM_ROLES, tRoles);
  return (
    <Card
      id="staff-access"
      title={t('title')}
      description={staffRole ? t('descriptionStaff') : t('descriptionNone')}
      actions={
        staffRole ? (
          <RowAction
            action={removeFromStaffAction}
            fields={fields}
            label={t('remove.label')}
            variant="danger-subtle"
            confirm={{
              title: t('remove.title', { name: userName }),
              description: t('remove.description'),
              confirmLabel: t('remove.confirmLabel'),
            }}
          />
        ) : (
          <ActionDialog
            action={changeStaffRoleAction}
            fields={fields}
            // Every staff role needs a recent confirmation: ask before the dialog opens.
            confirmFirst
            triggerLabel={t('make.label')}
            title={t('make.title', { name: userName })}
            description={t('make.description')}
            confirmLabel={t('make.confirmLabel')}
            tone="primary"
          >
            <SelectField
              label={t('staffRole')}
              name="role"
              options={staffRoleOptions}
              defaultValue="support"
            />
          </ActionDialog>
        )
      }
    >
      {staffRole && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{t('staffRole')}</span>
          <RoleSelect
            action={changeStaffRoleAction}
            fields={fields}
            memberName={userName}
            currentRole={staffRole}
            roles={staffRoleOptions}
            target="staff"
          />
        </div>
      )}
    </Card>
  );
}
