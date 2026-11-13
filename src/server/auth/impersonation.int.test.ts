/**
 * @file Integration tests for signing in as a user: starting it (the rules,
 * the strong MFA and confirmation it needs, the limit, the record and the
 * email), whom a request acts as while it lasts, the own-account changes it
 * refuses, ending it, and the hourly job ending those that are over. Which
 * staff roles may start it at all, and the refusal of every change in the
 * matrix, are in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { auditEvent, impersonation, membership, session, user } from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import type { PlatformRole } from '@/lib/authz/roles';
import { IMPERSONATION_REASON_MAX_LENGTH } from '@/lib/input-rules';

import {
  addMember,
  addPasskey,
  createCompany,
  createSession,
  createStaffSettings,
  createUser,
  enableTwoFactor,
  fillRateLimitBucket,
  later,
  minutesAgo,
  sendQueuedEmails,
  setupTestContext,
  setUserLocale,
  staffActor,
} from '../../../tests/integration/helpers';
import { type Actor, loadActor } from '../actor';
import { ServiceError } from '../errors';
import { runJobNow } from '../jobs';
import { deactivateOwnAccount } from '../people/user-admin';
import { RATE_LIMITS } from '../rate-limit';
import { changeOwnPassword, setFirstPassword } from './accounts';
import {
  actorSignedInAs,
  endFinishedImpersonations,
  endImpersonation,
  findSessionImpersonation,
  setStaffSignInAllowed,
  startImpersonation,
} from './impersonation';
import { revokeOtherOwnSessions } from './sessions';

const { ctx, db, sent } = setupTestContext();

/**
 * A staff member with a passkey, signed in with a session that confirmed with
 * a second step at a given time.
 *
 * @param role - Their staff role.
 * @param options - Options.
 * @param options.method - How the session confirmed; defaults to a passkey.
 * @param options.confirmedAt - When; defaults to now.
 * @returns The staff member as their request loads them.
 */
async function confirmedStaff(
  role: PlatformRole,
  { method = 'passkey', confirmedAt = new Date() }: { method?: MfaMethod; confirmedAt?: Date } = {},
): Promise<Actor> {
  const staff = await staffActor(db, role, `${role}@adiutor.test`);
  await db.update(user).set({ name: 'Sam Lee' }).where(eq(user.id, staff.id));
  await addPasskey(db, staff.id);
  const sessionId = await createSession(db, staff.id, {
    mfaMethod: method,
    mfaVerifiedAt: confirmedAt,
  });
  const loaded = await loadActor(db, staff.id, {
    id: sessionId,
    mfaVerified: true,
    mfaMethod: method,
    mfaVerifiedAt: confirmedAt,
  });
  if (!loaded) {
    throw new Error('No staff member');
  }
  return loaded;
}

/**
 * A company user with a role in a new company.
 *
 * @param role - Their role there.
 * @returns Their user ID.
 */
async function companyUser(role: 'admin' | 'client' | 'watcher' = 'client'): Promise<string> {
  const company = await createCompany(db, { name: 'Adiutor Tests' });
  const userId = await createUser(db, `${role}@adiutor.test`);
  await addMember(db, company.id, userId, role);
  return userId;
}

/**
 * Starts signing in as a user and expects it refused.
 *
 * @param actor - The staff member.
 * @param userId - The user.
 * @returns The error.
 */
async function refusal(actor: Actor, userId: string): Promise<ServiceError> {
  const error: unknown = await startImpersonation(ctx, actor, { userId }).catch(
    (caught: unknown) => caught,
  );
  if (!(error instanceof ServiceError)) {
    throw new Error(`Expected a refusal, got ${String(error)}`);
  }
  return error;
}

/**
 * Lists the `impersonation_ended` events, oldest first.
 *
 * @returns Their actor, target, time and details.
 */
