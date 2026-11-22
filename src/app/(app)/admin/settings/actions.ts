/**
 * @file Server actions for the General tab of Settings: changing the name
 * shown to users, Adiutor's languages (the default and the ones it offers)
 * and its default time zone. The Requests tab's actions are in
 * `requests/actions.ts`; staff roles use `src/app/(app)/_people/staff-actions.ts`,
 * and invitations and invite links `src/app/(app)/_people/invitation-actions.ts`.
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { renameStaff, setDefaultTimeZone, setLanguages } from '@/server/people/staff';

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
    const t = await getTranslations('admin.settings.general.name');
    return { ok: true, message: t('saved') };
  });
}

/**
 * Sets Adiutor's languages: its default and the ones it offers. Changes
 * nothing for the person saving it while their own language stays on. The
 * confirmation is in the request's language as it was when the action
 * started.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `defaultLocale` and `offered` (one per language that's on).
 * @returns A confirmation, or why it failed.
 */
export async function saveLanguagesAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const t = await getTranslations('admin.settings.general.languages');
    await setLanguages(appContext, actor, {
      defaultLocale: field(formData, 'defaultLocale'),
      offered: formData.getAll('offered').filter((value) => typeof value === 'string'),
    });
    refresh();
    return { ok: true, message: t('saved') };
  });
}

/**
 * Sets Adiutor's default time zone. Changes nothing for anyone who has a zone
 * of their own, the person saving it included.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `defaultTimeZone`.
 * @returns A confirmation, in the request's language, or why it failed.
 */
export async function saveDefaultTimeZoneAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await setDefaultTimeZone(appContext, actor, field(formData, 'defaultTimeZone'));
    refresh();
    const t = await getTranslations('admin.settings.general.timeZone');
    return { ok: true, message: t('saved') };
  });
}
