/**
 * @file Integration tests for deactivating your own account
 * (`deactivateOwnAccount`): a recent confirmation or sign-in, the last-Admin
 * refusal before the password, and the limit on wrong passwords, against the
 * test database.
 */
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, auditEvent, rateLimitBucket, session, user, verification } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { deactivateOwnAccount } from '.';
import {
  addMember,
  createSession,
  createUser,
  enableTwoFactor,
  inSequence,
  sendQueuedEmails,
  minutesAgo,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import {
  actionsAbout,
  admin,
  ctx,
  db,
  fromKnownDevice,
  jane,
  sent,
  signedIn,
  testCompany,
} from './test-helpers';

describe('deactivateOwnAccount', () => {
  /** Jane's password in these tests. */
  const PASSWORD = 'correct horse battery';

  /**
   * Gives a user a password, as Better Auth stores it.
   *
   * @param userId - The user.
   */
  async function givePassword(userId: string): Promise<void> {
    await db.insert(account).values({
      userId,
      accountId: userId,
      providerId: 'credential',
      password: await hashPassword(PASSWORD),
    });
  }

  /**
   * Reads when a user was deactivated.
   *
   * @param userId - The user.
   * @returns The time, or `null` while they're active.
   */
  async function deactivatedAt(userId: string): Promise<Date | null> {
    const found = firstRow(
      await db.select({ deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, userId)),
      'the user',
    );
    return found.deactivatedAt;
  }

  /**
   * Tries to deactivate a number of times, one after another.
   *
   * @param times - How many times.
   * @param actor - The signed-in user.
   * @param password - The password typed each time.
   * @returns How each ended: `deactivated` or the service error's code.
   */
  async function attempts(times: number, actor: Actor, password: string): Promise<string[]> {
    return inSequence(Array.from({ length: times }), () =>
      deactivateOwnAccount(ctx, actor, password).then(
        () => 'deactivated',
        (error: { code: string }) => error.code,
      ),
    );
  }

  it('checks the password, then deactivates, signs out and forgets trusted devices', async () => {
    await givePassword(jane);
    await createSession(db, jane);
    await db.insert(verification).values([
      { identifier: 'trust-device-own', value: jane, expiresAt: new Date(Date.now() + 1e6) },
      {
        identifier: 'trust-device-someone-else',
        value: admin.id,
        expiresAt: new Date(Date.now() + 1e6),
      },
    ]);
    // With a password, the sign-in may be of any age.
    const actor = await signedIn(jane, { signedInAt: minutesAgo(3 * 24 * 60) });

    await expect(deactivateOwnAccount(ctx, actor, 'wrong')).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.wrongPassword.deactivate',
    });
    expect(await deactivatedAt(jane)).toBeNull();
    await deactivateOwnAccount(ctx, actor, PASSWORD);

    expect(await deactivatedAt(jane)).toBeInstanceOf(Date);
    expect(await db.select().from(session).where(eq(session.userId, jane))).toEqual([]);
    expect((await db.select().from(verification)).map((row) => row.identifier)).toEqual([
      'trust-device-someone-else',
    ]);
    await sendQueuedEmails(ctx);
    expect(sent.map((email) => email.subject)).toEqual(['Your Adiutor account was deactivated']);
    expect(await actionsAbout(jane)).toEqual(['password_check_failed', 'account_deactivated']);
    const [wrong] = await db
      .select({ actorUserId: auditEvent.actorUserId, details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'password_check_failed'));
    expect(wrong).toEqual({ actorUserId: jane, details: { purpose: 'deactivate' } });
  });

  it('names the device and IP address in the email: it was their own change', async () => {
    await givePassword(jane);
    await deactivateOwnAccount(fromKnownDevice, await signedIn(jane), PASSWORD);

    await sendQueuedEmails(ctx);
    expect(sent).toHaveLength(1);
    const notice = defined(sent[0], 'the notice email');
    expect(notice.text).toContain('Firefox on Windows');
    expect(notice.text).toContain('203.0.113.9');
  });

  it('refuses the only staff Admin', async () => {
    await expect(deactivateOwnAccount(ctx, admin, '')).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.soleAdmin.self.staff',
    });
  });

  it("refuses a company's only Admin the same way with a right or a wrong password", async () => {
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, testCompany.id, owner, 'admin');
    await givePassword(owner);
    const actor = await signedIn(owner);

    const refusals = await inSequence([PASSWORD, 'wrong', PASSWORD], (password) =>
      deactivateOwnAccount(ctx, actor, password).catch((error: unknown) => error),
    );

    expect(refusals).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          code: 'conflict',
          key: 'errors.soleAdmin.self.companies',
          values: { companies: ['Adiutor Tests Client'] },
        }),
      ),
    );
    // The password was never checked: nothing counted or recorded, and the account stays.
    expect(await db.select().from(rateLimitBucket)).toEqual([]);
    expect(await actionsAbout(owner)).toEqual([]);
    expect(await deactivatedAt(owner)).toBeNull();
  });

  it('limits wrong passwords per user, refusing even a right one after five', async () => {
    await givePassword(jane);
    const actor = await signedIn(jane);

    expect(await attempts(5, actor, 'wrong')).toEqual(Array.from({ length: 5 }, () => 'invalid'));
    await expect(deactivateOwnAccount(ctx, actor, PASSWORD)).rejects.toMatchObject({
      code: 'rate_limited',
      key: 'errors.tooManyAttempts',
      values: { minutes: expect.any(Number) },
    });

    expect(await deactivatedAt(jane)).toBeNull();
    expect(await actionsAbout(jane)).toEqual(
      Array.from({ length: 5 }, () => 'password_check_failed'),
    );
  });

  it('needs a recent confirmation when the account has a second step', async () => {
    await enableTwoFactor(db, jane);

    // Not confirmed, or confirmed too long ago.
    await inSequence([null, minutesAgo(16)], async (confirmedAt) =>
      expect(
        deactivateOwnAccount(ctx, await signedIn(jane, { confirmedAt }), ''),
      ).rejects.toMatchObject({ code: 'forbidden', key: 'errors.signIn.mfaVerificationRequired' }),
    );
    expect(await deactivatedAt(jane)).toBeNull();

    // Confirmed just now, it goes ahead without a password, whenever the session signed in.
    await deactivateOwnAccount(
      ctx,
      await signedIn(jane, { confirmedAt: new Date(), signedInAt: minutesAgo(3 * 60) }),
      '',
    );
    expect(await deactivatedAt(jane)).toBeInstanceOf(Date);
  });

  it('needs a sign-in from the last hour without a password or a second step', async () => {
    // Signed in too long ago, or at an unknown time.
    await inSequence([minutesAgo(61), null], async (signedInAt) =>
      expect(
        deactivateOwnAccount(ctx, await signedIn(jane, { signedInAt }), ''),
      ).rejects.toMatchObject({ code: 'forbidden', key: 'errors.signIn.sessionNotFresh' }),
    );
    expect(await deactivatedAt(jane)).toBeNull();

    await deactivateOwnAccount(ctx, await signedIn(jane, { signedInAt: minutesAgo(59) }), '');
    expect(await deactivatedAt(jane)).toBeInstanceOf(Date);
    expect(await actionsAbout(jane)).toEqual(['account_deactivated']);
  });
});