async function endEvents() {
  return db
    .select({
      actorUserId: auditEvent.actorUserId,
      targetUserId: auditEvent.targetUserId,
      at: auditEvent.at,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .where(eq(auditEvent.action, 'impersonation_ended'))
    .orderBy(auditEvent.at);
}

describe('startImpersonation', () => {
  it('marks the session for 30 minutes, records it with the reason and emails the user', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await setUserLocale(db, userId, 'nl-NL');

    const { expiresAt } = await startImpersonation(ctx, staff, {
      userId,
      reason: '  Ticket 12: the Members page is empty ',
      returnTo: `/admin/users/${userId}#sign-in-as`,
    });

    const minutesLeft = (expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(29);
    expect(minutesLeft).toBeLessThanOrEqual(30);
    const [row] = await db.select().from(impersonation);
    expect(row).toMatchObject({
      sessionId: staff.sessionId,
      staffUserId: staff.id,
      userId,
      reason: 'Ticket 12: the Members page is empty',
      returnTo: `/admin/users/${userId}#sign-in-as`,
    });
    const [event] = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.action, 'impersonation_started'));
    expect(event).toMatchObject({
      actorUserId: staff.id,
      targetUserId: userId,
      details: { reason: 'Ticket 12: the Members page is empty' },
    });
    // In the user's language, naming the staff member and the staff, without a device.
    await sendQueuedEmails(ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('client@adiutor.test');
    expect(sent[0]?.subject).toBe('Sam Lee van Adiutor Tests heeft als jou ingelogd op Adiutor');
    expect(sent[0]?.text).not.toContain('Vanaf:');
  });

  it('stores no reason when none is given, and goes back to the user page from elsewhere', async () => {
    const staff = await confirmedStaff('manager');
    const userId = await companyUser();

    await startImpersonation(ctx, staff, {
      userId,
      reason: '   ',
      returnTo: 'https://adiutor.dev',
    });

    const [row] = await db.select().from(impersonation);
    expect(row?.reason).toBeNull();
    expect(row?.returnTo).toBe(`/admin/users/${userId}`);
    const [event] = await db
      .select({ details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'impersonation_started'));
    expect(event?.details).not.toHaveProperty('reason');
  });

  it('decides with the rules: Support signs in as Clients, not company Admins', async () => {
    const support = await confirmedStaff('support');
    const admin = await companyUser('admin');
    const client = await createUser(db, 'watcher@adiutor.test');

    expect((await refusal(support, admin)).key).toBe('errors.impersonation.companyAdmin');
    await expect(startImpersonation(ctx, support, { userId: client })).resolves.toBeDefined();
  });

  it('refuses a staff Admin, yourself and a deactivated account', async () => {
    const staff = await confirmedStaff('platform_admin');
    const otherAdmin = await staffActor(db, 'platform_admin', 'other-admin@adiutor.test');
    const deactivated = await companyUser();
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, deactivated));

    expect((await refusal(staff, otherAdmin.id)).key).toBe('errors.impersonation.staffAdmin');
    expect((await refusal(staff, staff.id)).key).toBe('errors.impersonation.self');
    expect((await refusal(staff, deactivated)).key).toBe('errors.impersonation.deactivated');
    expect(await db.select().from(impersonation)).toHaveLength(0);
    await sendQueuedEmails(ctx);
    expect(sent).toHaveLength(0);
  });

  it('decides with the rows as they are now, not as the request loaded them', async () => {
    const manager = await confirmedStaff('manager');
    const userId = await companyUser();
    // Made staff after the request loaded the Manager: Managers don't sign in as staff.
    await db.update(user).set({ platformRole: 'support' }).where(eq(user.id, userId));

    expect((await refusal(manager, userId)).key).toBe('errors.impersonation.staff');

    // And a Manager demoted meanwhile no longer may at all.
    await db.update(user).set({ platformRole: 'finance' }).where(eq(user.id, manager.id));
    await db.update(user).set({ platformRole: null }).where(eq(user.id, userId));
    expect((await refusal(manager, userId)).key).toBe('errors.forbidden');
  });

  it('needs strong MFA on the staff member’s account, whatever their role', async () => {
    const support = await staffActor(db, 'support', 'support@adiutor.test');
    await enableTwoFactor(db, support.id, 'email');
    const sessionId = await createSession(db, support.id, {
      mfaMethod: 'email_code',
      mfaVerifiedAt: new Date(),
    });
    const withEmailCodes = await loadActor(db, support.id, {
      id: sessionId,
      mfaVerified: true,
      mfaMethod: 'email_code',
      mfaVerifiedAt: new Date(),
    });
    const userId = await companyUser();

    expect(withEmailCodes?.mfaConfirmedUntil).not.toBeNull();
    expect((await refusal(withEmailCodes as Actor, userId)).key).toBe(
      'errors.impersonation.needsMfa',
    );
  });

  it('needs a confirmation with that strong step from the last 15 minutes', async () => {
    const stale = await confirmedStaff('platform_admin', { confirmedAt: minutesAgo(16) });
    const userId = await companyUser();

    const error = await refusal(stale, userId);

    expect(error.code).toBe('confirmation_required');
    expect(error.key).toBe('errors.impersonation.confirmationRequired');
  });

  it('needs a session, and one sign-in as someone at a time in it', async () => {
    const staff = await confirmedStaff('platform_admin');
    const first = await companyUser('client');
    const second = await createUser(db, 'second@adiutor.test');

    expect((await refusal({ ...staff, sessionId: null }, first)).code).toBe('forbidden');
    await startImpersonation(ctx, staff, { userId: first });
    const error = await refusal(staff, second);
    expect(error.code).toBe('conflict');
    expect(error.key).toBe('errors.impersonation.alreadyStarted');
  });

  it('is limited per staff member, before anything is checked further', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await fillRateLimitBucket(
      db,
      `impersonation:user:${staff.id}`,
      RATE_LIMITS.impersonationsPerUser.limit,
    );

    expect((await refusal(staff, userId)).code).toBe('rate_limited');
  });

  it('refuses a reason that is too long, or an unknown user', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();

    await expect(
      startImpersonation(ctx, staff, {
        userId,
        reason: 'a'.repeat(IMPERSONATION_REASON_MAX_LENGTH + 1),
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect((await refusal(staff, '01970000-0000-7000-8000-00000000dead')).code).toBe('not_found');
  });
});

