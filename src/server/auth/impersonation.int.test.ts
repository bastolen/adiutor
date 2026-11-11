/**
 * @file Integration tests for signing in as a user: starting it (the rules,
 * the strong MFA and confirmation it needs, the limit, the record and the
 * email), ending it, and the hourly job ending those that are over. Which
 * staff roles may start it at all is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { auditEvent, impersonation, session, user } from '@/db/schema';
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
  minutesAgo,
  setupTestContext,
  setUserLocale,
  staffActor,
} from '../../../tests/integration/helpers';
import { type Actor, loadActor } from '../actor';
import { ServiceError } from '../errors';
import { cleanUp } from '../jobs';
import { RATE_LIMITS } from '../rate-limit';
import { endFinishedImpersonations, endImpersonation, startImpersonation } from './impersonation';

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

    await expect(cleanUp(ctx)).resolves.toMatchObject({ impersonations: 1 });

    expect(await db.select().from(impersonation)).toHaveLength(0);
    expect((await endEvents())[0]).toMatchObject({
      actorUserId: staff.id,
      targetUserId: userId,
      details: { reason: 'session_ended' },
    });
  });
});
