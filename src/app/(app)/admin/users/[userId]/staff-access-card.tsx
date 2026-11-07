/**
 * @file The "Staff access" card on the user detail page, for staff Admins
 * (`staff:manage`) on someone else's page: make the user staff, change their
 * staff role or remove their staff access. Giving a staff role needs the
 * Admin's recent confirmation, so the dialog and role select ask first, and
 * come back to this card (`staff-access`).
 */
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
  const fields = { userId };
  const staffRoleOptions = roleOptions(PLATFORM_ROLES);
  return (
    <Card
      id="staff-access"
      title="Staff access"
      description={
        staffRole
          ? 'Their staff role applies to every company.'
          : 'Not staff. Staff work with every company.'
      }
      actions={
        staffRole ? (
          <RowAction
            action={removeFromStaffAction}
            fields={fields}
            label="Remove staff access"
            variant="danger-subtle"
            confirm={{
              title: `Remove ${userName}'s staff access?`,
              description:
                'They can no longer work with your companies. Their account and any company memberships stay, and they get an email.',
              confirmLabel: 'Remove staff access',
            }}
          />
        ) : (
          <ActionDialog
            action={changeStaffRoleAction}
            fields={fields}
            // Every staff role needs a recent confirmation: ask before the dialog opens.
            confirmFirst
            triggerLabel="Make staff"
            title={`Make ${userName} staff?`}
            description="They can work with every company, and get an email. Admins and Managers must set up a second sign-in step before they continue."
            confirmLabel="Make staff"
            tone="primary"
          >
            <SelectField
              label="Staff role"
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
          <span className="text-sm text-muted-foreground">Staff role</span>
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
