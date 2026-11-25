/**
 * @file Integration tests for the Security page's overview (with the names a
 * staff member signed in as the user doesn't see left out, while the user's
 * page still shows them to staff Admins) and the step-up methods, against the
 * test database.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { passkey, user } from '@/db/schema';
import type { MfaRole, MfaState } from '@/lib/authz/mfa';
import type { Permission } from '@/lib/authz/permissions';
import { defined } from '@/lib/defined';

import {
  addPassword,
  connectGitHub,
  connectProvider,
  createUser,
  enableTwoFactor,
  setupTestContext,
  staffActor,
  turnOffGitHubSignIn,
  startAuthenticatorSetup,
} from '../../../tests/integration/helpers';
import { type Actor, loadActor } from '../actor';
import { getUserDetail } from '../people/user-admin';
import { getSecurityOverview, getStepUpMethods } from './security';

const { ctx, db } = setupTestContext();

/** The MFA rules' view of an account with nothing set up. */
const NOTHING_SET_UP: MfaState = {
  twoFactorEnabled: false,
  authenticator: false,
  passkeyCount: 0,
  hasPassword: false,
  providerAccounts: [],
};

/**
 * Adds a passkey.
 *
 * @param userId - Its user.
 * @param name - Its name.
 * @param createdAt - When it was added.
 */
