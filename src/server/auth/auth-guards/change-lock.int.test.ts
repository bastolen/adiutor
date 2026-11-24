/**
 * @file Integration tests for one change to how a user signs in at a time.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { rateLimitBucket } from '@/db/schema';
import { defined } from '@/lib/defined';

import { addPasskey, staffActor } from '../../../../tests/integration/helpers';
import { loadMfaContext } from '../mfa-state';
import { releaseSignInChangeLock, takeSignInChangeLock } from '../sign-in-change-lock';
import { beforeAuthRequest } from './before-request';
import { releaseSignInChangeLockOf } from './change-lock';
import { db, signedIn, request, outcomeOf, hits } from './test-helpers';

/** The real `loadMfaContext`, for spies that look around it. */
const { loadMfaContext: realLoadMfaContext } =
  await vi.importActual<typeof import('../mfa-state')>('../mfa-state');

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  // Better Auth's request state isn't there outside a request; the tests watch what's added.
  addOAuthServerContext: vi.fn(),
}));

// Watched, to check when the checks read a user's MFA state; it still reads it.
vi.mock('../mfa-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mfa-state')>();
  return { ...actual, loadMfaContext: vi.fn(actual.loadMfaContext) };
});

describe('one change to how a user signs in at a time', () => {
  /**
   * Signs in a Manager with two passkeys, confirmed just now.
   *
   * @returns The Manager's ID.
   */
  async function managerWithTwoPasskeys(): Promise<string> {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);
    await addPasskey(db, manager.id);
    await signedIn(manager.id, { verifiedWith: 'passkey' });
    return manager.id;
  }

  it('refuses a second change while the first is still being made, then lets the next through', async () => {
    await managerWithTwoPasskeys();
    const first = request('/passkey/delete-passkey');
    await beforeAuthRequest(first);

    expect(await outcomeOf('/passkey/delete-passkey')).toBe('SIGN_IN_CHANGE_IN_PROGRESS');
    expect(await outcomeOf('/two-factor/disable')).toBe('SIGN_IN_CHANGE_IN_PROGRESS');

    await releaseSignInChangeLockOf({ context: first.context });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');
  });

  it('lets one of several changes sent at the same moment through', async () => {
    await managerWithTwoPasskeys();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => beforeAuthRequest(request('/passkey/delete-passkey'))),
    );

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(
      outcomes.filter(
        (outcome) =>
          outcome.status === 'rejected' &&
          (outcome.reason as { body?: { code?: string } }).body?.code ===
            'SIGN_IN_CHANGE_IN_PROGRESS',
      ),
    ).toHaveLength(9);
  });

  it('is taken before anything about the user is read, so a waiting change sees the latest state', async () => {
    const manager = await managerWithTwoPasskeys();
    const held = await takeSignInChangeLock({ db }, manager);
    vi.mocked(loadMfaContext).mockClear();

    expect(await outcomeOf('/passkey/delete-passkey')).toBe('SIGN_IN_CHANGE_IN_PROGRESS');
    expect(loadMfaContext).not.toHaveBeenCalled();

    await releaseSignInChangeLock({ db }, defined(held, 'the sign-in change lock'));
    // Whenever the change reads the user's MFA state, it holds the lock.
    const lockHeldWhileRead: (number | null)[] = [];
    vi.mocked(loadMfaContext).mockImplementationOnce(async (database, userId) => {
      lockHeldWhileRead.push(await hits(`sign-in-change:user:${userId}`));
      return realLoadMfaContext(database, userId);
    });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');
    expect(lockHeldWhileRead).toEqual([1]);
  });

  it("isn't taken by a request that can't take MFA away, which goes ahead while a change is made", async () => {
    const manager = await managerWithTwoPasskeys();
    const lockHeldWhileRead: (number | null)[] = [];
    vi.mocked(loadMfaContext).mockImplementationOnce(async (database, userId) => {
      lockHeldWhileRead.push(await hits(`sign-in-change:user:${userId}`));
      return realLoadMfaContext(database, userId);
    });

    // New backup codes are no such change (`signInChangeOf`): the checks run without the lock.
    expect(await outcomeOf('/two-factor/generate-backup-codes')).toBe('allowed');
    expect(lockHeldWhileRead).toEqual([null]);

    // Nor do they wait for one that holds it, and that one keeps it.
    const held = await takeSignInChangeLock({ db }, manager);
    expect(await outcomeOf('/two-factor/generate-backup-codes')).toBe('allowed');
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('SIGN_IN_CHANGE_IN_PROGRESS');
    await releaseSignInChangeLock({ db }, defined(held, 'the sign-in change lock'));
  });

  it('is given back when the change is refused', async () => {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);
    await signedIn(manager.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('MFA_REQUIRED_FOR_ROLE');

    await addPasskey(db, manager.id);

    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');
  });

  it("frees itself when a request never gives it back, and doesn't hold up other users", async () => {
    const manager = await managerWithTwoPasskeys();
    await beforeAuthRequest(request('/passkey/delete-passkey'));
    // Another user's change goes ahead meanwhile.
    await managerWithTwoPasskeys();
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');

    await signedIn(manager, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('SIGN_IN_CHANGE_IN_PROGRESS');
    await db
      .update(rateLimitBucket)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(rateLimitBucket.key, `sign-in-change:user:${manager}`));
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');
  });

  it('only gives back its own lock, not one taken after it expired', async () => {
    const manager = await staffActor(db, 'manager');
    const expired = await takeSignInChangeLock({ db }, manager.id);
    await db
      .update(rateLimitBucket)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(rateLimitBucket.key, `sign-in-change:user:${manager.id}`));
    const current = await takeSignInChangeLock({ db }, manager.id);
    expect(current).not.toBeNull();

    await releaseSignInChangeLock({ db }, defined(expired, 'the lock that expired'));

    expect(await takeSignInChangeLock({ db }, manager.id)).toBeNull();
    await releaseSignInChangeLock({ db }, defined(current, 'the current lock'));
    expect(await takeSignInChangeLock({ db }, manager.id)).not.toBeNull();
  });
});
