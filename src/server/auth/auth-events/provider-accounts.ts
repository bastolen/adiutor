/**
 * @file The hooks for provider accounts (GitHub, Google): no OAuth tokens kept,
 * their account names and pictures, whether a new one is confirmed, their provider MFA
 * kept up to date, and the audit events and notices when one is connected
 * or disconnected.
 */
import { and, desc, eq, isNotNull, ne, or } from 'drizzle-orm';

import { db } from '@/db';
import { account, passkey } from '@/db/schema';
import {
  canConfirmSessions,
  isMfaConfirmedRecently,
  mfaConfirmedUntil,
  wouldRemoveRequiredMfa,
} from '@/lib/authz/mfa';
import {
  accountNameFromProfile,
  imageFromProfile,
  isMfaProvider,
  isOAuthProvider,
  type MfaProvider,
  PROVIDER_LABELS,
  PROVIDER_LINKED_COOKIE,
  providerLinkedCookieValue,
  type ProviderStepUpOutcome,
} from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';

import { holdSignInChangeLock } from '../auth-guards';
import { loadMfaContext } from '../mfa-state';
import { PROVIDER_MFA_CHECKS } from '../provider-mfa';
import { requestState, takeRequestState } from '../request-state';
import { setNextPageCookie } from './cookies';
import { type AuthHookContext, safely, audit, auditAndNotify, notify } from './hook-context';
import { ownSession } from './session-records';

/**
 * Leaves out the OAuth tokens the app doesn't keep, from an account Better
 * Auth is about to store: refresh and ID tokens, and the access tokens of
 * providers that can't prove MFA. A provider that can (GitHub) keeps its
 * access token for the MFA check during the request
 * ({@link refreshProviderMfa}; {@link forgetProviderTokens} clears it after).
 * Nothing in the app calls a provider's API later, so a leaked database
 * holds no tokens for the users' provider accounts.
 *
 * @param data - The account fields about to be stored.
 * @returns The fields without those tokens (unchanged without any tokens).
 */
export function withoutKeptTokens<T extends object>(data: T): T {
  if (!('accessToken' in data || 'refreshToken' in data || 'idToken' in data)) {
    return data;
  }
  return {
    ...data,
    refreshToken: null,
    idToken: null,
    ...(!('providerId' in data && isMfaProvider(data.providerId)) && { accessToken: null }),
  };
}

/**
 * Notes the name and the picture of the provider account a sign-in or
 * connection is about (a GitHub username, a Google email address:
 * `accountNameFromProfile`; the picture's address on the provider's own
 * hosts: `imageFromProfile`), for the account hooks of the same request to
 * store. Called from Better Auth's `user.validateUserInfo`, the one place it
 * hands over the provider's profile, which runs before every account it
 * creates or updates with a provider. It must never refuse anyone, so this
 * never throws, and it logs nothing about the profile.
 *
 * @param source - Where the incoming identity comes from.
 * @param source.method - How (`oauth` for a provider).
 * @param source.oauth - The provider and its raw profile, for `oauth`.
 * @param source.oauth.providerId - The provider's ID.
 * @param source.oauth.profile - Its raw profile (user info or ID token claims), unchecked.
 * @param ctx - The endpoint context.
 */
export function noteProviderProfile(
  source: { method: string; oauth?: { providerId: string; profile?: unknown } },
  ctx: AuthHookContext | null,
): void {
  try {
    const providerId = source.oauth?.providerId;
    if (source.method !== 'oauth' || !ctx?.context || !isOAuthProvider(providerId)) {
      return;
    }
    const name = accountNameFromProfile(providerId, source.oauth?.profile);
    const image = imageFromProfile(providerId, source.oauth?.profile);
    const state = requestState(ctx.context);
    if (name || image) {
      state.providerProfile = { providerId, name, image };
    } else {
      delete state.providerProfile;
    }
  } catch {
    // eslint-disable-next-line no-console -- Never the profile: only that it failed.
    console.error('Reading the provider profile failed');
  }
}

/** The account fields {@link withProfile} adds. */
interface ProfileFields {
  accountName?: string;
  accountImage?: string;
}

