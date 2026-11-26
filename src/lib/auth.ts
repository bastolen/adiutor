/**
 * @file Better Auth server configuration.
 *
 * Better Auth handles identity only: accounts, sessions and sign-in (password,
 * magic link, GitHub, Google, passkeys) and the second sign-in step
 * (authenticator app, email codes, backup codes). Companies, roles and invitations are the app's
 * own (see `src/server` and `src/lib/authz`).
 *
 * There's no public sign-up. Accounts are created by accepting an
 * invitation or invite link, by staff registering someone (Add user), or for
 * staff's first Admin by first-run setup (`/setup` or `pnpm setup:platform`).
 * Existing users can then also sign in with GitHub or Google (matched on
 * email).
 *
 * This file (and the files it imports) doesn't import `server-only`, because
 * the Better Auth CLI (`pnpm auth:schema`) can't load it then. It can't end up
 * in client code anyway: `pg` and `nodemailer` can't be bundled for the
 * browser. App code reads the signed-in user through `src/server/authz.ts`,
 * which is server-only.
 * @see https://www.better-auth.com/docs
 */
import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { lastLoginMethod, magicLink, twoFactor } from 'better-auth/plugins';
import { after } from 'next/server';

import { db } from '../db';
import * as schema from '../db/schema';
import type { AuthHookContext } from '../server/auth/auth-events';
import { EMAIL_CODE_MINUTES, TWO_FACTOR_LOCK_ATTEMPTS, TWO_FACTOR_LOCK_MINUTES } from './authz/mfa';
import { PLATFORM_ROLES } from './authz/roles';
import { ADIUTOR_NAME } from './branding';
import { sendEmail, sendFailureOf } from './email';
import { appUrl, env } from './env';
import { loadLanguageSettings, localeFromHeaders } from './i18n/default-locale';
import { type Locale, LOCALES, offeredLocale } from './i18n/locales';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './input-rules';
import ipAddressOptions from './request/ip-address-options';
import { ACTIVITY_ORDERS } from './requests';
import { LAST_USED_LOGIN_METHOD_COOKIE } from './sign-in/auth-cookies';
import { DISABLED_AUTH_PATHS } from './sign-in/auth-endpoints';
import { parseAuthSecrets } from './sign-in/auth-secrets';
import { EMAIL_LINK_MINUTES, emailLinkUrl } from './sign-in/email-link';
import emailLinkContinue from './sign-in/email-link-plugin';
import { AVATAR_SOURCES } from './sign-in/pictures';
import { providerCredentials } from './sign-in/providers';
import requestLinkSignIn from './sign-in/request-link-plugin';
import { hashEmailLinkToken } from './sign-in/tokens';

/**
 * How long a session lasts, in seconds: a fixed 7 days (see `session` in
 * {@link auth}).
 */
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/**
 * Loads the auth reactions on first use, so code that only loads this config
 * (like `pnpm auth:schema`) doesn't also load them and everything they import.
 *
 * @returns The `src/server/auth/auth-events/` module.
 */
function loadAuthEvents() {
  return import('../server/auth/auth-events');
}

/**
 * Loads the checks run before Better Auth requests on first use, like
 * {@link loadAuthEvents}.
 *
 * @returns The `src/server/auth/auth-guards/` module.
 */
function loadAuthGuards() {
  return import('../server/auth/auth-guards');
}

/**
 * Runs work after the response when there's a request (Next's `after`), so
 * emails don't make responses slower for existing accounts than for unknown
 * ones; outside a request (scripts), it just runs. Failures are logged.
 *
 * @param task - The work, already started.
 */
function runInBackground(task: Promise<unknown>): void {
  const logged = task.catch((error: unknown) => {
    // eslint-disable-next-line no-console -- Background work has no caller to report to; only the failure's kind is logged, as a mail server's refusal can quote the address.
    console.error(
      'Background auth task failed',
      error instanceof Error ? error.name : null,
      sendFailureOf(error),
    );
  });
  try {
    after(logged);
  } catch {
    // Not in a request: the promise runs on its own.
  }
}

/**
 * The language of an email to a Better Auth user: the one they saved
 * (`user.locale`) while Adiutor offers it, else the request's
 * (`localeFromHeaders`: the language cookie, else Adiutor's default
 * language). See "Which language" in
 * docs/email.md.
 *
 * @param user - The user, with the app's additional fields.
 * @param headers - The request's headers, if known.
 * @returns The locale.
 */
