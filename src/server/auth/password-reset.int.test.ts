/**
 * @file Runs Better Auth's real password reset (`auth.handler`, with the
 * app's guards and reactions) to check what only a whole request shows:
 * - a reset link can't give an account its first password when that would
 *   end its MFA (a provider account with two-factor authentication, which
 *   only counts without a password), whatever the role: the request is
 *   refused with `RESET_ENDS_PROVIDER_MFA` before Better Auth sets anything,
 *   so whoever reads the inbox can't get past GitHub's second step with a
 *   password of their own (`checkPasswordReset` in
 *   `src/server/auth/auth-guards/`);
 * - a reset still goes ahead for an account that keeps its MFA (a passkey
 *   next to GitHub), and the welcome link of a new account still sets its
 *   first password;
 * - a link that isn't valid gets Better Auth's own answer, as before;
 * - a reset takes the user's sign-in change lock, like the other sign-in
 *   changes, and gives it back afterwards;
 * - the reset email is in the account's language, else the browser's.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { account, verification } from '@/db/schema';
import { auth } from '@/lib/auth';
import { defined } from '@/lib/defined';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { generateToken, hashVerificationIdentifier } from '@/lib/sign-in/tokens';

import {
  addMember,
  addPasskey,
  connectGitHub,
  createCompany,
  createStaffSettings,
  createUser,
  emailLanguage,
  setUserLocale,
  setupTestContext,
  staffActor,
} from '../../../tests/integration/helpers';
import { registerUser } from '../people/user-registration';
import { releaseSignInChangeLock, takeSignInChangeLock } from './sign-in-change-lock';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

const { ctx, db, sent } = setupTestContext();

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

/** The password the reset link is used to set. */
const NEW_PASSWORD = 'adiutor-tests-new-password';

/**
 * Stores a password reset link the way Better Auth does (hashed, like
 * `registerUser` stores a welcome link), without sending an email.
 *
 * @param userId - The user it's for.
 * @param expiresAt - When it expires; in an hour by default.
 * @returns The link's token.
 */
async function storeResetLink(
  userId: string,
  expiresAt = new Date(Date.now() + 60 * 60_000),
): Promise<string> {
  const token = generateToken();
  await db.insert(verification).values({
    identifier: hashVerificationIdentifier(`reset-password:${token}`),
    value: userId,
    expiresAt,
  });
  return token;
}

/**
 * Sends a request to a Better Auth endpoint, as the app's pages do.
 *
 * @param path - The endpoint, e.g. `reset-password`.
 * @param body - The JSON body.
 * @param headers - More request headers, e.g. the language cookie.
 * @returns The response.
 */
function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.BETTER_AUTH_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Sets a password with a reset link's token, as the reset page does.
 *
 * @param token - The link's token.
 * @returns The response.
 */
function resetPassword(token: string): Promise<Response> {
  return post('reset-password', { token, newPassword: NEW_PASSWORD });
}

/**
 * Asks for a password reset link, as the "Forgot password" page does, and
 * reads its token from the email, which is sent after the response.
 *
 * @param email - The address.
 * @returns The link's token.
 */
async function requestResetLink(email: string): Promise<string> {
  const response = await post('request-password-reset', {
    email,
    redirectTo: '/auth/reset-password',
  });
  expect(response.status).toBe(200);
  const resetEmail = await vi.waitFor(() => {
    const [found] = vi.mocked(sendEmail).mock.calls.map(([call]) => call);
    if (!found) {
      throw new Error('The reset email has not been sent yet');
    }
    return found;
  }, 10_000);
  const token = /\/reset-password\/([\w-]+)/.exec(resetEmail.text)?.[1];
  if (!token) {
    throw new Error('No reset link in the email');
  }
  return token;
}

/**
 * Signs in with the password the reset link set.
 *
 * @param email - The address.
 * @returns The response's status.
 */
async function signInWithNewPassword(email: string): Promise<number> {
  return (await post('sign-in/email', { email, password: NEW_PASSWORD })).status;
}

/**
 * Counts a user's password sign-ins (credential accounts).
 *
 * @param userId - The user.
 * @returns How many they have.
 */
async function credentialCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
  return rows.length;
}

/**
 * Checks that nobody holds the user's sign-in change lock, by taking and
 * giving it back.
 *
 * @param userId - The user.
 * @returns Whether it was free.
 */
async function lockIsFree(userId: string): Promise<boolean> {
  const lock = await takeSignInChangeLock({ db }, userId);
  if (!lock) {
    return false;
  }
  await releaseSignInChangeLock({ db }, lock);
  return true;
}

/**
 * Creates a user who signs in only with GitHub, whose account there has
 * two-factor authentication, and has no password.
 *
 * @param setup - Gives the user their role.
 * @returns The user's ID and address.
 */
async function gitHubOnlyUser(
  setup: () => Promise<{ id: string; email: string }>,
): Promise<{ id: string; email: string }> {
  const created = await setup();
  await connectGitHub(db, created.id);
  return created;
}

/**
 * Creates a staff member with a role.
 *
 * @param role - Their staff role.
 * @returns Their ID and address.
 */
async function staffMember(role: 'support' | 'manager'): Promise<{ id: string; email: string }> {
  const email = `${role}@adiutor.test`;
  const { id } = await staffActor(db, role, email);
  return { id, email };
}

/**
 * Creates a Client of the "Adiutor Tests" company.
 *
 * @returns Their ID and address.
 */