describe('actorSignedInAs', () => {
  /**
   * A staff member signed in as a company user, as the request finds it.
   *
   * @param role - The staff member's role.
   * @param target - The user's company role.
   * @returns The staff member, the user and the session's sign-in as them.
   */
  async function signedIn(
    role: PlatformRole = 'platform_admin',
    target: 'admin' | 'client' = 'client',
  ) {
    const staff = await confirmedStaff(role);
    const userId = await companyUser(target);
    await startImpersonation(ctx, staff, { userId, returnTo: `/admin/users/${userId}` });
    const found = await findSessionImpersonation(db, staff.sessionId ?? '');
    if (!found) {
      throw new Error('Not signed in as the user');
    }
    return { staff, userId, found };
  }

  it('acts as the user, without the staff member’s session', async () => {
    const { staff, userId, found } = await signedIn();

    const outcome = await actorSignedInAs(db, staff, found);

    expect(outcome).toMatchObject({
      actor: {
        id: userId,
        email: 'client@adiutor.test',
        sessionId: null,
        sessionMfaVerified: false,
        mfaConfirmedUntil: null,
        signedInAt: null,
        signedInAs: {
          staffId: staff.id,
          staffName: 'Sam Lee',
          endsAt: found.expiresAt,
          returnTo: `/admin/users/${userId}`,
          // The staff Admin's own, which decide what the user's account pages show.
          staffPermissions: expect.arrayContaining(['users:manage', 'audit:view']),
        },
      },
    });
  });

  it('ends once its time is up, which reading it still finds', async () => {
    const { staff, found } = await signedIn();
    await db.update(impersonation).set({ expiresAt: minutesAgo(1) });

    const expired = await findSessionImpersonation(db, staff.sessionId ?? '');
    expect(expired).not.toBeNull();
    await expect(actorSignedInAs(db, staff, expired ?? found)).resolves.toEqual({
      end: 'expired',
    });
  });

  it('ends when the staff member may no longer do it', async () => {
    const { staff, found } = await signedIn('manager');
    // Demoted to Finance, as the next request loads them.
    await db.update(user).set({ platformRole: 'finance' }).where(eq(user.id, staff.id));
    const demoted = await loadActor(db, staff.id, {
      id: staff.sessionId ?? undefined,
      mfaVerified: true,
      mfaMethod: 'passkey',
      mfaVerifiedAt: new Date(),
    });

    await expect(actorSignedInAs(db, demoted as Actor, found)).resolves.toEqual({
      end: 'no_longer_allowed',
    });
    // Or without strong MFA on their account any more.
    await expect(actorSignedInAs(db, { ...staff, strongMfa: false }, found)).resolves.toEqual({
      end: 'no_longer_allowed',
    });
  });

  it('ends when the user is deactivated, or out of the staff member’s reach', async () => {
    const support = await signedIn('support');
    // Made Admin of their company: Support doesn't sign in as company Admins.
    await db.update(membership).set({ role: 'admin' }).where(eq(membership.userId, support.userId));
    await expect(actorSignedInAs(db, support.staff, support.found)).resolves.toEqual({
      end: 'no_longer_allowed',
    });

    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, support.userId));
    await expect(actorSignedInAs(db, support.staff, support.found)).resolves.toEqual({
      end: 'no_longer_allowed',
    });
  });
});