async function emailLocale(user: object, headers: Headers | null | undefined): Promise<Locale> {
  const saved = (user as { locale?: unknown }).locale;
  const { offered } = await loadLanguageSettings(db);
  return offeredLocale(saved, offered) ?? localeFromHeaders(headers, db);
}

/**
 * The headers of the request an email callback runs in: the one Better Auth
 * passes, else the current Next.js request's (a server action calling
 * `auth.api`, which passes none), else none (scripts, tests).
 *
 * @param request - The request Better Auth passed, if any.
 * @returns The headers, or `null` outside a request.
 */
async function callbackHeaders(request: Request | undefined): Promise<Headers | null> {
  if (request) {
    return request.headers;
  }
  try {
    // Loaded here: the Better Auth CLI loads this config outside Next.js.
    const { headers } = await import('next/headers');
    return await headers();
  } catch {
    // Not in a Next.js request.
    return null;
  }
}

/**
 * Whether a Better Auth user is deactivated (they get no sign-in or reset emails).
 *
 * @param user - The user, with the app's additional fields.
 * @returns Whether the account is deactivated.
 */
function isDeactivated(user: object): boolean {
  return Boolean((user as { deactivatedAt?: Date | null }).deactivatedAt);
}

/**
 * Hashes a sign-in link's token for Better Auth's magic-link plugin, which
 * expects a promise.
 *
 * @param token - The token from the link.
 * @returns Its stored form (`hashEmailLinkToken`).
 */
async function storedEmailLinkToken(token: string): Promise<string> {
  return hashEmailLinkToken(token);
}

/**
 * Passwordless sign-in with a link sent by email, for existing users only.
 * Its link (`GET /magic-link/verify`) only goes to the confirmation page; that
 * page's Continue uses it, through {@link emailLinkContinue} (decision 0041).
 */
const emailLinkSignIn = magicLink({
  disableSignUp: true,
  /** How long a link works, in seconds (what the email says). */
  expiresIn: EMAIL_LINK_MINUTES * 60,
  /**
   * Store link tokens as hashes, like the other verification tokens. The
   * app's own hasher (the same as Better Auth's `'hashed'`), so the page
   * the email links to can look a link up without using it
   * (`emailLinkVerificationIdentifier`).
   */
  storeToken: { type: 'custom-hasher', hash: storedEmailLinkToken },
  /**
   * Emails a magic sign-in link, but only to existing, active users:
   * Better Auth would otherwise email any address typed into the form.
   * The lookup and the sending happen after the response, so neither the
   * response nor its timing reveals who has an account. The email links
   * to a confirmation page rather than to Better Auth's link, so a mail
   * scanner opening it doesn't use it up (`src/lib/sign-in/email-link.ts`).
   * It goes to the account's stored address, not the address as typed
   * (the lookup ignores case), so it only ever reaches the inbox the
   * account was set up with.
   *
   * @param data - The address as typed and the sign-in link.
   * @param data.email - The address the link was asked for, as typed.
   * @param data.url - The sign-in link.
   * @param context - The request context, used to look up the user and for the language
   *   of a user who saved none.
   */
  sendMagicLink: async ({ email, url }, context) => {
    // Worked out now, during the request: the background work may run after it.
    const requestLocale = await localeFromHeaders(context?.headers, db);
    /** Looks the user up and sends the link to their stored address. */
    const send = async () => {
      const found = await context?.context.internalAdapter.findUserByEmail(email);
      if (!found || isDeactivated(found.user)) {
        return;
      }
      const saved = (found.user as { locale?: unknown }).locale;
      const { offered } = await loadLanguageSettings(db);
      const { magicLinkEmail } = await import('../emails/magic-link');
      const { loadEmailBrand } = await import('../server/branding');
      await sendEmail(
        await magicLinkEmail(found.user.email, {
          appUrl,
          brand: await loadEmailBrand(db),
          url: emailLinkUrl(url, appUrl),
          locale: offeredLocale(saved, offered) ?? requestLocale,
        }),
      );
    };
    runInBackground(send());
  },
});

/**
 * Refuses passkeys used without user verification (a fingerprint, face or
 * device PIN). The app counts a passkey as two factors, so possession alone
 * isn't enough; Better Auth's own check doesn't require it.
 *
 * @param userVerified - Whether the authenticator verified the user.
 * @throws {APIError} `UNAUTHORIZED` with code `USER_VERIFICATION_REQUIRED`.
 */
