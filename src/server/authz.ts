/**
 * @file The signed-in user and their permissions, for pages and server
 * actions.
 *
 * Roles are loaded fresh on every request (deduplicated within it), so a
 * changed or removed role takes effect immediately. Reading the session is
 * request-time work: render components that call these helpers inside a
 * `<Suspense>` boundary.
 */
import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { after } from 'next/server';
import { cache } from 'react';

import { auth } from '@/lib/auth';
import { mustSetUpMfa, mustStepUp, sessionMfaOf } from '@/lib/authz/mfa';
import type { Permission } from '@/lib/authz/permissions';
import { getSafeRedirectPath } from '@/lib/redirect';
import PATHNAME_HEADER from '@/lib/request/pathname-header';

import { type CompanyAccess, getCompanyAccess, getGlobalPermissions } from './access';
import { type Actor, loadActor, touchLastActive } from './actor';
import appContext from './app-context';
import { ServiceError } from './errors';

/**
 * The permission helpers pages use to decide what to show, so pages check
 * permissions only through this module (`./access` is for services).
 */
export {
  type Company,
  currentPermissionsOf,
  getGlobalPermissions,
  getStaffPermissionsInCompanies,
} from './access';

/**
 * Returns the signed-in user with their roles, or `null` when signed out.
 * When they were last active is recorded after the response (Next's
 * `after`), so the page doesn't wait for that write or a lock on their row;
 * Next logs it if it fails.
 *
 * @returns The actor, or `null`.
 */
export const getOptionalActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }
  const sessionMfa = sessionMfaOf(session.session);
  const actor = await loadActor(appContext.db, session.user.id, {
    id: session.session.id,
    ...sessionMfa,
    // When it signed in, for the one-hour rule (`needsFreshSignIn`).
    createdAt: session.session.createdAt,
  });
  // A deactivated account counts as signed out (its sessions are revoked as well).
  if (!actor || actor.deactivatedAt) {
    return null;
  }
  after(() => touchLastActive(appContext.db, actor.id));
  return actor;
});

/** Where users whose role requires MFA are sent until they've set it up. */
const MFA_SETUP_PATH = '/account/security?setup=required';

/**
 * Returns the signed-in user with their roles, or redirects to sign-in. The
 * MFA rules it applies are in `src/lib/authz/mfa/`:
 *
 * - Users who must confirm their session (`mustStepUp`: anyone with MFA on
 *   their account who signed in without a second factor that counts, and
 *   Admins and Managers whose only second step doesn't count as MFA yet) are
 *   sent to the step-up page first, from every page, the account pages
 *   included.
 * - Users whose role requires MFA but who don't have it (`mustSetUpMfa`) are
 *   sent to the Security page to set it up. Only the account pages (and the
 *   navigation around them) pass `allowMissingMfa`, so that's the one place
 *   they can still go.
 *
 * @param options - Options.
 * @param options.allowMissingMfa - Let users without required MFA set up through (account pages only).
 * @returns The actor.
 */
export async function getActor({
  allowMissingMfa = false,
}: { allowMissingMfa?: boolean } = {}): Promise<Actor> {
  const actor = await getOptionalActor();
  if (!actor) {
    redirect('/auth');
  }
  if (mustStepUp(actor)) {
    const current = (await headers()).get(PATHNAME_HEADER);
    redirect(`/auth/verify?callbackURL=${encodeURIComponent(getSafeRedirectPath(current))}`);
  }
  if (mustSetUpMfa(actor) && !allowMissingMfa) {
    redirect(MFA_SETUP_PATH);
  }
  return actor;
}

/**
 * Loads the user's access to a company once per request: a company page and
 * its layout (which shows the header) ask for the same company, with the
 * same actor object (`getOptionalActor` is cached too).
 */
const loadCompanyAccess = cache((actor: Actor, companyRef: string): Promise<CompanyAccess> =>
  getCompanyAccess(appContext.db, actor, companyRef),
);

/**
 * Loads a company the user may see, or `null` when it doesn't exist or isn't
 * visible to them. For page metadata, which must not end in the 404 page
 * itself (Next then renders the page without a title); pages use
 * {@link requireCompanyAccess}.
 *
 * @param companyId - The company ID or URL name from the URL.
 * @returns The actor, company and permissions, or `null`.
 */
export async function findCompanyAccess(
  companyId: string,
): Promise<(CompanyAccess & { actor: Actor }) | null> {
  const actor = await getActor();
  try {
    return { ...(await loadCompanyAccess(actor, companyId)), actor };
  } catch (error) {
    if (error instanceof ServiceError) {
      return null;
    }
    throw error;
  }
}

/**
 * Loads a company for a page, showing the 404 page when it doesn't exist,
 * isn't visible to the user, or a required permission is missing. A page
 * that requires a permission gives its title the same check with
 * `companyPermissionMetadata` (`src/server/page-metadata.ts`).
 *
 * @param companyId - The company ID or URL name from the URL.
 * @param permission - A permission the page requires, if any.
 * @returns The actor, company and permissions.
 */
export async function requireCompanyAccess(
  companyId: string,
  permission?: Permission,
): Promise<CompanyAccess & { actor: Actor }> {
  const access = await findCompanyAccess(companyId);
  if (!access || (permission && !access.permissions.has(permission))) {
    notFound();
  }
  return access;
}

/**
 * Requires a permission that isn't about one company (e.g. listing all
 * companies), showing the 404 page when it's missing. The page (or layout)
 * gives its title the same check with `globalPermissionMetadata`
 * (`src/server/page-metadata.ts`).
 *
 * @param permission - The permission the page requires.
 * @returns The actor.
 */
export async function requireGlobalPermission(permission: Permission): Promise<Actor> {
  const actor = await getActor();
  if (!getGlobalPermissions(actor).has(permission)) {
    notFound();
  }
  return actor;
}
