/**
 * @file Integration tests for a user's sign-in methods, confirming a
 * provider account connected at sign-in and setting a first password (never
 * when that would take away the MFA the user's role requires, one change to
 * how they sign in at a time, and without a second step only from a sign-in
 * in the last hour), and changing the password (wrong current passwords are
 * limited and recorded).
 */
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { account, auditEvent, rateLimitBucket } from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import { defined, firstRow } from '@/lib/defined';

import {
  addPasskey,
  addPassword,
  connectGitHub,
  connectProvider,
  createUser,
  enableTwoFactor,
  inSequence,
  setupTestContext,
  staffActor,
  turnOffGitHubSignIn,
  minutesAgo,
} from '../../../tests/integration/helpers';
import { loadActor } from '../actor';
import { ServiceError } from '../errors';
import {
  changeOwnPassword,
  confirmConnectedProvider,
  hasPassword,
  listConnectedProviders,
  setFirstPassword,
} from './accounts';
import { wrongCurrentPasswordsKey } from './current-password';
import { loadMfaContext } from './mfa-state';
import { releaseSignInChangeLock, takeSignInChangeLock } from './sign-in-change-lock';

// Watched, to check when the services read a user's MFA state; it still reads it.
vi.mock('./mfa-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mfa-state')>();
  return { ...actual, loadMfaContext: vi.fn(actual.loadMfaContext) };
});

/** The real `loadMfaContext`, for spies that look around it. */
const { loadMfaContext: realLoadMfaContext } =
  await vi.importActual<typeof import('./mfa-state')>('./mfa-state');

const { ctx, db } = setupTestContext();

/**
 * Reads whether a user's lock for sign-in changes is taken.
 *
 * @param userId - The user.
 * @returns Whether its row exists.
 */
async function lockTaken(userId: string): Promise<boolean> {
  const held = await takeSignInChangeLock({ db }, userId);
  if (!held) {
    return true;
  }
  await releaseSignInChangeLock({ db }, held);
  return false;
}

/**
 * Connects a provider account to a user, as Better Auth stores it.
 *
 * @param userId - The user.
 * @param providerId - `github`, `google` or `credential`.
 * @param confirmed - Whether it counts yet (see `beforeAccountCreate`).
 * @returns The account row's ID.
 */
async function connect(userId: string, providerId: string, confirmed = true): Promise<string> {
  const created = firstRow(
    await db
      .insert(account)
      .values({ userId, accountId: `${providerId}-${userId}`, providerId, confirmed })
      .returning({ id: account.id }),
    'the new account',
  );
  return created.id;
}

/**
 * Reads whether an account counts yet.
 *
 * @param accountId - The account row.
 * @returns Its `confirmed` flag.
 */
async function isConfirmed(accountId: string): Promise<boolean | null> {
  const found = firstRow(
    await db
      .select({ confirmed: account.confirmed })
      .from(account)
      .where(eq(account.id, accountId)),
    'the account',
  );
  return found.confirmed;
}

/**
 * Loads a user as the actor of a session, confirmed with a second step or
 * not.
 *
 * @param userId - The user.
 * @param confirmedAt - When the session was confirmed, or `null` when it wasn't.
 * @param method - What it was confirmed with; defaults to the authenticator app.
 * @param signedInAt - When it signed in (Better Auth's `createdAt`, for the one-hour rule);
 *   defaults to now.
 * @returns The actor.
 */
async function signedIn(
  userId: string,
  confirmedAt: Date | null,
  method: MfaMethod = 'authenticator',
  signedInAt: Date = new Date(),
) {
  const actor = await loadActor(db, userId, {
    id: 'adiutor-tests-session',
    mfaVerified: confirmedAt !== null,
    mfaMethod: confirmedAt ? method : null,
    mfaVerifiedAt: confirmedAt,
    createdAt: signedInAt,
  });
  if (!actor) {
    throw new Error(`No user ${userId}`);
  }
  return actor;
}

/**
 * Lists the audit log's actions and details.
 *
 * @returns The events, in no particular order.
 */
