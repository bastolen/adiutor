/**
 * @file Integration tests for the job that clears OAuth tokens a sign-in
 * left behind, against the test database.
 */
import { describe, expect, it } from 'vitest';

import { account } from '@/db/schema';
import { defined } from '@/lib/defined';

import { createUser, setupTestContext } from '../../../../tests/integration/helpers';
import leftoverProviderTokens from './leftover-provider-tokens';

const { ctx, db } = setupTestContext();

/** Far enough away that no test reaches it. */
const deadline = new Date(Date.now() + 60 * 60_000);

describe('leftover-provider-tokens', () => {
  it('clears OAuth tokens a request left behind, but not those of a request still running', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    const tokens = { accessToken: 'gho_adiutor-tests', idToken: 'id', refreshToken: 'refresh' };
    const inserted = await db
      .insert(account)
      .values([
        {
          userId: jane,
          accountId: 'jane-github',
          providerId: 'github',
          ...tokens,
          updatedAt: new Date(Date.now() - 11 * 60_000),
        },
        { userId: john, accountId: 'john-github', providerId: 'github', ...tokens },
      ])
      .returning({ id: account.id });
    const left = defined(inserted[0], 'the account of the request left behind');
    const running = defined(inserted[1], 'the account of the request still running');

    await expect(leftoverProviderTokens.run(ctx, { deadline })).resolves.toEqual({
      summary: { accounts: 1 },
    });

    const stored = await db
      .select({
        id: account.id,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        idToken: account.idToken,
      })
      .from(account);
    expect(stored).toEqual(
      expect.arrayContaining([
        { id: left.id, accessToken: null, refreshToken: null, idToken: null },
        { id: running.id, ...tokens },
      ]),
    );
  });
});
