/**
 * @file Server actions for the Appearance tab of Settings: the brand colours.
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { setBrandColours } from '@/server/branding';

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