/**
 * Adds the name and picture noted for this request
 * ({@link noteProviderProfile}) to a provider account about to be stored,
 * when it's for the same provider. A stored name or picture is never
 * removed: without a noted one, it stays as it is.
 *
 * @param data - The account fields about to be stored.
 * @param ctx - The endpoint storing them.
 * @returns The fields, with `accountName` and `accountImage` when they were noted.
 */
function withProfile<T extends object>(data: T, ctx: AuthHookContext | null): T & ProfileFields {
  const context = ctx?.context;
  const noted = context ? requestState(context).providerProfile : undefined;
  if (!context || !noted || !('providerId' in data) || data.providerId !== noted.providerId) {
    return data;
  }
  takeRequestState(context, 'providerProfile');
  return {
    ...data,
    ...(noted.name && { accountName: noted.name }),
    ...(noted.image && { accountImage: noted.image }),
  };
}

/**
 * Before Better Auth changes an account (e.g. new tokens at a sign-in): see
 * {@link withoutKeptTokens}. A sign-in also refreshes the account's name
 * and picture, which may have changed at the provider ({@link withProfile}).
 *
 * @param data - The changed fields.
 * @param ctx - The endpoint changing them.
 * @returns The fields to store.
 */
export function beforeAccountUpdate<T extends object>(
  data: T,
  ctx: AuthHookContext | null = null,
): { data: T & ProfileFields } {
  return { data: withProfile(withoutKeptTokens(data), ctx) };
}

/**
 * Clears the OAuth tokens a request stored for a user, once it's done with
 * them (the provider's MFA check), after every provider callback whose user is
 * known: from the session it created, or the signed session cookie when
 * connecting from the Security page. The `leftover-provider-tokens` job
 * (`src/server/jobs`) clears any left by a callback without one (e.g. a
 * refused sign-in).
 *
 * @param userId - The user.
 */
export async function forgetProviderTokens(userId: string): Promise<void> {
  await db
    .update(account)
    .set({ accessToken: null, refreshToken: null, idToken: null })
    .where(
      and(
        eq(account.userId, userId),
        or(
          isNotNull(account.accessToken),
          isNotNull(account.refreshToken),
          isNotNull(account.idToken),
        ),
      ),
    );
}

/** What {@link refreshProviderMfa} found out about a provider account. */
interface ProviderMfaCheck {
  /**
   * Whether the account has two-factor authentication on: the provider's
   * answer, or `null` without a definite one.
   */
  enabled: boolean | null;
  /** Whether the user confirmed the account as a second step (`account.confirmed`). */
  confirmed: boolean;
}

/**
 * Asks a provider that can prove MFA whether a connected account of it has
 * two-factor authentication (`PROVIDER_MFA_CHECKS`), and stores the answer on
 * it. Without a definite answer (the provider unreachable, rate limited, or
 * the response doesn't say), the stored value stays as it was, so an outage
 * can't take away an account's MFA, but this sign-in doesn't count as
 * confirmed with it; the result then says `enabled: null`, so the step-up
 * page can tell "couldn't check" from "2FA off". Without `accountId`, that's
 * the account whose token this request stored (Better Auth stores a fresh one
 * at every sign-in, and it's cleared after each request), so a sign-in is
 * checked against the account that signed in, not another one the user
 * connected.
 *
 * @param provider - The provider.
 * @param userId - The user.
 * @param accountId - The account row, when it's known.
 * @returns Whether that account has 2FA on (`null` without a definite answer)
 *   and whether the user confirmed it, or `null` when no account of the
 *   provider holds a token to ask with (nothing was checked).
 */
export async function refreshProviderMfa(
  provider: MfaProvider,
  userId: string,
  accountId?: string,
): Promise<ProviderMfaCheck | null> {
  const [found] = await db
    .select({ id: account.id, accessToken: account.accessToken, confirmed: account.confirmed })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, provider),
        isNotNull(account.accessToken),
        accountId ? eq(account.id, accountId) : undefined,
      ),
    )
    .orderBy(desc(account.updatedAt))
    .limit(1);
  if (!found?.accessToken) {
    return null;
  }
  const confirmed = found.confirmed !== false;
  let enabled: boolean | null = null;
  try {
    enabled = await PROVIDER_MFA_CHECKS[provider](found.accessToken);
  } catch (error) {
    // eslint-disable-next-line no-console -- The stored value is kept; the failure should show up in the logs.
    console.error(`Checking ${PROVIDER_LABELS[provider]} two-factor authentication failed`, error);
  }
  if (enabled === null) {
    return { enabled: null, confirmed };
  }
  await db.update(account).set({ mfaVerified: enabled }).where(eq(account.id, found.id));
  return { enabled, confirmed };
}