async function events() {
  return db
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      details: auditEvent.details,
    })
    .from(auditEvent);
}

describe('sign-in methods', () => {
  it('lists only the user’s own GitHub and Google accounts, not their password', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const otherId = await createUser(db, 'other@adiutor.test');
    await db.insert(account).values([
      { userId, accountId: userId, providerId: 'credential', password: 'hash' },
      { userId, accountId: 'gh-1', providerId: 'github' },
      { userId, accountId: 'go-1', providerId: 'google' },
      { userId: otherId, accountId: 'gh-2', providerId: 'github' },
    ]);

    const connected = await listConnectedProviders({ db }, userId);
    expect(connected.map((item) => item.provider).sort()).toEqual(['github', 'google']);
    expect(await hasPassword(db, userId)).toBe(true);
    expect(await hasPassword(db, otherId)).toBe(false);
    expect(await listConnectedProviders({ db }, otherId)).toHaveLength(1);
  });

  it('tells which connected accounts wait for confirmation', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const github = await connect(userId, 'github', false);
    const google = await connect(userId, 'google');

    const connected = await listConnectedProviders({ db }, userId);

    expect(connected.map(({ id, confirmed }) => ({ id, confirmed }))).toEqual(
      expect.arrayContaining([
        { id: github, confirmed: false },
        { id: google, confirmed: true },
      ]),
    );
    expect(connected).toHaveLength(2);
  });

  it('names each connected account the way its owner knows it, cleaned again when read', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const github = await connectProvider(db, userId, { accountName: 'adiutor-tests' });
    const google = await connectProvider(db, userId, { providerId: 'google' });
    // Stored before it was cleaned, or changed in the database.
    const odd = await connectProvider(db, userId, { accountName: 'adiutor\u202E-tests' });

    const names = Object.fromEntries(
      (await listConnectedProviders({ db }, userId)).map(({ id, accountName }) => [
        id,
        accountName,
      ]),
    );

    expect(names).toEqual({ [github]: 'adiutor-tests', [google]: null, [odd]: 'adiutor-tests' });
  });

  it('tells which connected accounts can be a second step, and the MFA their provider gave', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const with2fa = await connectProvider(db, userId, { mfaVerified: true });
    const without2fa = await connectProvider(db, userId, { mfaVerified: false });
    const google = await connectProvider(db, userId, { providerId: 'google', mfaVerified: true });

    /**
     * Lists which of the user's accounts give MFA.
     *
     * @returns Each account's ID, `givesMfa` and stored `mfaVerified`.
     */
    const listed = async () =>
      (await listConnectedProviders({ db }, userId)).map(({ id, givesMfa, mfaVerified }) => ({
        id,
        givesMfa,
        mfaVerified,
      }));

    expect(await listed()).toEqual(
      expect.arrayContaining([
        { id: with2fa, givesMfa: true, mfaVerified: true },
        { id: without2fa, givesMfa: false, mfaVerified: false },
        // Google can't prove MFA, whatever its flag says; the flag is kept for the MFA rules.
        { id: google, givesMfa: false, mfaVerified: true },
      ]),
    );
    turnOffGitHubSignIn();
    expect((await listed()).find(({ id }) => id === with2fa)).toMatchObject({
      givesMfa: false,
      mfaVerified: true,
    });
  });
});

