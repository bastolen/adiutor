/**
 * @file Facts about a user's sign-in methods (password and connected
 * OAuth provider accounts, e.g. GitHub and Google), and the user's own
 * changes to them that don't reach the guards before Better Auth's requests:
 * confirming a provider account, setting a first password and changing the
 * password.
 */
import { isAPIError } from 'better-auth/api';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

import type { Database } from '@/db';
import { account } from '@/db/schema';
import {
  confirmProviderChange,
  givesMfa,
  needsFreshSignIn,
  needsRecentConfirmation,
  wouldRemoveRequiredMfa,
} from '@/lib/authz/mfa';
import {
  cleanAccountName,
  OAUTH_PROVIDERS,
  type OAuthProvider,
} from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { notFoundError, parseId, ServiceError } from '../errors';
import { checkCurrentPassword } from './current-password';
import { loadMfaContext } from './mfa-state';
import { withSignInChangeLock } from './sign-in-change-lock';

/** Better Auth's error code for a wrong current password (`changePassword`). */
const INVALID_PASSWORD_CODE = 'INVALID_PASSWORD';

/**
 * Refuses a change to how the user signs in that their session may not make
 * yet: with a second step, until it confirmed with it in the last 15 minutes
 * (`needsRecentConfirmation`); without one, until it signed in within the
 * last hour (`needsFreshSignIn`), so an old (stolen) session can't add a way
 * in. The same rules the guards apply to Better Auth's endpoints.
 *
 * @param actor - The signed-in user.
 * @throws {ServiceError} `forbidden` with `errors.signIn.mfaVerificationRequired` (the Security
 *   page's actions send the user to the step-up page for it first) or `errors.signIn.sessionNotFresh`.
 */
function assertMayChangeSignIn(actor: Actor): void {
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('forbidden', 'errors.signIn.mfaVerificationRequired');
  }
  if (needsFreshSignIn(actor)) {
    throw new ServiceError('forbidden', 'errors.signIn.sessionNotFresh');
  }
}

/**
 * Checks whether a user has set a password (users invited with an email link
 * or signing in with a provider may not have one).
 *
 * @param db - Database client.
 * @param userId - The user.
 * @returns Whether they have a password.
 */
export async function hasPassword(db: Database, userId: string): Promise<boolean> {
  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, 'credential'),
        isNotNull(account.password),
      ),
    );
  return Boolean(credential);
}

/** A connected OAuth provider account. */
export interface ConnectedProvider {
  /** The account row's ID (what Better Auth's unlink needs). */
  id: string;
  /** Which provider. */
  provider: OAuthProvider;
  /** When it was connected. */
  connectedAt: Date;
  /**
   * Whether it counts: one connected while signing in with it, to an account
   * that already had a second step, waits for the user to confirm it.
   */
  confirmed: boolean;
  /**
   * Whether it can be a second step: its provider can prove MFA, is
   * configured here, and said the account has two-factor authentication
   * (`givesMfa`).
   */
  givesMfa: boolean;
  /**
   * The account's name at its provider (a GitHub username, a Google email
   * address), so the user can tell which account it is; `null` until it has
   * signed in since names were added.
   */
  accountName: string | null;
}

/**
 * A connected provider account as {@link listConnectedProviders} loads it:
 * what the Security page shows ({@link ConnectedProvider}), plus what the MFA
 * rules need on the server. Give the browser only the
 * {@link ConnectedProvider} part.
 */
export interface ConnectedProviderDetails extends ConnectedProvider {
  /**
   * Whether its provider said it has two-factor authentication, stored at
   * its sign-in (`account.mfaVerified`), whatever the provider: for judging
   * whether it may be confirmed (`mfaDowngradeBlocks`). Use
   * {@link ConnectedProvider.givesMfa} to tell whether it counts.
   */
  mfaVerified: boolean;
}

/**
 * Lists a user's connected provider accounts (not their password).
 *
 * @param ctx - Service context.
 * @param userId - The user.
 * @returns The connected accounts, oldest first.
 */
export async function listConnectedProviders(
  ctx: Pick<ServiceContext, 'db'>,
  userId: string,
): Promise<ConnectedProviderDetails[]> {
  const rows = await ctx.db
    .select({
      id: account.id,
      provider: account.providerId,
      connectedAt: account.createdAt,
      confirmed: account.confirmed,
      mfaVerified: account.mfaVerified,
      accountName: account.accountName,
    })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.providerId, [...OAUTH_PROVIDERS])))
    .orderBy(asc(account.createdAt));
  return rows.map(({ mfaVerified, accountName, ...row }) => ({
    ...row,
    provider: row.provider as OAuthProvider,
    confirmed: row.confirmed !== false,
    // Cleaned again when shown, like when it was stored.
    accountName: cleanAccountName(accountName),
    givesMfa: givesMfa(
      { providerId: row.provider, mfaVerified: mfaVerified === true },
      availableProviders,
    ),
    mfaVerified: mfaVerified === true,
  }));
}

/**
 * Confirms a provider account that was connected while signing in with it,
 * so it counts (as a second step when it gives MFA, see `givesMfa`; see also
 * `beforeAccountCreate`). The audit event records whether it did. Only
 * from a session confirmed with the account's existing second step in the
 * last 15 minutes (see `mfaConfirmedUntil`), when it still has one, and
 * otherwise from a sign-in within the last hour (`needsFreshSignIn`).
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user, confirming their own account.
 * @param accountId - The provider account (unvalidated input is fine).
 * @throws {ServiceError} `forbidden` without a recent confirmation or, without a second step, a
 *   sign-in from the last hour, or when counting it would take
 *   away the MFA the user's role requires (`wouldRemoveRequiredMfa`), `not_found` for anything but
 *   their own unconfirmed provider account, `conflict` while another change to how they sign in is
 *   being made (`withSignInChangeLock`).
 */