/**
 * Says why a provider's check didn't confirm a session, for the step-up
 * page's notice (`PROVIDER_STEP_UP_COOKIE`). A step-up's account is always
 * the user's own confirmed one: any other is refused before
 * ({@link checkReverify}).
 *
 * @param checked - The check's result ({@link refreshProviderMfa}), `null`
 *   when there was nothing to check.
 * @returns `mfa-off` when the provider said 2FA is off, otherwise
 *   `unchecked` (no definite answer).
 */
export function stepUpOutcomeOf(checked: ProviderMfaCheck | null): ProviderStepUpOutcome {
  return checked?.enabled === false ? 'mfa-off' : 'unchecked';
}

/**
 * Decides whether a provider account about to be connected counts right
 * away; see `beforeAccountCreate`.
 *
 * @param data - The account about to be created.
 * @param data.userId - Its user.
 * @param data.providerId - `github` or `google`.
 * @param ctx - The endpoint creating it.
 * @returns The account data with `confirmed`, when it was decided.
 */
async function withConfirmation<T extends { userId: string; providerId: string }>(
  data: T,
  ctx: AuthHookContext | null,
): Promise<T & { confirmed?: boolean }> {
  const current = await ownSession(ctx, data.userId);
  // From a signed-in session it may count right away, so that's decided under the user's lock
  // (`holdSignInChangeLock`): a change to how they sign in at the same moment can't pass its check
  // on what's out of date by then. While another change holds it, it waits for confirmation.
  if (current && ctx && !(await holdSignInChangeLock(ctx, data.userId))) {
    return { ...data, confirmed: false };
  }
  const mfa = await loadMfaContext(db, data.userId);
  const hadSecondStep =
    mfa !== null && canConfirmSessions(mfa.state, mfa.mfaRole, availableProviders);
  if (!hadSecondStep) {
    return data;
  }
  const confirmedRecently =
    current !== null &&
    isMfaConfirmedRecently(
      mfaConfirmedUntil(
        { ...current, mfaVerified: current.mfaVerified ?? false },
        mfa.mfaRole,
        mfa.state,
      ),
    );
  // Nor when counting it would take away the MFA the user's role requires (`wouldRemoveRequiredMfa`).
  const keepsMfa = !wouldRemoveRequiredMfa(
    mfa.state,
    mfa.mfaRole,
    { kind: 'connect_provider', providerId: data.providerId },
    availableProviders,
  );
  return { ...data, confirmed: confirmedRecently && keepsMfa };
}

/**
 * Before a GitHub or Google account is connected: decides whether it counts
 * right away. Better Auth connects one at sign-in when its verified email
 * matches an account, and whoever controls that inbox can create a GitHub or
 * Google account for the address. So when the account already has a second
 * step, a provider connected outside a session confirmed with that step in
 * the last 15 minutes (a fresh sign-in, an unconfirmed session, one
 * confirmed longer ago, or one confirmed with GitHub on an account with a
 * passkey or authenticator app, see `mfaConfirmedUntil`) is stored as not confirmed: it can
 * sign in, but doesn't count as MFA or for confirming sessions until the user
 * confirms it on the Security page. Without a second step yet, it counts
 * right away, like a first passkey. The OAuth tokens the app doesn't keep
 * are left out ({@link withoutKeptTokens}), and the account's name at the
 * provider is added ({@link withProfile}).
 *
 * @param data - The account about to be created.
 * @param data.userId - Its user.
 * @param data.providerId - `credential`, `github` or `google`.
 * @param ctx - The endpoint creating it.
 * @returns The account data to store.
 */