describe('confirmConnectedProvider', () => {
  it('confirms the user’s own account connected at sign-in, and records it', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await enableTwoFactor(db, userId);
    const github = await connect(userId, 'github', false);

    await confirmConnectedProvider(ctx, await signedIn(userId, new Date()), github);

    expect(await isConfirmed(github)).toBe(true);
    expect(await events()).toEqual([
      {
        action: 'provider_confirmed',
        actorUserId: userId,
        details: { providerId: 'github', givesMfa: false },
      },
    ]);
  });

  it('records that a confirmed GitHub account with two-factor authentication is a second step', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await enableTwoFactor(db, userId);
    const github = await connectProvider(db, userId, { mfaVerified: true, confirmed: false });

    await confirmConnectedProvider(ctx, await signedIn(userId, new Date()), github);

    expect(await events()).toEqual([
      {
        action: 'provider_confirmed',
        actorUserId: userId,
        details: { providerId: 'github', givesMfa: true },
      },
    ]);
  });

  it('is refused while another change to how the user signs in is made, and reads under the lock', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await enableTwoFactor(db, userId);
    const github = await connect(userId, 'github', false);
    const held = await takeSignInChangeLock({ db }, userId);
    vi.mocked(loadMfaContext).mockClear();

    await expect(
      confirmConnectedProvider(ctx, await signedIn(userId, new Date()), github),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await isConfirmed(github)).toBe(false);
    expect(loadMfaContext).not.toHaveBeenCalled();

    await releaseSignInChangeLock({ db }, defined(held, 'the sign-in change lock'));
    const lockedWhileRead: boolean[] = [];
    vi.mocked(loadMfaContext).mockImplementationOnce(async (database, id) => {
      lockedWhileRead.push(await lockTaken(id));
      return realLoadMfaContext(database, id);
    });
    await confirmConnectedProvider(ctx, await signedIn(userId, new Date()), github);
    expect(await isConfirmed(github)).toBe(true);
    expect(lockedWhileRead).toEqual([true]);
    // Given back afterwards.
    expect(await lockTaken(userId)).toBe(false);
  });

  it('needs a session confirmed with the account’s second step', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await enableTwoFactor(db, userId);
    const github = await connect(userId, 'github', false);

    await expect(
      confirmConnectedProvider(ctx, await signedIn(userId, null), github),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect(await isConfirmed(github)).toBe(false);
    expect(await events()).toEqual([]);
  });

  it('goes ahead without a second step left to confirm with, as for adding a first one', async () => {
    // E.g. two-step verification was turned off after GitHub was connected at sign-in.
    const userId = await createUser(db, 'user@adiutor.test');
    const github = await connect(userId, 'github', false);

    await confirmConnectedProvider(ctx, await signedIn(userId, null), github);

    expect(await isConfirmed(github)).toBe(true);
    expect(await events()).toEqual([
      {
        action: 'provider_confirmed',
        actorUserId: userId,
        details: { providerId: 'github', givesMfa: false },
      },
    ]);
  });

  it('needs a sign-in from the last hour without a second step', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const github = await connect(userId, 'github', false);

    await expect(
      confirmConnectedProvider(
        ctx,
        await signedIn(userId, null, 'authenticator', minutesAgo(61)),
        github,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', key: 'errors.signIn.sessionNotFresh' });
    expect(await isConfirmed(github)).toBe(false);
    expect(await events()).toEqual([]);

    await confirmConnectedProvider(
      ctx,
      await signedIn(userId, null, 'authenticator', minutesAgo(59)),
      github,
    );
    expect(await isConfirmed(github)).toBe(true);
  });

  it('needs that confirmation to be from the last 15 minutes', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await enableTwoFactor(db, userId);
    const github = await connect(userId, 'github', false);
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60_000);

    await expect(
      confirmConnectedProvider(ctx, await signedIn(userId, sixteenMinutesAgo), github),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect(await isConfirmed(github)).toBe(false);
    expect(await events()).toEqual([]);
  });

  it('only confirms the user’s own unconfirmed provider accounts', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const otherId = await createUser(db, 'other@adiutor.test');
    const othersGitHub = await connect(otherId, 'github', false);
    const ownPassword = await connect(userId, 'credential', false);
    const ownGoogle = await connect(userId, 'google');
    const actor = await signedIn(userId, new Date());

    await expect(confirmConnectedProvider(ctx, actor, othersGitHub)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(confirmConnectedProvider(ctx, actor, ownPassword)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(confirmConnectedProvider(ctx, actor, ownGoogle)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(confirmConnectedProvider(ctx, actor, 'not-an-id')).rejects.toMatchObject({
      code: 'not_found',
    });

    expect(await isConfirmed(othersGitHub)).toBe(false);
    expect(await isConfirmed(ownPassword)).toBe(false);
    expect(await events()).toEqual([]);
  });
});

