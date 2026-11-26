/**
 * @file Server action for raising a request.
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import field, { fieldValues } from '@/lib/form-data';
import { requestPath } from '@/lib/requests';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { raiseRequest } from '@/server/requests';

/**
 * Raises a request and goes to its page, which confirms it. A priority only
 * counts from the staff; the service ignores it otherwise.
 *
 * It refreshes before it redirects: Next drops the pages it kept alive only
 * for an action that refreshes, and a redirect alone leaves them as they
 * were. Back would then show this form still filled in, ready to raise the
 * request again, and the list before it without the new request.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `company` (its URL name), `title`, `type`, `description` and,
 *   from the staff, `priority`, and an `attachment` for each file sent with it.
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
      attachments: fieldValues(formData, 'attachment'),
    });
    refresh();
    redirect(`${requestPath(number)}?raised=1`);
  });
}