describe('setStaffSignInAllowed', () => {
  it('turns sign-ins by staff off and on, recording each change once', async () => {
    const userId = await companyUser();
    const jane = await loadActor(db, userId);
    if (!jane) {
      throw new Error('No user');
    }

    await expect(setStaffSignInAllowed(ctx, jane, false)).resolves.toBe(true);
    await expect(setStaffSignInAllowed(ctx, jane, false)).resolves.toBe(false);
    expect((await loadActor(db, userId))?.allowStaffSignIn).toBe(false);
    await expect(setStaffSignInAllowed(ctx, jane, true)).resolves.toBe(true);
    expect((await loadActor(db, userId))?.allowStaffSignIn).toBe(true);

    const events = await db
      .select({ action: auditEvent.action, actorUserId: auditEvent.actorUserId })
      .from(auditEvent)
      .orderBy(auditEvent.at);
    expect(events).toEqual([
      { action: 'staff_sign_in_turned_off', actorUserId: userId },
      { action: 'staff_sign_in_turned_on', actorUserId: userId },
    ]);
  });

  it('keeps staff out: no start, and one under way ends', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await startImpersonation(ctx, staff, { userId });
    const found = await findSessionImpersonation(db, staff.sessionId ?? '');
    const jane = await loadActor(db, userId);
    if (!found || !jane) {
      throw new Error('Not signed in as the user');
    }

    await setStaffSignInAllowed(ctx, jane, false);

    await expect(actorSignedInAs(db, staff, found)).resolves.toEqual({ end: 'no_longer_allowed' });
    await endImpersonation(ctx, staff.sessionId ?? '', 'no_longer_allowed');
    expect((await refusal(staff, userId)).key).toBe('errors.impersonation.optedOut');
  });
});

describe('while signed in as someone', () => {
  it('refuses the user’s own account changes, before anything is checked or changed', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await startImpersonation(ctx, staff, { userId });
    const found = await findSessionImpersonation(db, staff.sessionId ?? '');
    const outcome = found ? await actorSignedInAs(db, staff, found) : null;
    if (!outcome || !('actor' in outcome)) {
      throw new Error('Not signed in as the user');
    }
    const asUser = outcome.actor;
    /** A change that must not happen. */
    const neverCalled = async () => {
      throw new Error('Changed while signed in as someone');
    };

    const changes = [
      changeOwnPassword(ctx, asUser, neverCalled),
      setFirstPassword(ctx, asUser, neverCalled),
      revokeOtherOwnSessions(ctx, asUser),
      deactivateOwnAccount(ctx, asUser, ''),
      // Nor turn sign-ins by staff off (or on) for them.
      setStaffSignInAllowed(ctx, asUser, false),
      // Nor a sign-in as someone else from the user's view.
      startImpersonation(ctx, asUser, { userId: staff.id }),
    ];
    const errors = await Promise.all(changes.map((change) => change.catch((error) => error)));

    errors.forEach((error) => {
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ code: 'signed_in_as', key: 'errors.impersonation.changesOff' });
    });
    expect((await db.select().from(user).where(eq(user.id, userId)))[0]?.deactivatedAt).toBeNull();
  });
});

describe('endImpersonation', () => {
  it('ends it, records why, and gives where to go back to; only once', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await startImpersonation(ctx, staff, { userId, returnTo: '/admin/users?page=2' });
    const sessionId = staff.sessionId ?? '';

    await expect(endImpersonation(ctx, sessionId, 'stopped')).resolves.toEqual({
      userId,
      returnTo: '/admin/users?page=2',
    });
    await expect(endImpersonation(ctx, sessionId, 'stopped')).resolves.toBeNull();

    expect(await db.select().from(impersonation)).toHaveLength(0);
    const events = await endEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: staff.id,
      targetUserId: userId,
      details: { reason: 'stopped' },
    });
  });
});

describe('endFinishedImpersonations', () => {
  it('ends those whose time is up, recorded at that moment, and leaves the rest', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await startImpersonation(ctx, staff, { userId });
    const expiredAt = minutesAgo(5);
    await db.update(impersonation).set({ expiresAt: expiredAt });
    const other = await confirmedStaff('manager');
    await startImpersonation(ctx, other, { userId });

    await expect(endFinishedImpersonations(ctx)).resolves.toBe(1);

    const left = await db.select({ staffUserId: impersonation.staffUserId }).from(impersonation);
    expect(left).toEqual([{ staffUserId: other.id }]);
    const events = await endEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorUserId: staff.id, details: { reason: 'expired' } });
    expect(events[0]?.at).toEqual(expiredAt);
  });

  it('ends those whose staff session is gone, in the hourly clean-up', async () => {
    const staff = await confirmedStaff('platform_admin');
    const userId = await companyUser();
    await startImpersonation(ctx, staff, { userId });
    // Signing out deletes the session; the row stays, without it.
    await db.delete(session).where(eq(session.id, staff.sessionId ?? ''));
    expect(await db.select({ sessionId: impersonation.sessionId }).from(impersonation)).toEqual([
      { sessionId: null },
    ]);

    await expect(
      runJobNow(ctx, 'finished-sign-ins-as-users', {
        trigger: 'cli',
        deadline: later,
      }),
    ).resolves.toMatchObject({ summary: { ended: 1 } });

    expect(await db.select().from(impersonation)).toHaveLength(0);
    expect((await endEvents())[0]).toMatchObject({
      actorUserId: staff.id,
      targetUserId: userId,
      details: { reason: 'session_ended' },
    });
  });
});
