/**
 * @file Server actions for the staff page: changing the name shown to users.
 * Staff roles use `src/app/(app)/_people/staff-actions.ts`, and invitations
 * and invite links `src/app/(app)/_people/invitation-actions.ts`.
 */
'use server';

import { refresh } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { renameStaff } from '@/server/people/staff';

/**
 * Renames the staff.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `name`.
 * @returns A confirmation, or why it failed.
 */
export default async function renameStaffAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await renameStaff(appContext, actor, field(formData, 'name'));
    refresh();
    return { ok: true, message: 'Name saved.' };
  });
}
