/**
 * @file Server actions for the Appearance tab of Settings: the brand colours,
 * the logo and browser tab icon (decision 0052), and light and dark mode
 * (decision 0053).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { BRAND_IMAGE_KINDS, type BrandImageKind } from '@/lib/branding';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import {
  removeBrandImage,
  setBrandColours,
  setBrandImage,
  setForcedTheme,
} from '@/server/branding';
import { notFoundError } from '@/server/errors';

/**
 * Saves the brand colours; every page shows them from the next render, this
 * one included (`refresh()`).
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `accent`, `accentDark` and `tint`, each a colour or empty.
 * @returns A confirmation, or why it failed.
 */
export default async function saveBrandColoursAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await setBrandColours(appContext, actor, {
      accent: field(formData, 'accent'),
      accentDark: field(formData, 'accentDark'),
      tint: field(formData, 'tint'),
    });
    refresh();
    const t = await getTranslations('admin.settings.appearance.colours');
    return { ok: true, message: t('saved') };
  });
}

/**
 * Which brand image a form is about: its `kind` field.
 *
 * @param formData - The form's data.
 * @returns The kind.
 * @throws {ServiceError} `not_found` for anything else.
 */
function kindOf(formData: FormData): BrandImageKind {
  const kind = BRAND_IMAGE_KINDS.find((known) => known === field(formData, 'kind'));
  if (!kind) {
    throw notFoundError();
  }
  return kind;
}

/**
 * Uploads the logo or an own browser tab icon; every page shows it from the
 * next render, this one included (`refresh()`).
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `kind` (`logo` or `icon`) and `file`, the image.
 * @returns A confirmation, or why it was refused.
 */
export async function uploadBrandImageAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const kind = kindOf(formData);
    const file = formData.get('file');
    // No file reads as an empty one, which the service refuses.
    const bytes =
      file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    await setBrandImage(appContext, actor, kind, bytes);
    refresh();
    const t = await getTranslations('admin.settings.appearance');
    return { ok: true, message: t(`${kind}.saved` as const) };
  });
}

/**
 * Removes the logo, or the own browser tab icon, so Adiutor's logo or the
 * icon made from the logo shows again.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `kind` (`logo` or `icon`).
 * @returns A confirmation, or why it was refused.
 */
export async function removeBrandImageAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const kind = kindOf(formData);
    await removeBrandImage(appContext, actor, kind);
    refresh();
    const t = await getTranslations('admin.settings.appearance');
    return { ok: true, message: t(`${kind}.removed` as const) };
  });
}

/**
 * Keeps every page in light or dark mode, or lets each person choose again;
 * every page shows it from the next render, this one included (`refresh()`).
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `theme`: `both`, `light` or `dark`.
 * @returns A confirmation, or why it was refused.
 */
export async function saveForcedThemeAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await setForcedTheme(appContext, actor, field(formData, 'theme'));
    refresh();
    const t = await getTranslations('admin.settings.appearance.theme');
    return { ok: true, message: t('saved') };
  });
}
