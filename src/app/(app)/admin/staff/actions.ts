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
import {
  renameStaff,
  setDefaultLocale,
  setDefaultTimeZone,
  setRequestPrefix,
} from '@/server/people/staff';
import {
  addRequestType,
  archiveRequestType,
  moveRequestType,
  restoreRequestType,
  updateRequestType,
} from '@/server/requests';

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
    const t = await getTranslations('admin.staff.timeZone');
    return { ok: true, message: t('saved') };
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

/**
 * The fields of a request type's form.
 *
 * @param formData - Fields `name`, `description` and `startingPriority`.
 * @returns The fields.
 */
function typeFields(formData: FormData) {
  return {
    name: field(formData, 'name'),
    description: field(formData, 'description'),
    startingPriority: field(formData, 'startingPriority'),
  };
}

/**
 * Adds a request type.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `name`, `description` and `startingPriority`.
 * @returns A confirmation, or why it failed.
 */
export async function addRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await addRequestType(appContext, actor, typeFields(formData));
    refresh();
    const t = await getTranslations('admin.staff.requestTypes');
    return { ok: true, message: t('added') };
  });
}

/**
 * Changes a request type's name, what it's for and starting priority.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `type` (its key), `name`, `description` and `startingPriority`.
 * @returns A confirmation, or why it failed.
 */
export async function updateRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { changed } = await updateRequestType(appContext, actor, {
      type: field(formData, 'type'),
      ...typeFields(formData),
    });
    refresh();
    const t = await getTranslations('admin.staff.requestTypes');
    return { ok: true, message: t('saved', { changed: changed ? 'yes' : 'no' }) };
  });
}

/**
 * Moves a request type one place up or down.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `type` (its key) and `direction` (`up` or `down`).
 * @returns A confirmation, or why it failed.
 */
export async function moveRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await moveRequestType(appContext, actor, {
      type: field(formData, 'type'),
      direction: field(formData, 'direction'),
    });
    refresh();
    const t = await getTranslations('admin.staff.requestTypes');
    return { ok: true, message: t('moved') };
  });
}

/**
 * Archives a request type. The row's button names it in its own message
 * (`doneMessage`); this one is for anything else that runs it.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `type` (its key) and `name` (for the confirmation).
 * @returns A confirmation, or why it failed.
 */
export async function archiveRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await archiveRequestType(appContext, actor, { type: field(formData, 'type') });
    refresh();
    const t = await getTranslations('admin.staff.requestTypes');
    return { ok: true, message: t('archivedDone', { name: field(formData, 'name') }) };
  });
}

/**
 * Restores an archived request type.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `type` (its key) and `name` (for the confirmation).
 * @returns A confirmation, or why it failed.
 */
export async function restoreRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await restoreRequestType(appContext, actor, { type: field(formData, 'type') });
    refresh();
    const t = await getTranslations('admin.staff.requestTypes');
    return { ok: true, message: t('restored', { name: field(formData, 'name') }) };
  });
}