describe('confirmConnectedProvider for a role that requires MFA', () => {
  /**
   * Creates a staff Admin who signs in only with GitHub (2FA on, no
   * password), so GitHub is their MFA, and a session confirmed with it just
   * now.
   *
   * @returns The Admin's ID and the session's actor.
   */
  async function gitHubOnlyAdmin() {
    const admin = await staffActor(db, 'platform_admin');
    await connectGitHub(db, admin.id);
    return { adminId: admin.id, actor: await signedIn(admin.id, new Date(), 'github') };
  }

  it('refuses Google, which would stop GitHub counting as MFA, and changes nothing', async () => {
    const { adminId, actor } = await gitHubOnlyAdmin();
    const google = await connectProvider(db, adminId, {
      providerId: 'google',
      mfaVerified: false,
      confirmed: false,
    });

    await expect(confirmConnectedProvider(ctx, actor, google)).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.signIn.mfaRequiredForRole',
    });

    expect(await isConfirmed(google)).toBe(false);
    expect(await events()).toEqual([]);
  });

  it("confirms Google while GitHub sign-in is off: GitHub's 2FA isn't MFA to keep then", async () => {
    turnOffGitHubSignIn();
    const admin = await staffActor(db, 'platform_admin');
    await connectGitHub(db, admin.id);
    const google = await connectProvider(db, admin.id, {
      providerId: 'google',
      mfaVerified: false,
      confirmed: false,
    });

    // E.g. from an email-link session: GitHub can't confirm it, so there's no second step to ask for.
    await confirmConnectedProvider(ctx, await signedIn(admin.id, null), google);

    expect(await isConfirmed(google)).toBe(true);
  });

  it('still answers "not found" for an account that isn’t theirs to confirm', async () => {
    const { actor } = await gitHubOnlyAdmin();
    const otherId = await createUser(db, 'other@adiutor.test');
    const othersGoogle = await connectProvider(db, otherId, {
      providerId: 'google',
      mfaVerified: false,
      confirmed: false,
    });

    await expect(confirmConnectedProvider(ctx, actor, othersGoogle)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('confirms a second GitHub account with 2FA, which keeps GitHub counting', async () => {
    const { adminId, actor } = await gitHubOnlyAdmin();
    const second = await connectProvider(db, adminId, { mfaVerified: true, confirmed: false });

    await confirmConnectedProvider(ctx, actor, second);

    expect(await isConfirmed(second)).toBe(true);
  });

  it('refuses a second GitHub account without 2FA, which would stop GitHub counting', async () => {
    const { adminId, actor } = await gitHubOnlyAdmin();
    const second = await connectProvider(db, adminId, { mfaVerified: false, confirmed: false });

    await expect(confirmConnectedProvider(ctx, actor, second)).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.signIn.mfaRequiredForRole',
    });

    expect(await isConfirmed(second)).toBe(false);
    expect(await events()).toEqual([]);
  });

  it('confirms Google once the Admin has a passkey to keep MFA with', async () => {
    const { adminId } = await gitHubOnlyAdmin();
    const google = await connectProvider(db, adminId, {
      providerId: 'google',
      mfaVerified: false,
      confirmed: false,
    });
    await addPasskey(db, adminId);

    await confirmConnectedProvider(ctx, await signedIn(adminId, new Date(), 'passkey'), google);

    expect(await isConfirmed(google)).toBe(true);
    expect(await events()).toEqual([
      {
        action: 'provider_confirmed',
        actorUserId: adminId,
        details: { providerId: 'google', givesMfa: false },
      },
    ]);
  });
});