async function companyClient(): Promise<{ id: string; email: string }> {
  const email = 'client@adiutor.test';
  const id = await createUser(db, email);
  const company = await createCompany(db);
  await addMember(db, company.id, id, 'client');
  return { id, email };
}

describe('a reset link on an account whose only MFA is GitHub', () => {
  it.each([
    ['a company Client', companyClient],
    ['a staff Support', () => staffMember('support')],
  ])('is refused for %s, so the inbox alone gets no password past GitHub', async (_, setup) => {
    const victim = await gitHubOnlyUser(setup);
    // Whoever reads the inbox asks for a link: Better Auth sends one without a password too.
    const token = await requestResetLink(victim.email);

    const response = await resetPassword(token);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'RESET_ENDS_PROVIDER_MFA',
      message:
        "This account signs in with GitHub as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with GitHub, then set a password on the Security page.",
    });
    expect(await credentialCount(victim.id)).toBe(0);
    expect(await signInWithNewPassword(victim.email)).toBe(401);
    // Refused before Better Auth used the link, and the lock was given back right away.
    expect(await db.select({ id: verification.id }).from(verification)).toHaveLength(1);
    expect(await lockIsFree(victim.id)).toBe(true);
  });

  it('is refused for a staff Manager, who is told to add a passkey or an authenticator app first', async () => {
    const manager = await gitHubOnlyUser(() => staffMember('manager'));
    const token = await storeResetLink(manager.id);

    const response = await resetPassword(token);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'RESET_ENDS_PROVIDER_MFA',
      message:
        "This account signs in with GitHub as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with GitHub, add a passkey or an authenticator app on the Security page, then set a password there.",
    });
    expect(await credentialCount(manager.id)).toBe(0);
    expect(await signInWithNewPassword(manager.email)).toBe(401);
  });

  it('goes ahead once the account also has a passkey, which keeps its MFA', async () => {
    const support = await gitHubOnlyUser(() => staffMember('support'));
    await addPasskey(db, support.id);
    const token = await storeResetLink(support.id);

    const response = await resetPassword(token);

    expect(response.status).toBe(200);
    expect(await credentialCount(support.id)).toBe(1);
    expect(await signInWithNewPassword(support.email)).toBe(200);
  });
});

describe('the reset email', () => {
  it('is in the language the account saved, else the browser’s', async () => {
    await setUserLocale(db, await createUser(db, 'jane@adiutor.test'), 'nl-NL');
    await createUser(db, 'sam@adiutor.test');
    const spanishBrowser = { cookie: 'adiutor.locale=es-ES' };

    await Promise.all(
      ['jane@adiutor.test', 'sam@adiutor.test'].map(async (email) => {
        const body = { email, redirectTo: '/auth/reset-password' };
        expect((await post('request-password-reset', body, spanishBrowser)).status).toBe(200);
      }),
    );

    // Sent after the responses.
    const emails = await vi.waitFor(() => {
      const found = vi.mocked(sendEmail).mock.calls.map(([call]) => call);
      if (found.length < 2) {
        throw new Error('The reset emails have not been sent yet');
      }
      return found;
    }, 10_000);
    expect(
      emails
        .map((email) => [email.to, emailLanguage(email), email.subject])
        .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual([
      ['jane@adiutor.test', 'nl-NL', 'Stel je Adiutor-wachtwoord opnieuw in'],
      ['sam@adiutor.test', 'es-ES', 'Restablece tu contraseña de Adiutor'],
    ]);
  });
});

describe('the welcome link of a new account', () => {
  it('sets its first password, which signs in, and gives the lock back', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const manager = await staffActor(db, 'manager', 'manager@adiutor.test');
    const registered = await registerUser(ctx, manager, 'new.person@adiutor.test');
    const token = /reset-password\?token=([\w-]+)&welcome=1/.exec(
      defined(sent[0], 'the welcome email').text,
    )?.[1];
    if (!token) {
      throw new Error('No welcome link in the email');
    }

    const response = await resetPassword(token);

    expect(response.status).toBe(200);
    expect(await credentialCount(registered.userId)).toBe(1);
    expect(await signInWithNewPassword('new.person@adiutor.test')).toBe(200);
    expect(await lockIsFree(registered.userId)).toBe(true);
  });
});

describe('a link that is not valid', () => {
  it("gets Better Auth's own answer, also on an account whose only MFA is GitHub", async () => {
    const support = await gitHubOnlyUser(() => staffMember('support'));
    const expired = await storeResetLink(support.id, new Date(Date.now() - 60_000));

    const unknown = await resetPassword(generateToken());
    const old = await resetPassword(expired);

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(old.status).toBe(400);
    expect(await old.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await credentialCount(support.id)).toBe(0);
    expect(await lockIsFree(support.id)).toBe(true);
  });
});

describe("while another change to the user's sign-in is being made", () => {
  it('refuses the reset until it is done', async () => {
    const john = await createUser(db, 'john@adiutor.test');
    const token = await storeResetLink(john);
    const lock = await takeSignInChangeLock({ db }, john);
    if (!lock) {
      throw new Error('The lock was taken already');
    }

    const refused = await resetPassword(token);

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'SIGN_IN_CHANGE_IN_PROGRESS' });
    expect(await credentialCount(john)).toBe(0);

    await releaseSignInChangeLock({ db }, lock);
    expect((await resetPassword(token)).status).toBe(200);
    expect(await credentialCount(john)).toBe(1);
  });
});
