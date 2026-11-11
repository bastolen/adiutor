/**
 * @file Integration tests for loading what the MFA rules need
 * (`mfa-state.ts`): provider accounts connected at sign-in count only once
 * the user confirmed them, and each comes with its account row's ID (what
 * the rules for disconnecting one compare).
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account } from '@/db/schema';
import { canConfirmSessions, hasMfa } from '@/lib/authz/mfa';
import { firstRow } from '@/lib/defined';
import { availableProviders } from '@/lib/sign-in/providers';

import { createUser, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import { loadMfaContext, loadMfaStates } from './mfa-state';

const { db } = setupTestContext();

/**
 * Connects a GitHub account with two-factor authentication, as Better Auth
 * stores it.
 *
 * @param userId - The user.
 * @param confirmed - Whether it counts yet (see `beforeAccountCreate`).
 * @returns The account row's ID.
 */
async function connectGitHubWith2fa(userId: string, confirmed: boolean): Promise<string> {
  const created = firstRow(
    await db
      .insert(account)
      .values({
        userId,
        accountId: `github-${userId}`,
        providerId: 'github',
        mfaVerified: true,
        confirmed,
      })
      .returning({ id: account.id }),
    'the new account',
  );
  return created.id;
}

/**
 * Loads a user's MFA context and applies the rules to it.
 *
 * @param userId - The user.
 * @returns Their provider accounts as the rules see them, and what the rules say.
 */
async function mfaOf(userId: string) {
  const mfa = await loadMfaContext(db, userId);
  if (!mfa) {
    throw new Error(`No user ${userId}`);
  }
  return {
    providerAccounts: mfa.state.providerAccounts,
    hasMfa: hasMfa(mfa.state, mfa.mfaRole, availableProviders),
    canConfirmSessions: canConfirmSessions(mfa.state, mfa.mfaRole, availableProviders),
  };
}

describe('provider accounts connected at sign-in', () => {
  it('don’t count as MFA or a second step until they’re confirmed', async () => {
    const admin = await staffActor(db, 'platform_admin');
    const github = await connectGitHubWith2fa(admin.id, false);

    expect(await mfaOf(admin.id)).toEqual({
      providerAccounts: [],
      hasMfa: false,
      canConfirmSessions: false,
    });

    await db.update(account).set({ confirmed: true }).where(eq(account.id, github));

    expect(await mfaOf(admin.id)).toEqual({
      providerAccounts: [{ id: github, providerId: 'github', mfaVerified: true }],
      hasMfa: true,
      canConfirmSessions: true,
    });
  });

  it('are left out per user when loading several users', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWith2fa(jane, false);
    const johnsGitHub = await connectGitHubWith2fa(john, true);

    const states = await loadMfaStates(db, [jane, john]);

    expect(states.get(jane)?.providerAccounts).toEqual([]);
    expect(states.get(john)?.providerAccounts).toEqual([
      { id: johnsGitHub, providerId: 'github', mfaVerified: true },
    ]);
  });
});

describe('provider accounts', () => {
  it('come with their account row’s ID, the one Better Auth’s unlink takes', async () => {
    const manager = await staffActor(db, 'manager');
    const github = await connectGitHubWith2fa(manager.id, true);
    const google = firstRow(
      await db
        .insert(account)
        .values({ userId: manager.id, accountId: 'google-manager', providerId: 'google' })
        .returning({ id: account.id }),
      'the new account',
    );

    const providerAccounts = (await loadMfaStates(db, [manager.id])).get(
      manager.id,
    )?.providerAccounts;

    expect(providerAccounts).toHaveLength(2);
    expect(providerAccounts).toEqual(
      expect.arrayContaining([
        { id: github, providerId: 'github', mfaVerified: true },
        { id: google.id, providerId: 'google', mfaVerified: false },
      ]),
    );
  });
});
