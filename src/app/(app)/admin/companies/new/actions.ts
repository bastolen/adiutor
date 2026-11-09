/**
 * @file Server action for adding a company.
 */
'use server';

import type { ActionResult } from '@/lib/action-result';
import field, { localeField } from '@/lib/form-data';
import inviteStatusMessage from '@/lib/invite-status';
import { emailSchema } from '@/lib/validation';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { registerCompany } from '@/server/people/companies';

import confirmFirstIfNeeded from '../../../_people/confirm-grant';

/**
 * Adds a company and invites its first admin.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `name`, `slug`, `adminEmail` and `locale` (the invitation's language).
 * @returns A confirmation with the new company's ID and URL name, or why it failed.
 */
export default async function registerCompanyAction(
  _previous: ActionResult<{ companyId: string; slug: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ companyId: string; slug: string }>> {
  return runAction(async () => {
    const actor = await getActor();
    const adminEmail = emailSchema.parse(field(formData, 'adminEmail'));
    // Its first Admin gets the company's Admin role: without a recent confirmation, confirm first.
    const { companyId, slug, inviteStatus } = await confirmFirstIfNeeded(
      formData,
      '/admin/companies/new',
      () =>
        registerCompany(appContext, actor, {
          name: field(formData, 'name'),
          slug: field(formData, 'slug'),
          adminEmail,
          locale: localeField(formData),
        }),
    );
    return {
      ok: true,
      message: `Company added. ${inviteStatusMessage(adminEmail, inviteStatus)}`,
      data: { companyId, slug },
    };
  });
}