export async function beforeAccountCreate<T extends { userId: string; providerId: string }>(
  data: T,
  ctx: AuthHookContext | null,
): Promise<{ data: T & { confirmed?: boolean } }> {
  if (data.providerId === 'credential') {
    return { data };
  }
  return { data: await withConfirmation(withProfile(withoutKeptTokens(data), ctx), ctx) };
}

/**
 * Checks whether a user can sign in another way than with a password: a
 * connected provider or a passkey.
 *
 * @param userId - The user.
 * @returns Whether they have another sign-in method.
 */
async function hasOtherSignInMethod(userId: string): Promise<boolean> {
  const [[provider], [key]] = await Promise.all([
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), ne(account.providerId, 'credential')))
      .limit(1),
    db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).limit(1),
  ]);
  return Boolean(provider || key);
}

/**
 * After a provider account is created (GitHub or Google connected, or a
 * password set for the first time). A provider connected while signing in
 * with it is recorded as such, and the next page says so (see
 * `ProviderLinkedNotice`). A re-verify never connects one: it's refused
 * before ({@link checkReverify}).
 *
 * @param created - The new account.
 * @param created.id - Its row ID.
 * @param created.userId - Its user.
 * @param created.providerId - `credential`, `github` or `google`.
 * @param created.confirmed - Whether it counts yet (see {@link beforeAccountCreate}).
 * @param created.accountName - Its name at the provider, if known (see {@link withProfile}).
 * @param ctx - The endpoint that created it.
 */
export async function afterAccountCreate(
  created: {
    id?: string;
    userId: string;
    providerId: string;
    confirmed?: boolean | null;
    accountName?: string | null;
  },
  ctx: AuthHookContext | null,
): Promise<void> {
  await safely('record account', async () => {
    if (created.providerId === 'credential') {
      const eventId = await audit(ctx, 'password_changed', created.userId, { first: true });
      // The welcome link of a registered account (a reset link on an account with no other way
      // in) needs no email: they just did this from their inbox. Any other first password does,
      // e.g. through a reset on an account that also signs in with a passkey or GitHub. (A reset
      // that would end provider MFA is refused before: `RESET_ENDS_PROVIDER_MFA` in the guards.)
      if (ctx?.path !== '/reset-password' || (await hasOtherSignInMethod(created.userId))) {
        await notify(eventId, created.userId, 'password_added');
      }
      return;
    }
    // Connected while signing in with it (Better Auth matched the email), not from the Security
    // page, where the user is already signed in.
    const atSignIn =
      ctx?.path?.startsWith('/callback/') === true &&
      (await ownSession(ctx, created.userId)) === null;
    await auditAndNotify(ctx, 'provider_connected', created.userId, {
      details: {
        providerId: created.providerId,
        ...(atSignIn && { atSignIn: true, confirmed: created.confirmed !== false }),
      },
      providerId: created.providerId,
    });
    if (isMfaProvider(created.providerId)) {
      await refreshProviderMfa(created.providerId, created.userId, created.id);
    }
    if (atSignIn && isOAuthProvider(created.providerId)) {
      // The next page says so, naming the account (see `ProviderLinkedNotice`); the security email
      // says it too.
      const value = providerLinkedCookieValue(created.providerId, created.accountName);
      if (ctx) {
        requestState(ctx.context).providerLinkedCookieSet = true;
        setNextPageCookie(ctx, PROVIDER_LINKED_COOKIE, value);
      }
    }
  });
}

/**
 * After a provider account is removed. Only disconnecting GitHub or Google
 * on the Security page (`/unlink-account`) is recorded here; Better Auth also
 * removes accounts in other ways (e.g. when an account is deleted).
 *
 * @param deleted - The removed account.
 * @param deleted.userId - Its user.
 * @param deleted.providerId - `github` or `google` (or `credential`).
 * @param ctx - The endpoint that removed it.
 */
export async function afterAccountDelete(
  deleted: { userId: string; providerId: string },
  ctx: AuthHookContext | null,
): Promise<void> {
  if (ctx?.path !== '/unlink-account') {
    return;
  }
  await safely('record disconnected provider', async () => {
    await auditAndNotify(ctx, 'provider_disconnected', deleted.userId, {
      details: { providerId: deleted.providerId },
      providerId: deleted.providerId,
    });
  });
}
