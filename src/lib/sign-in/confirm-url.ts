/**
 * @file Where the app sends a user to confirm it's them with their second
 * step before a change that needs a confirmation from the last 15 minutes
 * (`needsRecentConfirmation` in `src/lib/authz/mfa/actor-gates.ts`): changing how they
 * sign in, resetting someone else's MFA, or giving someone a staff role or a
 * company's Admin role (`grantNeedsConfirmation`); and before signing in as
 * someone, which needs a strong second step whatever the role
 * (`strongMfaConfirmedUntil`). The step-up page returns to the page they were
 * on, with its tables' sort and page and the anchor of the card where they
 * clicked (`ReturnToField`, `useRecentConfirmation`).
 */
import { getSafeRedirectPath } from '@/lib/redirect';

/**
 * The step-up page's modes:
 * - `change`: only the methods that open the window for changing sign-in
 *   methods (`windowOpeningMethods`);
 * - `strong`: only the strong methods that open it whatever the role
 *   (`strongStepUpMethods`), never email codes.
 */
type ConfirmMode = 'change' | 'strong';

/**
 * The step-up page in a mode, returning to a page of the app once confirmed.
 * The whole return address is encoded, so its query and anchor stay inside
 * `callbackURL`.
 *
 * @param returnTo - The page to come back to, already a safe app path, e.g.
 *   `/admin/staff?inv-page=2#invitations`.
 * @param mode - Which methods to offer ({@link ConfirmMode}).
 * @returns The step-up page's address.
 */
function confirmUrl(returnTo: string, mode: ConfirmMode): string {
  return `/auth/verify?callbackURL=${encodeURIComponent(returnTo)}&for=${mode}`;
}

/**
 * The page a form came from: its `returnTo` field (see `ReturnToField`),
 * made safe with `getSafeRedirectPath`, or `fallback` when the form has none.
 *
 * @param formData - The submitted form, with an optional `returnTo` path.
 * @param fallback - Where to come back to without a `returnTo`, e.g. `/admin/staff`.
 * @returns The page, a safe app path.
 */
function returnToOf(formData: FormData, fallback: string): string {
  const returnTo = formData.get('returnTo');
  return getSafeRedirectPath(typeof returnTo === 'string' ? returnTo : fallback);
}

/**
 * The step-up page in its change mode (`for=change`), which only offers the
 * methods that open the window (`windowOpeningMethods`), returning to a page
 * of the app once confirmed.
 *
 * @param returnTo - The page to come back to, already a safe app path, e.g.
 *   `/admin/staff?inv-page=2#invitations`.
 * @returns The step-up page's address.
 */
export default function confirmChangeUrl(returnTo: string): string {
  return confirmUrl(returnTo, 'change');
}

/**
 * The step-up page for a server action that must send the user to confirm
 * first, returning to the page the form was on (its `returnTo` field, or
 * `fallback`).
 *
 * @param formData - The submitted form, with an optional `returnTo` path.
 * @param fallback - Where to come back to without a `returnTo`, e.g. `/admin/staff`.
 * @returns The step-up page's address.
 */
export function confirmChangeUrlFor(formData: FormData, fallback: string): string {
  return confirmChangeUrl(returnToOf(formData, fallback));
}

/**
 * The step-up page in its strong mode (`for=strong`), which only offers the
 * strong methods that open the window whatever the role
 * (`strongStepUpMethods`), returning to a page of the app once confirmed.
 *
 * @param returnTo - The page to come back to, already a safe app path, e.g.
 *   `/admin/users/<id>#sign-in-as`.
 * @returns The step-up page's address.
 */
export function confirmStrongUrl(returnTo: string): string {
  return confirmUrl(returnTo, 'strong');
}

/**
 * The step-up page in its strong mode, for a server action that needs a
 * confirmation with a strong second step whatever the role (signing in as
 * someone), returning to the page the form was on (its `returnTo` field, or
 * `fallback`).
 *
 * @param formData - The submitted form, with an optional `returnTo` path.
 * @param fallback - Where to come back to without a `returnTo`, e.g. a user's page.
 * @returns The step-up page's address.
 */
export function confirmStrongUrlFor(formData: FormData, fallback: string): string {
  return confirmStrongUrl(returnToOf(formData, fallback));
}

/**
 * The confirmation window as plain numbers for the browser: the end of the
 * window and the server's time now, so the browser can tell when it has run
 * out whatever its own clock says (`RecentConfirmationProvider`).
 *
 * @param until - The end of the window (`Actor.mfaConfirmedUntil`), or `null`.
 * @returns Milliseconds since the epoch, on the server's clock.
 */
export function confirmationWindow(until: Date | null): {
  confirmedUntil: number | null;
  serverTime: number;
} {
  return { confirmedUntil: until?.getTime() ?? null, serverTime: Date.now() };
}
