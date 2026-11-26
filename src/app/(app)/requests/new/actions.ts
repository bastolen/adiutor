/**
 * @file Server actions for raising a request, and for the people the staff
 * can raise it for.
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import { requestPath } from '@/lib/requests';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { listRaisableFor, type RaisableForPerson, raiseRequest } from '@/server/requests';

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
 *   from the staff, `priority` and `raised_for` (the key of the person it's raised for; empty
 *   when the staff member raises it).
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
      raisedFor: field(formData, 'raised_for'),
    });
    refresh();
    redirect(`${requestPath(number)}?raised=1`);
  });
}

/**
 * Lists who the viewer can raise a request in a company for
 * (`listRaisableFor`), for the form's select when another company is
 * chosen: a key and a name each, never an ID or an address. A read: it
 * changes nothing.
 *
 * @param company - The company's URL name, as the browser sent it.
 * @returns The people; nobody for a company the viewer may not raise a request for others in,
 *   like for one that doesn't exist.
 */
export async function raiseForChoicesAction(company: unknown): Promise<RaisableForPerson[]> {
  if (typeof company !== 'string' || company === '') {
    return [];
  }
  const actor = await getActor();
  try {
    return await listRaisableFor(appContext, actor, company);
  } catch (error) {
    // Whatever the viewer may not see or raise for others in has nobody to choose.
    if (error instanceof ServiceError) {
      return [];
    }
    throw error;
  }
}
