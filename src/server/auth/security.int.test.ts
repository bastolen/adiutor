/**
 * @file Integration tests for the Security page's overview and the step-up
 * methods, against the test database.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, passkey, twoFactor, user } from '@/db/schema';
import type { MfaState } from '@/lib/authz/mfa';

import {
  connectGitHub,
  createUser,
  enableTwoFactor,
  setupTestContext,
  turnOffGitHubSignIn,
} from '../../../tests/integration/helpers';
import { loadActor } from '../actor';
import { getSecurityOverview, getStepUpMethods } from './security';

const { db } = setupTestContext();

/** An unknown user's ID. */
const UNKNOWN_USER = '01900000-0000-7000-8000-000000000000';

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
  return getSecurityOverview(db, (await loadActor(db, userId)) ?? { id: userId, mfaState: null });
}

describe('getSecurityOverview', () => {
  it('shows nothing set up for a new account', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    expect(await overviewOf(jane)).toEqual({
      twoFactorEnabled: false,
      authenticatorSetUp: false,
      hasPassword: false,
      passkeys: [],
      mfaState: NOTHING_SET_UP,
    });
  });

  it('tells email codes from an authenticator app', async () => {
    const withEmailCodes = await createUser(db, 'email@adiutor.test');
    await enableTwoFactor(db, withEmailCodes, 'email');
    const withAuthenticator = await createUser(db, 'app@adiutor.test');
    await enableTwoFactor(db, withAuthenticator);

    expect(await overviewOf(withEmailCodes)).toMatchObject({
      twoFactorEnabled: true,
      authenticatorSetUp: false,
    });
    expect(await overviewOf(withAuthenticator)).toMatchObject({
      twoFactorEnabled: true,
      authenticatorSetUp: true,
    });
  });

  it("doesn't count an authenticator setup that was never finished", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.insert(twoFactor).values({
      userId: jane,
      secret: 'encrypted-secret',
      backupCodes: 'encrypted-codes',
      verified: false,
    });
    expect(await overviewOf(jane)).toMatchObject({
      twoFactorEnabled: false,
      authenticatorSetUp: false,
    });

    // With email codes already on, the unfinished setup still doesn't count.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, jane));
    expect(await overviewOf(jane)).toMatchObject({
      twoFactorEnabled: true,
      authenticatorSetUp: false,
    });
  });

  it('knows whether the account has a password', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db
      .insert(account)
      .values({ userId: jane, accountId: 'github-jane', providerId: 'github' });
    expect((await overviewOf(jane)).hasPassword).toBe(false);

    await db
      .insert(account)
      .values({ userId: jane, accountId: jane, providerId: 'credential', password: 'hashed' });
    expect((await overviewOf(jane)).hasPassword).toBe(true);
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
      deviceType: 'singleDevice',
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

  it('takes the setup from the actor, querying only the passkeys', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPasskey(jane, 'Laptop', new Date('2026-01-01T10:00:00Z'));
    // What the actor brings is shown, even though the database says otherwise.
    const loadedWithActor: MfaState = { ...NOTHING_SET_UP, hasPassword: true };

    expect(await getSecurityOverview(db, { id: jane, mfaState: loadedWithActor })).toMatchObject({
      hasPassword: true,
      passkeys: [expect.objectContaining({ name: 'Laptop' })],
      mfaState: loadedWithActor,
    });
  });

  it('shows nothing for an unknown user', async () => {
    expect(await overviewOf(UNKNOWN_USER)).toEqual({
      twoFactorEnabled: false,
      authenticatorSetUp: false,
      hasPassword: false,
      passkeys: [],
      mfaState: NOTHING_SET_UP,
    });
  });
});

describe('getStepUpMethods', () => {
  it('offers what the user has set up, and nothing for unknown users', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);

    expect(await getStepUpMethods(db, jane, null)).toEqual({
      authenticator: true,
      email: false,
      passkey: false,
      providers: [],
    });
    expect(await getStepUpMethods(db, UNKNOWN_USER, null)).toEqual({
      authenticator: false,
      email: false,
      passkey: false,
      providers: [],
    });
  });

  it('offers a provider with 2FA only while its sign-in is on', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHub(db, jane);
    expect((await getStepUpMethods(db, jane, 'manager')).providers).toEqual(['github']);

    turnOffGitHubSignIn();

    expect(await getStepUpMethods(db, jane, 'manager')).toEqual({
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
      expect(await getStepUpMethods(db, withPasskey, 'manager')).toEqual({
        authenticator: false,
        email: false,
        passkey: true,
        providers: ['github'],
      });
      expect(await getStepUpMethods(db, withPasskey, 'manager', { forChange: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: true,
        providers: [],
        providersHeldBack: ['github'],
      });
      expect(await getStepUpMethods(db, withApp, null, { forChange: true })).toEqual({
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

      expect(await getStepUpMethods(db, githubOnly, 'company_admin', { forChange: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: false,
        providers: ['github'],
      });
      expect(await getStepUpMethods(db, withEmailCodes, null, { forChange: true })).toEqual({
        authenticator: false,
        email: true,
        passkey: false,
        providers: ['github'],
      });
    });

    it('offers nothing for unknown users', async () => {
      expect(await getStepUpMethods(db, UNKNOWN_USER, null, { forChange: true })).toEqual({
        authenticator: false,
        email: false,
        passkey: false,
        providers: [],
      });
    });
  });
});