function requireUserVerification(userVerified: boolean | undefined): void {
  if (!userVerified) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Use your fingerprint, face or device PIN with this passkey.',
      code: 'USER_VERIFICATION_REQUIRED',
    });
  }
}

/**
 * Hands Better Auth's endpoint context to the reactions as the parts they
 * use. Without a cast: every call passes Better Auth's own context type, so
 * the compiler checks the top-level fields the reactions read (`params`,
 * `setCookie`, ...). Better Auth types `ctx.context` as `any` here, and the
 * fields of `AuthHookContext` are optional, so `hook-contexts.test.ts` in
 * `src/server/auth/` checks the rest against Better Auth's `AuthContext`:
 * the types in `ctx.context`, and that no field was renamed or removed.
 *
 * @param ctx - Better Auth's context, or `null` outside a request.
 * @returns The context for `src/server/auth/auth-events/`.
 */
function toHookContext(ctx: AuthHookContext | null | undefined): AuthHookContext | null {
  return ctx ?? null;
}

/**
 * Records password sign-ins once Better Auth's two-step plugin has decided
 * whether their session stays (see `afterPasswordSignIn`). Plugins react
 * after a request in the order they're listed, and after the app's own
 * `hooks.after`, so this must be listed right after `twoFactor(...)` (and
 * before `nextCookies()`, which stays last): listed before it, it would
 * record a sign-in for a session the plugin then deletes to ask for a code,
 * and mark that session as a trusted device's.
 *
 * @returns The plugin.
 */
