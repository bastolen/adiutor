/**
 * @file Server actions for the Requests tab of Settings: the prefix request
 * numbers are shown with, and adding, editing, reordering, archiving and
 * restoring request types.
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { setRequestPrefix } from '@/server/people/staff';
import {
  addRequestType,
  archiveRequestType,
  moveRequestType,
  restoreRequestType,
  updateRequestType,
} from '@/server/requests';

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
    const t = await getTranslations('admin.settings.requests.requestNumbers');
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
    const t = await getTranslations('admin.settings.requests.requestTypes');
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
    const t = await getTranslations('admin.settings.requests.requestTypes');
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
    const t = await getTranslations('admin.settings.requests.requestTypes');
    return { ok: true, message: t('moved') };
  });
}

/**
 * Archives a request type. The confirmation names it as the service found it.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `type` (its key).
 * @returns A confirmation, or why it failed.
 */
export async function archiveRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { name } = await archiveRequestType(appContext, actor, { type: field(formData, 'type') });
    refresh();
    const t = await getTranslations('admin.settings.requests.requestTypes');
    return { ok: true, message: t('archivedDone', { name }) };
  });
}

/**
 * Restores an archived request type. The confirmation names it as the
 * service found it.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `type` (its key).
 * @returns A confirmation, or why it failed.
 */
export async function restoreRequestTypeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { name } = await restoreRequestType(appContext, actor, { type: field(formData, 'type') });
    refresh();
    const t = await getTranslations('admin.settings.requests.requestTypes');
    return { ok: true, message: t('restored', { name }) };
  });
}
