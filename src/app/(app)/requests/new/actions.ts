/**
 * @file Server action for raising a request.
 */
'use server';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import { requestPath } from '@/lib/requests';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { raiseRequest } from '@/server/requests';

/**
 * Raises a request and goes to its page, which confirms it. A priority only
 * counts from the staff; the service ignores it otherwise.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `company` (its URL name), `title`, `type`, `description` and,
 *   from the staff, `priority`.
 * @returns Why it failed; on success the browser is sent to the new request.
 */
export default async function raiseRequestAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { number } = await raiseRequest(appContext, actor, {
      companyId: field(formData, 'company'),
      title: field(formData, 'title'),
      type: field(formData, 'type'),
      description: field(formData, 'description'),
      priority: field(formData, 'priority'),
    });
    redirect(`${requestPath(number)}?raised=1`);
  });
}
