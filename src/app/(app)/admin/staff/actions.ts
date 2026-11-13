/**
 * @file Server actions for the staff page: changing the name shown to users,
 * Adiutor's default language and the prefix of request numbers. Staff roles
 * use `src/app/(app)/_people/staff-actions.ts`, and invitations and invite
 * links `src/app/(app)/_people/invitation-actions.ts`.
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { renameStaff, setDefaultLocale, setRequestPrefix } from '@/server/people/staff';

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
    const t = await getTranslations('admin.staff.name');
    return { ok: true, message: t('saved') };
  });
}

/**
 * Sets Adiutor's default language. Changes nothing for the person saving it,
 * whose own language comes first.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `defaultLocale`.
 * @returns A confirmation, in the request's language, or why it failed.
 */
export async function saveDefaultLanguageAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await setDefaultLocale(appContext, actor, field(formData, 'defaultLocale'));
    refresh();
    const t = await getTranslations('common.language');
    return { ok: true, message: t('defaultSaved') };
  });
}

/**
 * Sets the prefix request numbers are shown with.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `prefix`.
 * @returns A confirmation, or why it failed.
 */
export async function saveRequestPrefixAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await setRequestPrefix(appContext, actor, field(formData, 'prefix'));
    refresh();
    const t = await getTranslations('admin.staff.requestNumbers');
    return { ok: true, message: t('saved') };
  });
}
