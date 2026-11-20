/**
 * @file The state one Better Auth request carries from one of the app's
 * hooks to the next: the guards before the endpoint (`auth-guards/`), the
 * database hooks and the reactions after it (`auth-events/`). Better Auth
 * gives each hook its own `ctx`, but every hook of a request shares
 * `ctx.context`, so the state is kept by that object, and it's gone with the
 * request. Each field says which hook writes it, which reads it, and when
 * it's cleared, so it's visible what a hook may rely on.
 */
import type { MfaProvider, OAuthProvider } from '@/lib/sign-in/oauth-providers';

import type { SignInChangeLock } from './sign-in-change-lock';

/** A session as passed to Better Auth's session hooks. */
export interface SessionData {
  /** Session ID (after creation). */
  id?: string;
  /** The user it belongs to. */
  userId: string;
  /** IP address it was created from. */
  ipAddress?: string | null;
  /** Browser it was created from. */
  userAgent?: string | null;
}

/**
 * A provider callback's session that may be a step-up, until
 * `afterAuthRequest` knows whether the provider confirmed it.
 */
export interface PendingProviderStepUp {
  /** The new session. */
  created: SessionData;
  /** The callback's path, e.g. `/callback/:id`. */
  path: string;
  /** The provider (one that can prove MFA). */
  providerId: MfaProvider;
}

/** What one request carries between its hooks. */
export interface AuthRequestState {
  /**
   * The provider account's name and picture noted from the provider's
   * profile (`noteProviderProfile`, from `user.validateUserInfo`), until an
   * account hook of the request stores them (`withProfile`, which takes
   * them). Either is `null` when the profile had no usable one.
   */
  providerProfile?: { providerId: OAuthProvider; name: string | null; image: string | null };
  /**
   * A re-verify refused for another account than the user's own
   * (`checkReverify`, or the backstop in `beforeSessionCreate`): who started
   * it and with which provider. `afterAuthRequest` takes it and records it once.
   */
  refusedReverify?: { userId: string; providerId: string | null };
  /**
   * The session a re-verify's callback created with a provider that can
   * prove MFA (`beforeSessionCreate`), until `recordProviderSession` takes it
   * once `afterAuthRequest` asked the provider. `clearStaleProviderStepUpCookie`
   * reads it to keep the notice this request is about to set.
   */
  pendingProviderStepUp?: PendingProviderStepUp;
  /**
   * Set when this request set the provider-linked cookie after connecting an
   * account at sign-in (`afterAccountCreate`), so the session it creates
   * doesn't clear the cookie again (`clearStaleProviderLinkedCookie` reads it).
   */
  providerLinkedCookieSet?: boolean;
  /**
   * Set by the guards when this request's code finishes setting up an
   * authenticator app next to email codes (Better Auth treats it like a
   * step-up); `afterAuthRequest` reads it (`finishesAuthenticatorSetup`) to
   * record a new method instead of a step-up.
   */
  finishingAuthenticatorSetup?: boolean;
  /**
   * The wrong-password attempt a password sign-in took before its password
   * was checked (the guards), until `settlePasswordAttempt` takes it after
   * the request.
   */
  reservedPasswordAttempt?: { email: string; hits: number };
  /**
   * The user a step-up code check took a wrong-code attempt for before the
   * code was checked (the guards), until `settleStepUpAttempt` takes it.
   */
  reservedStepUpAttempt?: string;
  /**
   * The user of a password sign-in whose code step checks a code (no session
   * yet), found by the guards from Better Auth's two-factor cookie; read
   * after the request (`pendingCodeSignInOf`) to record a wrong code for them.
   */
  pendingCodeSignIn?: string;
  /**
   * The challenge an emailed code checked with a session belongs to
   * (`sessionCodeChallenge`): set by the signed-in checks (`auth-guards/`)
   * for `/two-factor/verify-otp`, read after the request
   * (`afterAuthRequest`) to end that session's wait for a new code once the
   * code was used.
   */
  emailCodeChallenge?: string;
  /**
   * The sign-in change lock the guards (or the OAuth callback,
   * `holdSignInChangeLock`) took for this request, until
   * `releaseSignInChangeLockOf` takes it and gives it back after the request.
   */
  heldSignInChangeLock?: SignInChangeLock;
}

/** Each request's state, by its `ctx.context`. */
const states = new WeakMap<object, AuthRequestState>();

/**
 * The state of a request, created when it has none yet.
 *
 * @param context - The request's `ctx.context`, which all its hooks share.
 * @returns The state, to read or write.
 */
export function requestState(context: object): AuthRequestState {
  let state = states.get(context);
  if (!state) {
    state = {};
    states.set(context, state);
  }
  return state;
}

/**
 * Reads a value that's used once and removes it, so a later hook of the same
 * request doesn't act on it again.
 *
 * @param context - The request's `ctx.context`.
 * @param key - The field.
 * @returns Its value, if it was set.
 */
export function takeRequestState<K extends keyof AuthRequestState>(
  context: object,
  key: K,
): AuthRequestState[K] {
  const state = states.get(context);
  const value = state?.[key];
  if (state) {
    delete state[key];
  }
  return value;
}

/**
 * What a database hook passes on to its partner hook of the same change
 * (before and after one user update). Kept by the hooks' own `ctx`, which
 * both receive, rather than the request's `ctx.context`: another update in
 * the same request mustn't see it.
 */
export interface DatabaseHookState {
  /**
   * Set before a user update when a GitHub or Google sign-in marks the email
   * address verified, for the update's after hook (`afterUserUpdate`).
   */
  verifyingEmailAtProviderSignIn?: boolean;
}

/** Each database change's state, by its hooks' `ctx`. */
const databaseHookStates = new WeakMap<object, DatabaseHookState>();

/**
 * The state shared by the before and after hooks of one database change,
 * created when it has none yet.
 *
 * @param ctx - The `ctx` the database hooks receive.
 * @returns The state, to read or write.
 */
export function databaseHookState(ctx: object): DatabaseHookState {
  let state = databaseHookStates.get(ctx);
  if (!state) {
    state = {};
    databaseHookStates.set(ctx, state);
  }
  return state;
}
