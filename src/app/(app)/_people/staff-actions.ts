/**
 * @file Server actions for staff roles, shared by the staff page and the user
 * detail page: giving someone a staff role (or changing it) and taking them
 * off the staff. Renaming the staff stays with the staff page, and company
 * memberships use `member-actions.ts`.
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { currentPermissionsOf, getActor } from '@/server/authz';
import { changeStaffRole, removeFromStaff } from '@/server/people/staff';

import { withAccessNotice } from '../access-notices';
import confirmFirstIfNeeded from './confirm-grant';

/**
 * Gives a user a staff role: makes them staff, or changes their role. They get
 * a security email. A staff Admin who steps down can't manage the staff any
 * more, so they're sent to the dashboard (with a notice, see
 * `src/app/(app)/access-notices.ts`) rather than to the staff page's 404.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId` and `role`.
 * @returns A confirmation, or why it failed; redirects after stepping down.
 */
export async function changeStaffRoleAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const userId = field(formData, 'userId');
    // Making someone staff, or raising their role, sends the actor to confirm it's them first.
    await confirmFirstIfNeeded(formData, '/admin/staff', () =>
      changeStaffRole(appContext, actor, { userId, role: field(formData, 'role') }),
    );
    if (
      userId === actor.id &&
      !(await currentPermissionsOf(appContext.db, actor.id, null)).has('staff:manage')
    ) {
      redirect(withAccessNotice('/dashboard', 'stepped-down'));
    }
    refresh();
    return { ok: true, message: 'Staff role saved.' };
  });
}

/**
 * Takes someone off the staff. Their account and company memberships stay.
 * Someone who takes themselves off is sent to the dashboard with a notice.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `userId`.
 * @returns A confirmation, or why it failed; redirects after leaving.
 */
export async function removeFromStaffAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const userId = field(formData, 'userId');
    await removeFromStaff(appContext, actor, userId);
    if (userId === actor.id) {
      redirect(withAccessNotice('/dashboard', 'left-staff'));
    }
    refresh();
    return { ok: true, message: 'Staff access removed.' };
  });
}