describe('setFirstPassword', () => {
  /**
   * Stands in for Better Auth's `setPassword`.
   *
   * @returns The mock.
   */
  const passwordSetter = () => vi.fn(async () => undefined);

  it("refuses a password that would end a Manager's GitHub MFA, until they add a passkey", async () => {
    const manager = await staffActor(db, 'manager');
    await connectGitHub(db, manager.id);
    const setPassword = passwordSetter();

    await expect(
      setFirstPassword(ctx, await signedIn(manager.id, new Date(), 'github'), setPassword),
    ).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.signIn.mfaRequiredForRole',
    });
    expect(setPassword).not.toHaveBeenCalled();

    await addPasskey(db, manager.id);
    // GitHub no longer confirms changes then: the passkey does.
    await expect(
      setFirstPassword(ctx, await signedIn(manager.id, new Date(), 'github'), setPassword),
    ).rejects.toMatchObject({ code: 'forbidden', key: 'errors.signIn.mfaVerificationRequired' });
    await setFirstPassword(ctx, await signedIn(manager.id, new Date(), 'passkey'), setPassword);
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(await lockTaken(manager.id)).toBe(false);
  });

  it('needs a recent confirmation next to a second step, but not without one', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const setPassword = passwordSetter();
    const longAgo = new Date(Date.now() - 16 * 60_000);

    await expect(
      setFirstPassword(ctx, await signedIn(support.id, longAgo), setPassword),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await setFirstPassword(ctx, await signedIn(support.id, new Date()), setPassword);
    // A password isn't a second step: without one, nothing to confirm with.
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await setFirstPassword(ctx, await signedIn(newcomer, null), setPassword);

    expect(setPassword).toHaveBeenCalledTimes(2);
  });

  it('needs a sign-in from the last hour without a second step, as the guards do', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    const setPassword = passwordSetter();

    // An old (stolen) session can't add a lasting password.
    await expect(
      setFirstPassword(
        ctx,
        await signedIn(newcomer, null, 'authenticator', minutesAgo(61)),
        setPassword,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', key: 'errors.signIn.sessionNotFresh' });
    // A session whose sign-in time is unknown counts as too old.
    const unknown = { ...(await signedIn(newcomer, null)), signedInAt: null };
    await expect(setFirstPassword(ctx, unknown, setPassword)).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.signIn.sessionNotFresh',
    });
    expect(setPassword).not.toHaveBeenCalled();
    expect(await lockTaken(newcomer)).toBe(false);

    await setFirstPassword(
      ctx,
      await signedIn(newcomer, null, 'authenticator', minutesAgo(59)),
      setPassword,
    );
    // With a second step, its recent confirmation decides, however long ago the sign-in was.
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await setFirstPassword(
      ctx,
      await signedIn(support.id, new Date(), 'authenticator', minutesAgo(3 * 60)),
      setPassword,
    );
    expect(setPassword).toHaveBeenCalledTimes(2);
  });

  it('is refused while another change is made, or when there is a password already', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const setPassword = passwordSetter();
    const held = await takeSignInChangeLock({ db }, userId);

    await expect(
      setFirstPassword(ctx, await signedIn(userId, null), setPassword),
    ).rejects.toMatchObject({ code: 'conflict' });
    await releaseSignInChangeLock({ db }, defined(held, 'the sign-in change lock'));
    await addPassword(db, userId);
    await expect(
      setFirstPassword(ctx, await signedIn(userId, null), setPassword),
    ).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.signIn.passwordAlreadySet',
    });

    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe('changeOwnPassword', () => {
  /**
   * Stands in for Better Auth's `changePassword` with a wrong current
   * password.
   *
   * @returns The mock, which throws Better Auth's `INVALID_PASSWORD`.
   */
  const wrongPassword = () =>
    vi.fn(async () => {
      throw new APIError('BAD_REQUEST', { code: 'INVALID_PASSWORD', message: 'Invalid password' });
    });

  /**
   * Changes the password a number of times, one after another.
   *
   * @param times - How many times.
   * @param actor - The signed-in user.
   * @param change - Stands in for Better Auth's `changePassword`.
   * @returns How each ended: `changed`, a service error's code, or any other error itself.
   */
  async function attempts(
    times: number,
    actor: Awaited<ReturnType<typeof signedIn>>,
    change: () => Promise<unknown>,
  ): Promise<unknown[]> {
    return inSequence(Array.from({ length: times }), () =>
      changeOwnPassword(ctx, actor, change).then(
        () => 'changed',
        (error: unknown) => (error instanceof ServiceError ? error.code : error),
      ),
    );
  }

  /**
   * Reads the user's count of wrong current passwords.
   *
   * @param userId - The user.
   * @returns The count in the current window, or `null` without one.
   */
  async function wrongCount(userId: string): Promise<number | null> {
    const [bucket] = await db
      .select({ count: rateLimitBucket.count })
      .from(rateLimitBucket)
      .where(eq(rateLimitBucket.key, wrongCurrentPasswordsKey(userId)));
    return bucket?.count ?? null;
  }

  it('records each wrong current password, and refuses after five without checking', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await addPassword(db, userId);
    const actor = await signedIn(userId, null);
    const change = wrongPassword();

    await expect(changeOwnPassword(ctx, actor, change)).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.wrongPassword.change_password',
    });
    expect(await attempts(4, actor, change)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    const right = vi.fn(async () => undefined);
    await expect(changeOwnPassword(ctx, actor, right)).rejects.toMatchObject({
      code: 'rate_limited',
      key: 'errors.tooManyAttempts',
      values: { minutes: expect.any(Number) },
    });

    expect(change).toHaveBeenCalledTimes(5);
    expect(right).not.toHaveBeenCalled();
    expect(await events()).toEqual(
      Array.from({ length: 5 }, () => ({
        action: 'password_check_failed',
        actorUserId: userId,
        details: { purpose: 'change_password' },
      })),
    );
    // Its own bucket: the address's password sign-in isn't paused by it.
    expect(await db.select({ key: rateLimitBucket.key }).from(rateLimitBucket)).toEqual([
      { key: `current-password-failed:user:${userId}` },
    ]);
  });

  it('gives a right password its attempt back, and records nothing for it', async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await addPassword(db, userId);
    const actor = await signedIn(userId, null);
    const wrong = wrongPassword();
    const right = vi.fn(async () => undefined);

    expect(await attempts(4, actor, wrong)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    await changeOwnPassword(ctx, actor, right);
    expect(right).toHaveBeenCalledTimes(1);
    expect(await wrongCount(userId)).toBe(4);
    // So a fifth wrong one is still checked; only the next is refused.
    expect(await attempts(2, actor, wrong)).toEqual(['invalid', 'rate_limited']);

    expect(wrong).toHaveBeenCalledTimes(5);
    expect((await events()).map(({ action }) => action)).toEqual(
      Array.from({ length: 5 }, () => 'password_check_failed'),
    );
  });

  it("passes Better Auth's other errors on without counting them as wrong passwords", async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    await addPassword(db, userId);
    const actor = await signedIn(userId, null);
    const tooLong = new APIError('BAD_REQUEST', {
      code: 'PASSWORD_TOO_LONG',
      message: 'Password too long',
    });
    const change = vi.fn(async () => {
      throw tooLong;
    });

    await expect(changeOwnPassword(ctx, actor, change)).rejects.toBe(tooLong);
    const outcomes = await attempts(5, actor, change);
    expect(outcomes).toHaveLength(5);
    expect(outcomes.every((outcome) => outcome === tooLong)).toBe(true);

    expect(change).toHaveBeenCalledTimes(6);
    expect(await wrongCount(userId)).toBe(0);
    expect(await events()).toEqual([]);
  });

  it("counts each user's wrong passwords on their own", async () => {
    const userId = await createUser(db, 'user@adiutor.test');
    const otherId = await createUser(db, 'other@adiutor.test');
    expect(await attempts(6, await signedIn(userId, null), wrongPassword())).toEqual([
      ...Array.from({ length: 5 }, () => 'invalid'),
      'rate_limited',
    ]);

    const right = vi.fn(async () => undefined);
    await changeOwnPassword(ctx, await signedIn(otherId, null), right);
    expect(right).toHaveBeenCalledTimes(1);
  });
});
