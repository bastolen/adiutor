/**
 * @file Lets the server actions that give roles send the actor to confirm
 * it's them when the service refuses for lack of a recent confirmation
 * (`confirmation_required`, see `assertConfirmedForGrant`), instead of only
 * showing the refusal. The pages ask first, before a form is filled in; this
 * covers a window that ran out while the form was open, and actions that
 * don't ask first (e.g. "Resend").
 */
import { redirect } from 'next/navigation';

import { confirmChangeUrlFor } from '@/lib/sign-in/confirm-url';
import { ServiceError } from '@/server/errors';

/**
 * Runs an action's work; when the service refuses because the actor must
 * confirm it's them first, redirects to the step-up page, which returns to
 * the form's page and card (its `returnTo` field, see `ReturnToField`, made
 * safe; otherwise `fallback`).
 *
 * @param formData - The submitted form, with an optional `returnTo` path.
 * @param fallback - Where to come back to without a `returnTo`, e.g. `/admin/settings/staff`.
 * @param work - The action's work.
 * @returns What the work returned.
 */
export default async function confirmFirstIfNeeded<T>(
  formData: FormData,
  fallback: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'confirmation_required') {
      redirect(confirmChangeUrlFor(formData, fallback));
    }
    throw error;
  }
}