function passwordSignInEvents() {
  return {
    id: 'adiutor-password-sign-in',
    hooks: {
      after: [
        {
          /**
           * Only password sign-ins.
           *
           * @param context - The endpoint context.
           * @returns Whether it's `/sign-in/email`.
           */
          matcher: (context) => context.path === '/sign-in/email',
          /** Records the outcome; never fails the sign-in (`afterPasswordSignIn` logs instead). */
          handler: createAuthMiddleware(async (ctx) => {
            const context = toHookContext(ctx);
            if (context) {
              await (await loadAuthEvents()).afterPasswordSignIn(context);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

/**
 * The Better Auth instance. Its HTTP API is served from `/api/auth/*`, and
 * server code can call `auth.api` directly.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  advanced: {
    /** IDs are created by the database (UUIDv7, see `src/db/schema`). */
    database: { generateId: 'uuid' },
    /**
     * Where the client's IP address comes from (`CLIENT_IP_HEADERS`,
     * `TRUSTED_PROXIES`), for rate limits and sessions. The app reads it the
     * same way (`src/lib/request/request-info.ts`).
     */
    ipAddress: ipAddressOptions,
    /**
     * Emails (password resets, codes) are sent after the response, so its
     * timing doesn't reveal whether an address has an account.
     */
    backgroundTasks: { handler: runInBackground },
  },
  /**
   * Better Auth endpoints the browser doesn't use answer 404 over HTTP (server
   * code can still call them); see `src/lib/sign-in/auth-endpoints.ts`.
   */
  disabledPaths: DISABLED_AUTH_PATHS,
  /**
   * Tokens in verification rows (password reset and welcome links, code-step
   * challenges) are stored as SHA-256 hashes, so a database leak doesn't
   * expose usable links. Trusted-device rows stay as they are: their cookie
   * also needs an HMAC with the auth secret, and the app finds them by prefix
   * (`src/server/auth/trusted-devices.ts`).
   */
  verification: {
    storeIdentifier: { default: 'hashed', overrides: { 'trust-device-': 'plain' } },
  },
  /**
   * The label of new authenticator entries and passkeys when the staff's name
   * can't be read; otherwise each such request gets "<staff's name>
   * (Adiutor)" (`signInAppNameFor`, decision 0050).
   */
  appName: ADIUTOR_NAME,
  secret: env.BETTER_AUTH_SECRET,
  /** Versioned secrets for rotation; `secret` then only decrypts older data. */
  secrets: parseAuthSecrets(env.BETTER_AUTH_SECRETS),
  baseURL: env.BETTER_AUTH_URL,
  /**
   * Where Better Auth sends people when signing in fails with nowhere else to
   * go (an OAuth callback without an error address, a failed account link,
   * its own error page): the app's page, which gives them a reference for an
   * admin (`src/app/sign-in-error/page.tsx`).
   */
  onAPIError: { errorURL: `${appUrl}/sign-in-error` },

  /**
   * Rate limits are kept in the database, so they survive restarts and are
   * shared by every instance of the app.
   */
  rateLimit: { storage: 'database' },

  /**
   * Reactions to sign-ins and account changes (audit log, session MFA level,
   * deactivated accounts, provider MFA, last active); see
   * `src/server/auth/auth-events/`, loaded on first use
   * ({@link loadAuthEvents}).
   */
  databaseHooks: {
    user: {
      update: {
        /**
         * Notes an email address verified by signing in with GitHub or Google
         * (see `beforeUserUpdate`).
         *
         * @param data - The changed fields.
         * @param ctx - The endpoint changing them.
         * @returns Nothing; the change goes ahead as it is.
         */
        before: async (data, ctx) => {
          (await loadAuthEvents()).beforeUserUpdate(data, toHookContext(ctx));
        },
        /**
         * Records that email address verification (see `afterUserUpdate`).
         *
         * @param updated - The user after the change.
         * @param ctx - The endpoint that changed it.
         * @returns Nothing.
         */
        after: async (updated, ctx) =>
          (await loadAuthEvents()).afterUserUpdate(updated, toHookContext(ctx)),
      },
    },
    session: {
      create: {
        /**
         * Refuses deactivated accounts, sets the session's MFA level, and
         * keeps the sign-in time and end of a session it replaces.
         *
         * @param data - The session about to be created.
         * @param ctx - The endpoint creating it.
         * @returns The session data to store.
         */
        before: async (data, ctx) =>
          (await loadAuthEvents()).beforeSessionCreate(data, toHookContext(ctx)),
        /**
         * Records the sign-in, except a password sign-in, whose session may
         * still be deleted for the code step (see `passwordSignInEvents`).
         *
         * @param created - The new session.
         * @param ctx - The endpoint that created it.
         * @returns Nothing.
         */
        after: async (created, ctx) =>
          (await loadAuthEvents()).afterSessionCreate(created, toHookContext(ctx)),
      },
    },
    account: {
      create: {
        /**
         * Decides whether a provider connected at sign-in counts right away
         * (see `beforeAccountCreate`).
         *
         * @param data - The account about to be created.
         * @param ctx - The endpoint creating it.
         * @returns The account data to store.
         */
        before: async (data, ctx) =>
          (await loadAuthEvents()).beforeAccountCreate(data, toHookContext(ctx)),
        /**
         * Records a connected provider or a first password.
         *
         * @param created - The new account.
         * @param ctx - The endpoint that created it.
         * @returns Nothing.
         */
        after: async (created, ctx) =>
          (await loadAuthEvents()).afterAccountCreate(created, toHookContext(ctx)),
      },
      update: {
        /**
         * Leaves out the OAuth tokens the app doesn't keep (see
         * `withoutKeptTokens`), and refreshes the account's name at a sign-in.
         *
         * @param data - The changed fields, e.g. new tokens at a sign-in.
         * @param ctx - The endpoint changing it.
         * @returns The fields to store.
         */
        before: async (data, ctx) =>
          (await loadAuthEvents()).beforeAccountUpdate(data, toHookContext(ctx)),
      },
      delete: {
        /**
         * Records a disconnected provider.
         *
         * @param deleted - The removed account.
         * @param ctx - The endpoint that removed it.
         * @returns Nothing.
         */
        after: async (deleted, ctx) =>
          (await loadAuthEvents()).afterAccountDelete(deleted, toHookContext(ctx)),
      },
    },
  },

  hooks: {
    /**
     * Runs before every Better Auth request; see `beforeAuthRequest`. For
     * the endpoints that label a new authenticator entry or passkey, it then
     * sets the label as that request's app name (`signInAppNameFor`,
     * decision 0050), on the request's own context. Never return a context
     * change from here: Better Auth would hand the endpoint a new context
     * object and lose the state the guards keep under this one
     * (`src/server/auth/request-state.ts`).
     */
    before: createAuthMiddleware(async (ctx) => {
      const guards = await loadAuthGuards();
      await guards.beforeAuthRequest(ctx);
      const appName = await guards.signInAppNameFor(ctx);
      if (appName) {
        ctx.context.appName = appName;
      }
    }),
    /** Runs after every Better Auth request; see `afterAuthRequest`. */
    after: createAuthMiddleware(async (ctx) => {
      const context = toHookContext(ctx);
      if (context) {
        await (await loadAuthEvents()).afterAuthRequest(context);
      }
    }),
  },

  user: {
    /**
     * Better Auth refuses the sign-in when this throws or returns an error.
     * It's the one place Better Auth hands over a provider's profile, so it
     * notes the provider account's name and picture there
     * (`noteProviderProfile`) for the account hooks to store; that never refuses anyone, so it's caught.
     * Only the check of the incoming user refuses (`checkIncomingUser`): a
     * sign-in marked as "Confirm with GitHub" on the step-up page whose
     * provider account isn't the user's own confirmed one (`checkReverify`,
     * always checked first), then a deactivated user, before Better Auth
     * connects a provider account, stores its tokens or marks the email
     * address verified. It returns the error, which keeps its code (a throw
     * would turn into `validation_failed`). With this set, Better Auth's own
     * `createUser` needs a request context; the app never calls it (there's
     * no sign-up, and users are inserted directly).
     *
     * @param data - The incoming identity.
     * @param data.user - The Adiutor user Better Auth resolved for it.
     * @param data.source - Where it comes from, with the provider's raw profile for OAuth.
     * @param ctx - The endpoint about to create or update the account.
     * @returns `{ error, errorDescription }` to refuse a re-verify or a deactivated user, otherwise
     *   nothing.
     */
    validateUserInfo: async ({ user, source }, ctx) => {
      try {
        (await loadAuthEvents()).noteProviderProfile(source, toHookContext(ctx));
      } catch {
        // eslint-disable-next-line no-console -- Sign-in goes on; the failure should show up in the logs.
        console.error('Noting the provider profile failed');
      }
      return (await loadAuthEvents()).checkIncomingUser({ user, source }, toHookContext(ctx));
    },
    // Every field here is `input: false`: Better Auth's endpoints never set it; the service named in
    // its comment does.
    additionalFields: {
      /** When the account was deactivated (by the user or an Admin); it can't sign in then. */
      deactivatedAt: { type: 'date', required: false, input: false },
      /** When the user last did something in the app (updated at most once a minute). */
      lastActiveAt: { type: 'date', required: false, input: false },
      /**
       * Their staff role (staff), or empty for company users. Set by
       * setup, staff invitations and the staff settings; never by the user.
       */
      platformRole: { type: [...PLATFORM_ROLES], required: false, input: false },
      /**
       * The language the user chose, for the emails they get (and, once
       * saved, the app's language at sign-in). Empty until they choose one;
       * never set through Better Auth's endpoints.
       */
      locale: { type: [...LOCALES], required: false, input: false },
      /**
       * The zone the user sees times in (an IANA name, `isTimeZone`): their
       * browser's, saved the first time they're signed in
       * (`saveFirstTimeZone`), then what they choose on their account's
       * Profile page (`setOwnTimeZone`). Empty until that first visit. Never
       * set through Better Auth's endpoints.
       */
      timeZone: { type: 'string', required: false, input: false },
      /**
       * When the user dismissed the dashboard's recommendation to add a
       * passkey or two-step verification, so it stays hidden on every device.
       * Empty until then; never set through Better Auth's endpoints
       * (`dismissMfaRecommendation`).
       */
      mfaRecommendationDismissedAt: { type: 'date', required: false, input: false },
      /**
       * Whether staff may sign in as the user ("Sign in as"); on unless the
       * user turned it off on their Security page.
       * (`setStaffSignInAllowed`).
       */
      allowStaffSignIn: { type: 'boolean', required: true, defaultValue: true, input: false },
      /**
       * Which picture the user shows: their initials, or the picture of
       * their account with a provider (`AVATAR_SOURCES`). Empty until they
       * choose, which shows the picture of the account they connected first
       * (`pictureAccount`); set by
       * `setOwnPicture`.
       */
      avatarSource: { type: [...AVATAR_SOURCES], required: false, input: false },
      /**
       * Whether the user gets emails about requests (`readRequestUpdate`); on
       * unless they turned it off on their account's Profile page (`setOwnRequestEmails`).
       */
      requestEmails: { type: 'boolean', required: true, defaultValue: true, input: false },
      /**
       * The order the user reads a request's activity in
       * (`ACTIVITY_ORDERS`); empty for the oldest entry first. Never set
       * through Better Auth's endpoints (`setActivityView`).
       */
      activityOrder: { type: [...ACTIVITY_ORDERS], required: false, input: false },
      /**
       * The groups of a request's activity the user shows (`ACTIVITY_GROUPS`,
       * tidied by `normalizeActivityGroups`); empty for everything. Never set
       * through Better Auth's endpoints (`setActivityView`).
       */
      activityGroups: { type: 'string[]', required: false, input: false },
    },
  },

  session: {
    /**
     * Sessions last a fixed 7 days (in seconds) from the sign-in; then the
     * user signs in again. A session Better Auth replaces for the same
     * sign-in (turning two-step verification on or off, changing the
     * password) keeps its sign-in time and end (`beforeSessionCreate`), so a
     * replacement never renews it. The session cookie lasts 7 days from when
     * it's set, so a replaced session's cookie may outlive its row, which is
     * harmless: the row decides.
     */
    expiresIn: SESSION_LIFETIME_SECONDS,
    /**
     * Sessions aren't extended while they're used. Better Auth would extend
     * one (at most once a day) whenever it's read, but pages read it while
     * Server Components render, and those can't set cookies: the session row
     * would be extended while the browser's cookie still expired 7 days after
     * the sign-in, signing the user out and leaving the row behind as another
     * signed-in device on the Security page. Don't turn this back on without
     * refreshing the cookie somewhere that can set cookies (a Route Handler,
     * a Server Action or the proxy).
     */
    disableSessionRefresh: true,
    /**
     * Better Auth's own "recent sign-in" check is off: a step-up with a code
     * doesn't renew it. `src/server/auth/auth-guards/` asks instead for a
     * confirmation with the second step from the last 15 minutes, or a
     * sign-in from the last hour on accounts without a second step.
     */
    freshAge: 0,
    additionalFields: {
      /** Whether this sign-in, or a later step-up, had a second factor (code, passkey or provider MFA). */
      mfaVerified: { type: 'boolean', required: true, defaultValue: false, input: false },
      /**
       * Which second factor that was (`MfaMethod` in `src/lib/authz/mfa/session.ts`),
       * since not every one counts for every role.
       */
      mfaMethod: { type: 'string', required: false, input: false },
      /**
       * When that second factor was proven (the sign-in or the latest
       * step-up); not set for a trusted device. Changing how the user signs in
       * needs one from the last 15 minutes (`mfaConfirmedUntil`).
       */
      mfaVerifiedAt: { type: 'date', required: false, input: false },
      /**
       * Whether the link in an email about a request started this session
       * (decision 0036): it isn't sent to the step-up page, but opens no
       * window for changing sign-in methods and never counts as a fresh
       * sign-in (`SessionMfa.fromRequestLink`). Set by `beforeSessionCreate`.
       */
      fromRequestLink: { type: 'boolean', required: true, defaultValue: false, input: false },
    },
  },

  /** Email and password sign-in, with password reset by email. */
  emailAndPassword: {
    enabled: true,
    /** No public sign-up: accounts come from invitations, Add user and first-run setup. */
    disableSignUp: true,
    /** New passwords need at least 12 characters (see `passwordSchema`). */
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    /** Sign the user out everywhere after a password reset. */
    revokeSessionsOnPasswordReset: true,
    /**
     * Records a password reset in the audit log.
     *
     * @param data - The user whose password was reset.
     * @param data.user - The user.
     * @param request - The request, for IP and browser.
     * @returns Nothing.
     */
    onPasswordReset: async ({ user }, request) =>
      (await loadAuthEvents()).onPasswordReset(user.id, request?.headers),
    /**
     * Emails a password reset link, except to deactivated accounts (the
     * response is the same either way).
     *
     * @param data - The user and the reset link.
     * @param data.user - The user who asked for the reset.
     * @param data.url - The reset link.
     * @param request - The request, for the language of a user who saved none.
     */
    sendResetPassword: async ({ user, url }, request) => {
      if (isDeactivated(user)) {
        return;
      }
      // Loaded here, not at the top: loading this config (e.g. for `pnpm auth:schema`) shouldn't load React templates.
      const { resetPasswordEmail } = await import('../emails/reset-password');
      const { loadEmailBrand } = await import('../server/branding');
      await sendEmail(
        await resetPasswordEmail(user.email, {
          appUrl,
          brand: await loadEmailBrand(db),
          url,
          locale: await emailLocale(user, await callbackHeaders(request)),
        }),
      );
    },
  },

  /** Connecting and disconnecting GitHub/Google from the account page. */
  account: {
    /**
     * Automatic linking at sign-in is on, and trusts the provider's verified
     * address: a deliberate choice, with the risk and its mitigations in
     * `docs/authentication.md` ("Automatic linking").
     */
    accountLinking: {
      /**
       * A signed-in user may connect a GitHub or Google account with another
       * email address. Automatic linking at sign-in still requires the same
       * address, verified by the provider.
       */
      allowDifferentEmails: true,
      /**
       * Signing in with GitHub or Google also links to an account whose own
       * address isn't verified yet (registered by staff, welcome link not
       * used); Better Auth then marks it verified, since the provider
       * verified it. There's no public sign-up, so nobody else can have set
       * up that account in advance. A link to an account with a second step
       * still needs confirming (`beforeAccountCreate`).
       */
      requireLocalEmailVerified: false,
      /**
       * Disconnecting the only provider is fine: an email link always remains
       * as a way to sign in.
       */
      allowUnlinkingAll: true,
    },
    /**
     * A sign-in with a connected account updates it (its tokens for the
     * request, and its name, see `beforeAccountUpdate`). Better Auth's
     * default, set here because the account names depend on it.
     */
    updateAccountOnSignIn: true,
    additionalFields: {
      /**
       * Whether the provider account itself is protected with MFA, as its provider said at its last
       * sign-in (only providers that can prove MFA, `MFA_PROVIDERS`; always false for others).
       */
      mfaVerified: { type: 'boolean', required: true, defaultValue: false, input: false },
      /**
       * Whether the user confirmed this provider account. One connected while
       * signing in with it, to an account that already had a second step,
       * isn't confirmed until the user confirms it on the Security page with
       * that second step; until then it can sign in, but doesn't count as
       * MFA or for confirming sessions (see `beforeAccountCreate`).
       */
      confirmed: { type: 'boolean', required: true, defaultValue: true, input: false },
      /**
       * The account's name at its provider, the way its owner knows it (a
       * GitHub username, a Google email address; `PROVIDER_ACCOUNT_NAME_CLAIMS`),
       * as of its last sign-in or connection. Only for showing which account
       * is linked: accounts are matched by `accountId`. Empty for accounts
       * that haven't signed in since names were added.
       */
      accountName: { type: 'string', required: false, input: false },
      /**
       * The address of the account's picture at its provider
       * (`PROVIDER_IMAGE_CLAIMS`), as of its last sign-in or connection,
       * kept only on the provider's own picture hosts. Adiutor fetches it
       * and serves it from its own address (`/avatars/<account>`); the
       * address never reaches a browser. Empty for accounts that haven't
       * signed in since pictures were added.
       */
      accountImage: { type: 'string', required: false, input: false },
    },
  },

  /**
   * Email verification, only when the user asks for it on the account page.
   * (Signing in with GitHub or Google whose verified address matches also
   * verifies it.) Verifying only marks the address as verified; it doesn't
   * sign anyone in.
   */
  emailVerification: {
    sendOnSignUp: false,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    /**
     * Emails a link that verifies the user's address.
     *
     * @param data - The user and the verification link.
     * @param data.user - The user to verify.
     * @param data.url - The verification link.
     * @param request - The request, for the language of a user who saved none.
     */
    sendVerificationEmail: async ({ user, url }, request) => {
      const { verifyEmailEmail } = await import('../emails/verify-email');
      const { loadEmailBrand } = await import('../server/branding');
      await sendEmail(
        await verifyEmailEmail(user.email, {
          appUrl,
          brand: await loadEmailBrand(db),
          url,
          locale: await emailLocale(user, await callbackHeaders(request)),
        }),
      );
    },
    /**
     * Records a verified email address in the audit log.
     *
     * @param user - The user whose address was verified.
     * @param request - The request, for IP and browser.
     * @returns Nothing.
     */
    afterEmailVerification: async (user, request) =>
      (await loadAuthEvents()).onEmailVerified(user.id, request?.headers),
  },

  /**
   * GitHub and Google sign-in, enabled when their credentials are set. New
   * users can't sign up this way; an existing user is matched by their
   * (provider-verified) email and the provider is linked to their account.
   */
  socialProviders: {
    ...(providerCredentials.github && {
      github: {
        ...providerCredentials.github,
        disableSignUp: true,
        /** Only the redirect flow is used; no signing in with a token from the browser. */
        disableIdTokenSignIn: true,
      },
    }),
    ...(providerCredentials.google && {
      google: {
        ...providerCredentials.google,
        disableSignUp: true,
        /** Only the redirect flow is used; no signing in with a token from the browser. */
        disableIdTokenSignIn: true,
      },
    }),
  },

  plugins: [
    emailLinkSignIn,
    /**
     * The confirmation page's Continue, which uses a sign-in link with the
     * plugin's own handler (`src/lib/sign-in/email-link-plugin.ts`).
     */
    emailLinkContinue(emailLinkSignIn.endpoints.magicLinkVerify),
    /**
     * The second sign-in step after a password: codes from an authenticator
     * app (with backup codes) or sent by email. Users turn it on from the
     * Security page. Repeated wrong codes at sign-in lock the account for 15
     * minutes; `src/server/auth/auth-guards/` limits codes on the step-up page
     * and decides where email codes are accepted. After a magic link,
     * GitHub/Google or a passkey, users with MFA confirm on the step-up page
     * instead (`getActor`).
     */
    twoFactor({
      // No issuer: authenticator entries take the request's app name, which names the staff
      // (`signInAppNameFor`).
      /** Users without a password (e.g. magic link only) can turn it on too. */
      allowPasswordless: true,
      /**
       * Wrong codes in a row at sign-in that pause signing in with a code, and
       * for how long (Better Auth's defaults, set here so the lockout email and
       * how often it's sent can rely on them: `notifyTwoFactorLocked` in
       * `src/server/auth/auth-events/`).
       */
      accountLockout: {
        maxFailedAttempts: TWO_FACTOR_LOCK_ATTEMPTS,
        durationSeconds: TWO_FACTOR_LOCK_MINUTES * 60,
      },
      otpOptions: {
        /** How long a code works, in minutes (what the pages and the email say). */
        period: EMAIL_CODE_MINUTES,
        /** Store emailed codes as hashes. */
        storeOTP: 'hashed',
        /**
         * Emails a one-time code.
         *
         * @param data - The user and the code.
         * @param data.user - Who gets the code.
         * @param data.otp - The code.
         * @param context - The request context, for the language of a user who saved none.
         */
        sendOTP: async ({ user, otp }, context) => {
          const { twoFactorCodeEmail } = await import('../emails/two-factor-code');
          const { loadEmailBrand } = await import('../server/branding');
          await sendEmail(
            await twoFactorCodeEmail(user.email, {
              appUrl,
              brand: await loadEmailBrand(db),
              code: otp,
              locale: await emailLocale(user, context?.headers),
            }),
          );
        },
      },
    }),
    /**
     * Records password sign-ins after `twoFactor` decided on their session.
     * Must stay right after `twoFactor(...)` (see `passwordSignInEvents`).
     */
    passwordSignInEvents(),
    /**
     * Passkeys as their own sign-in. They require user verification (a
     * fingerprint, face or device PIN), enforced on the server, so a passkey
     * sign-in already has two factors and skips the code step.
     */
    passkey({
      rpID: new URL(env.BETTER_AUTH_URL).hostname,
      // No rpName: a passkey takes the request's app name, which names the staff
      // (`signInAppNameFor`). The rpID (the host) is what binds a passkey, and never changes.
      origin: appUrl,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      registration: {
        /**
         * Refuses passkeys registered without user verification.
         *
         * @param args - The verified registration.
         * @param args.verification - SimpleWebAuthn's result.
         */
        afterVerification: ({ verification }) => {
          requireUserVerification(verification.registrationInfo?.userVerified);
        },
      },
      authentication: {
        /**
         * Refuses passkey sign-ins without user verification.
         *
         * @param args - The verified authentication.
         * @param args.verification - SimpleWebAuthn's result.
         */
        afterVerification: ({ verification }) => {
          requireUserVerification(verification.authenticationInfo.userVerified);
        },
      },
    }),
    /**
     * The link in an email about a request, which signs its recipient in
     * (decision 0036, `src/lib/sign-in/request-link-plugin.ts`).
     */
    requestLinkSignIn(),
    /**
     * Remembers the last sign-in method in a (non-secret) cookie, so the
     * sign-in page can mark it "Last used". A password sign-in finished with
     * the code step counts as a password sign-in.
     */
    lastLoginMethod({
      /** The cookie's name, which sign-out leaves alone (`cookiesToClearAtSignOut`). */
      cookieName: LAST_USED_LOGIN_METHOD_COOKIE,
      /**
       * Names the method for endpoints the plugin doesn't know.
       *
       * @param ctx - The endpoint context.
       * @returns The method, or `null` to use the plugin's default.
       */
      customResolveMethod: (ctx) => (ctx.path?.startsWith('/two-factor/verify') ? 'email' : null),
    }),
    /** Lets Server Actions set auth cookies. Must be the last plugin. */
    nextCookies(),
  ],
});
