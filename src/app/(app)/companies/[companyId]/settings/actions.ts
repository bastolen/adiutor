/**
 * @file Server actions for the company settings page.
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { setCompanyActive, updateCompany } from '@/server/people/companies';

/**
 * Saves the company's name and URL name. A new URL name moves the company to
 * a new address, so the page follows it there (`?saved=1` confirms it on
 * arrival) instead of reloading the old one, which no longer resolves.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId`, `name` and `slug`.
 * @returns A confirmation, or why it failed.
 */
export async function updateCompanyAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { slug, slugChanged } = await updateCompany(appContext, actor, {
      companyId: field(formData, 'companyId'),
      name: field(formData, 'name'),
      slug: field(formData, 'slug'),
    });
    // The old address no longer resolves: follow the company to its new one (`runAction` passes
    // the redirect on).
    if (slugChanged) {
      redirect(`/companies/${slug}/settings?saved=1`);
    }
    refresh();
    const t = await getTranslations('companies.settings');
    return { ok: true, message: t('saved') };
  });
}

/**
 * Deactivates or reactivates the company.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId` and `active` (`"true"` or `"false"`).
 * @returns A confirmation, or why it failed.
 */
export async function setActiveAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const active = field(formData, 'active') === 'true';
    await setCompanyActive(appContext, actor, { companyId: field(formData, 'companyId'), active });
    refresh();
    const t = await getTranslations('companies.settings.danger');
    return {
      ok: true,
      message: active ? t('reactivate.done') : t('deactivate.done'),
    };
  });
}