export async function confirmConnectedProvider(
  ctx: ServiceContext,
  actor: Actor,
  accountId: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  // Without a second step there's nothing to confirm with, as for adding a first one: a recent
  // sign-in instead.
  assertMayChangeSignIn(actor);
  const id = parseId(accountId);
  const ownUnconfirmed = and(
    eq(account.id, id),
    eq(account.userId, actor.id),
    inArray(account.providerId, [...OAUTH_PROVIDERS]),
    eq(account.confirmed, false),
  );
  // One change to how the user signs in at a time, so the check below sees the latest state.
  await withSignInChangeLock(ctx, actor.id, async () => {
    const [found] = await ctx.db
      .select({ providerId: account.providerId, mfaVerified: account.mfaVerified })
      .from(account)
      .where(ownUnconfirmed);
    if (!found) {
      throw notFoundError();
    }
    // Counting it could take away the MFA the user's role requires (provider MFA only counts when
    // every provider account has it).
    const mfa = await loadMfaContext(ctx.db, actor.id);
    // Judged with its own provider and MFA, as the Security page judges it (`mfaDowngradeBlocks`).
    const change = confirmProviderChange({
      providerId: found.providerId,
      mfaVerified: found.mfaVerified === true,
    });
    if (mfa && wouldRemoveRequiredMfa(mfa.state, mfa.mfaRole, change, availableProviders)) {
      throw new ServiceError('forbidden', 'errors.signIn.mfaRequiredForRole');
    }
    const [updated] = await ctx.db
      .update(account)
      .set({ confirmed: true })
      .where(ownUnconfirmed)
      .returning({ providerId: account.providerId });
    if (!updated) {
      throw notFoundError();
    }
    await recordEvent(ctx, {
      action: 'provider_confirmed',
      actorUserId: actor.id,
      targetUserId: actor.id,
      // Whether it's a second step now, for the user's Recent activity.
      details: { providerId: updated.providerId, givesMfa: givesMfa(change, availableProviders) },
    });
  });
}

/**
 * Gives the signed-in user a first password, made by `setPassword` (the
 * caller's Better Auth call). That endpoint is server-only and has no path,
 * so the checks before Better Auth requests never see it: this applies their
 * rules itself. It needs a recent confirmation with the second step, or
 * without one a sign-in from the last hour (`needsFreshSignIn`), holds the
 * user's lock (`withSignInChangeLock`) and refuses a password that would take
 * away the MFA their role requires (GitHub with 2FA only counts without one,
 * `wouldRemoveRequiredMfa`).
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param setPassword - Sets the password (`auth.api.setPassword`), once allowed.
 * @throws {ServiceError} `forbidden` without a recent confirmation or, without a second step, a
 *   sign-in from the last hour, or when it would take away the
 *   MFA their role requires, `conflict` when they have a password already or while another change
 *   to how they sign in is being made.
 */
export async function setFirstPassword(
  ctx: ServiceContext,
  actor: Actor,
  setPassword: () => Promise<unknown>,
): Promise<void> {
  assertNotSignedInAs(actor);
  // Without a second step there's nothing to confirm with, as for adding a first one: a recent
  // sign-in instead.
  assertMayChangeSignIn(actor);
  await withSignInChangeLock(ctx, actor.id, async () => {
    if (await hasPassword(ctx.db, actor.id)) {
      throw new ServiceError('conflict', 'errors.signIn.passwordAlreadySet');
    }
    const mfa = await loadMfaContext(ctx.db, actor.id);
    if (
      mfa &&
      wouldRemoveRequiredMfa(mfa.state, mfa.mfaRole, { kind: 'set_password' }, availableProviders)
    ) {
      throw new ServiceError('forbidden', 'errors.signIn.mfaRequiredForRole');
    }
    await setPassword();
  });
}

/**
 * Changes the signed-in user's password with `change` (the caller's Better
 * Auth `changePassword` call, which checks the current password itself),
 * under the limit on wrong current passwords per user
 * (`checkCurrentPassword`): Better Auth's own limiter doesn't run for
 * `auth.api` calls, so a session couldn't otherwise be kept from guessing
 * the password. Better Auth's `INVALID_PASSWORD` counts as a wrong password
 * and is recorded; its other errors are passed on as they are. What a
 * change does besides (signing out the other devices, the audit event and
 * the security email) is up to the call and the reactions to it.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user, changing their own password.
 * @param change - Changes the password (`auth.api.changePassword`), once allowed.
 * @throws {ServiceError} `rate_limited` once their wrong passwords used up the limit, `invalid`
 *   for a wrong current password.
 */
export async function changeOwnPassword(
  ctx: ServiceContext,
  actor: Actor,
  change: () => Promise<unknown>,
): Promise<void> {
  assertNotSignedInAs(actor);
  await checkCurrentPassword(ctx, actor, 'change_password', async () => {
    try {
      await change();
      return true;
    } catch (error) {
      if (isAPIError(error) && error.body?.code === INVALID_PASSWORD_CODE) {
        return false;
      }
      throw error;
    }
  });
}