async function addPasskey(userId: string, name: string, createdAt: Date): Promise<void> {
  await db.insert(passkey).values({
    userId,
    name,
    publicKey: 'test-public-key',
    credentialID: `test-credential-${name}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt,
  });
}

/**
 * Loads a user's Security page overview the way the page does: with the
 * actor, which brings their setup.
 *
 * @param userId - The user.
 * @returns Their overview.
 */
async function overviewOf(userId: string) {
  return getSecurityOverview({ db }, defined(await loadActor(db, userId), 'the actor'));
}

/**
 * Works out a user's step-up methods the way the step-up page does: from the
 * setup their actor brings, under the MFA rules of the given role.
 *
 * @param userId - The user.
 * @param mfaRole - Which MFA rules apply to them, or `null`.
 * @param options - Whether it's for a change to how they sign in, or for a strong second step.
 * @returns Their methods.
 */
async function stepUpMethodsOf(
  userId: string,
  mfaRole: MfaRole | null,
  options?: Parameters<typeof getStepUpMethods>[1],
) {
  const { mfaState } = defined(await loadActor(db, userId), 'the actor');
  return getStepUpMethods({ mfaState, mfaRole }, options);
}

describe('getSecurityOverview', () => {
  it('shows nothing set up for a new account', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    expect(await overviewOf(jane)).toEqual({
      passkeys: [],
      connected: [],
      mfaState: NOTHING_SET_UP,
    });
  });

  it('tells email codes from an authenticator app', async () => {
    const withEmailCodes = await createUser(db, 'email@adiutor.test');
    await enableTwoFactor(db, withEmailCodes, 'email');
    const withAuthenticator = await createUser(db, 'app@adiutor.test');
    await enableTwoFactor(db, withAuthenticator);

    expect((await overviewOf(withEmailCodes)).mfaState).toMatchObject({
      twoFactorEnabled: true,
      authenticator: false,
    });
    expect((await overviewOf(withAuthenticator)).mfaState).toMatchObject({
      twoFactorEnabled: true,
      authenticator: true,
    });
  });

  it("doesn't count an authenticator setup that was never finished", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await startAuthenticatorSetup(db, jane);
    expect((await overviewOf(jane)).mfaState).toMatchObject({
      twoFactorEnabled: false,
      authenticator: false,
    });

    // With email codes already on, the unfinished setup still doesn't count.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, jane));
    expect((await overviewOf(jane)).mfaState).toMatchObject({
      twoFactorEnabled: true,
      authenticator: false,
    });
  });

  it('knows whether the account has a password', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    // Without two-factor authentication at GitHub (the helper's default is with).
    await connectProvider(db, jane, { mfaVerified: false });
    expect((await overviewOf(jane)).mfaState.hasPassword).toBe(false);

    await addPassword(db, jane);
    expect((await overviewOf(jane)).mfaState.hasPassword).toBe(true);
  });

  it('lists only the user’s own passkeys, oldest first', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    await addPasskey(jane, 'Phone', new Date('2026-02-01T10:00:00Z'));
    await addPasskey(jane, 'Laptop', new Date('2026-01-01T10:00:00Z'));
    await addPasskey(john, 'Tablet', new Date('2026-01-15T10:00:00Z'));

    const { passkeys } = await overviewOf(jane);

    expect(passkeys.map(({ name }) => name)).toEqual(['Laptop', 'Phone']);
    expect(passkeys[0]).toEqual({
      id: expect.any(String),
      name: 'Laptop',
      backedUp: false,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
  });

  it('gives the setup as the MFA rules see it, for the Security page’s checks', async () => {
    const manager = await createUser(db, 'manager@adiutor.test');
    await enableTwoFactor(db, manager);
    await addPasskey(manager, 'Laptop', new Date('2026-01-01T10:00:00Z'));
    const github = await connectGitHub(db, manager);

    expect((await overviewOf(manager)).mfaState).toEqual({
      twoFactorEnabled: true,
      authenticator: true,
      passkeyCount: 1,
      hasPassword: false,
      providerAccounts: [{ id: github, providerId: 'github', mfaVerified: true }],
    });
  });

  it('takes the setup from the actor, querying only the passkeys and connected accounts', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPasskey(jane, 'Laptop', new Date('2026-01-01T10:00:00Z'));
    // What the actor brings is shown, even though the database says otherwise.
    const loadedWithActor: MfaState = { ...NOTHING_SET_UP, hasPassword: true };

    expect(
      await getSecurityOverview({ db }, { id: jane, mfaState: loadedWithActor, signedInAs: null }),
    ).toMatchObject({
      passkeys: [expect.objectContaining({ name: 'Laptop' })],
      mfaState: loadedWithActor,
    });
  });
});

describe('getSecurityOverview while a staff member is signed in as the user', () => {
  /**
   * The user as the actor while a staff member with these global
   * permissions is signed in as them.
   *
   * @param own - The user, as their own actor.
   * @param staffPermissions - The staff member's own global permissions.
   * @returns The actor.
   */
  const signedInAsBy = (own: Actor, staffPermissions: Permission[]): Actor => ({
    ...own,
    signedInAs: {
      staffId: '01900000-0000-7000-8000-000000000001',
      staffName: 'Sam Support',
      endsAt: new Date(Date.now() + 30 * 60_000),
      returnTo: '/dashboard',
      staffPermissions,
    },
  });

  /**
   * The names the overview gives.
   *
   * @param actor - Who reads it.
   * @returns The passkeys' names and the connected accounts' names.
   */
  const namesFor = async (actor: Actor) => {
    const overview = await getSecurityOverview({ db }, actor);
    return {
      passkeys: overview.passkeys.map(({ name }) => name),
      accounts: overview.connected.map(({ accountName }) => accountName),
    };
  };

  it('leaves out the names the staff member doesn’t see on the user’s page', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPasskey(jane, 'Laptop', new Date('2026-01-01T10:00:00Z'));
    await connectProvider(db, jane, { accountName: 'jane-at-github' });
    const own = defined(await loadActor(db, jane), 'the actor');

    // The user themselves, and a staff Admin (`users:manage`), see every name.
    const all = { passkeys: ['Laptop'], accounts: ['jane-at-github'] };
    expect(await namesFor(own)).toEqual(all);
    expect(await namesFor(signedInAsBy(own, ['users:view', 'users:manage']))).toEqual(all);
    // Support or a Manager sees the passkey and the account, without their names.
    expect(await namesFor(signedInAsBy(own, ['users:view', 'audit:view']))).toEqual({
      passkeys: [null],
      accounts: [null],
    });
    // Whatever is left out, the rest stays: what the MFA rules need.
    const overview = await getSecurityOverview({ db }, signedInAsBy(own, ['users:view']));
    expect(overview.connected).toEqual([
      expect.objectContaining({ provider: 'github', confirmed: true, mfaVerified: true }),
    ]);
    expect(overview.mfaState).toEqual(own.mfaState);

    // The user's page, which loads them by ID, still names the account for a staff Admin.
    const admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
    const detail = await getUserDetail(ctx, admin, jane);
    expect(Object.values(detail.accountNames ?? {})).toEqual(['jane-at-github']);
  });
});

describe('getStepUpMethods', () => {
  it('offers what the user has set up', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);

    expect(await stepUpMethodsOf(jane, null)).toEqual({
      authenticator: true,
      email: false,
      passkey: false,
      providers: [],
    });
  });

  it('takes the setup from the actor, without asking the database', () => {
    // What the actor brings decides: no user with this setup is stored.
    const loadedWithActor: MfaState = { ...NOTHING_SET_UP, passkeyCount: 1 };

    expect(getStepUpMethods({ mfaState: loadedWithActor, mfaRole: null })).toEqual({
      authenticator: false,
      email: false,
      passkey: true,
      providers: [],
    });
  });

  it('offers a provider with 2FA only while its sign-in is on', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHub(db, jane);
    expect((await stepUpMethodsOf(jane, 'manager')).providers).toEqual(['github']);

    turnOffGitHubSignIn();

    expect(await stepUpMethodsOf(jane, 'manager')).toEqual({
      authenticator: false,
      email: false,
      passkey: false,
      providers: [],
    });
  });

  describe('for a change to how the user signs in', () => {
    it('leaves out GitHub next to a passkey or an authenticator app, saying so', async () => {
      const withPasskey = await createUser(db, 'jane@adiutor.test');
      await connectGitHub(db, withPasskey);
      await addPasskey(withPasskey, 'Adiutor Tests laptop', new Date());
      const withApp = await createUser(db, 'john@adiutor.test');
      await connectGitHub(db, withApp);
      await enableTwoFactor(db, withApp);

      // To confirm a session, GitHub still does.
      expect(await stepUpMethodsOf(withPasskey, 'manager')).toEqual({
        authenticator: false,
        email: false,
        passkey: true,
        providers: ['github'],
      });
      expect(await stepUpMethodsOf(withPasskey, 'manager', { forChange: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: true,
        providers: [],
        providersHeldBack: ['github'],
      });
      expect(await stepUpMethodsOf(withApp, null, { forChange: true })).toEqual({
        authenticator: true,
        email: false,
        passkey: false,
        providers: [],
        providersHeldBack: ['github'],
      });
    });

    it('still offers GitHub when it is the only strong step, also next to email codes', async () => {
      const githubOnly = await createUser(db, 'jane@adiutor.test');
      await connectGitHub(db, githubOnly);
      const withEmailCodes = await createUser(db, 'john@adiutor.test');
      await connectGitHub(db, withEmailCodes);
      await enableTwoFactor(db, withEmailCodes, 'email');

      expect(await stepUpMethodsOf(githubOnly, 'company_admin', { forChange: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: false,
        providers: ['github'],
      });
      expect(await stepUpMethodsOf(withEmailCodes, null, { forChange: true })).toEqual({
        authenticator: false,
        email: true,
        passkey: false,
        providers: ['github'],
      });
    });
  });

  describe('for a strong second step (before signing in as someone)', () => {
    it('never offers email codes, whatever the role', async () => {
      const support = await createUser(db, 'support@adiutor.test');
      await enableTwoFactor(db, support, 'email');
      await addPasskey(support, 'Laptop', new Date('2026-01-01T10:00:00Z'));

      expect(await stepUpMethodsOf(support, 'support', { forChange: true })).toEqual({
        authenticator: false,
        email: true,
        passkey: true,
        providers: [],
      });
      expect(await stepUpMethodsOf(support, 'support', { strong: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: true,
        providers: [],
      });
    });

    it('offers GitHub only as the only strong step, and nothing without one', async () => {
      const githubOnly = await createUser(db, 'jane@adiutor.test');
      await connectGitHub(db, githubOnly);
      const emailCodesOnly = await createUser(db, 'john@adiutor.test');
      await enableTwoFactor(db, emailCodesOnly, 'email');

      expect(await stepUpMethodsOf(githubOnly, 'support', { strong: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: false,
        providers: ['github'],
      });
      expect(await stepUpMethodsOf(emailCodesOnly, 'support', { strong: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: false,
        providers: [],
      });
    });
  });
});
