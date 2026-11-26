/**
 * @file Server actions for the Attachments tab of Settings: where attached
 * files are kept (tried before it's saved, and only with a recent
 * confirmation), setting up the one the environment chooses, whether people
 * can attach files, and the largest file anyone may attach.
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
  saveAttachmentLimit,
  saveAttachmentsEnabled,
  saveAttachmentStorage,
  setUpStorage,
} from '@/server/storage';

import confirmFirstIfNeeded from '../../../_people/confirm-grant';

/**
 * The storage form's fields, for the driver it chose: only those are read,
 * so a field left over from another driver is never sent on.
 *
 * @param formData - The form.
 * @returns The input for `saveAttachmentStorage`.
 */
function storageFields(formData: FormData) {
  const driver = field(formData, 'driver');
  if (driver === 'local') {
    return { driver, dir: field(formData, 'dir') };
  }
  if (driver === 's3') {
    return {
      driver,
      endpoint: field(formData, 'endpoint'),
      region: field(formData, 'region'),
      bucket: field(formData, 'bucket'),
      accessKeyId: field(formData, 'accessKeyId'),
      secretAccessKey: field(formData, 'secretAccessKey'),
      forcePathStyle: formData.get('forcePathStyle') === 'on',
    };
  }
  if (driver === 'sftp') {
    return {
      driver,
      host: field(formData, 'host'),
      port: field(formData, 'port'),
      username: field(formData, 'username'),
      password: field(formData, 'password'),
      privateKey: field(formData, 'privateKey'),
      hostKey: field(formData, 'hostKey'),
      dir: field(formData, 'dir'),
    };
  }
  return { driver };
}

/**
 * Tries and saves where attached files are kept. Without a recent
 * confirmation it sends the user to confirm first, back to the Storage card.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `driver` and the driver's own, and `returnTo`.
 * @returns A confirmation, or why it failed.
 */
export async function saveStorageAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await confirmFirstIfNeeded(formData, '/admin/settings/attachments#storage', () =>
      saveAttachmentStorage(appContext, actor, storageFields(formData)),
    );
    refresh();
    const t = await getTranslations('admin.settings.attachments.storage');
    return { ok: true, message: t('saved') };
  });
}

/**
 * Saves the largest file anyone may attach.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `maxFileMb`.
 * @returns A confirmation, or why it failed.
 */
export async function saveLargestFileAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await saveAttachmentLimit(appContext, actor, field(formData, 'maxFileMb'));
    refresh();
    const t = await getTranslations('admin.settings.attachments.largestFile');
    return { ok: true, message: t('saved') };
  });
}

/**
 * Turns "People can attach files" on or off.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `enabled`: the checkbox, sent only when it's ticked.
 * @returns A confirmation that says which it is now, or why it failed.
 */
export async function saveAttachingAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const on = formData.get('enabled') === 'on';
    await saveAttachmentsEnabled(appContext, actor, on);
    refresh();
    const t = await getTranslations('admin.settings.attachments.attaching');
    return { ok: true, message: on ? t('savedOn') : t('savedOff') };
  });
}

/**
 * Sets up the storage files go to now (one the environment chooses) as
 * Adiutor's, after sending the staff Admin to confirm it's them when they
 * haven't lately.
 *
 * @param _previous - The previous result (unused).
 * @param formData - No fields of its own but the return address (`ReturnToField`).
 * @returns A confirmation, or why it failed.
 */
export async function setUpStorageAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await confirmFirstIfNeeded(formData, '/admin/settings/attachments#storage', () =>
      setUpStorage(appContext, actor),
    );
    refresh();
    const t = await getTranslations('admin.settings.attachments.storage');
    return { ok: true, message: t('setUpDone') };
  });
}
