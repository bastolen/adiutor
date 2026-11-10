/**
 * @file Integration tests for the audit log (`audit.ts`): recording events
 * with the request origin, and listing them for staff and for the user
 * themselves, against the test database.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, user } from '@/db/schema';

import {
  createCompany,
  createStaffSettings,
  setupTestContext,
  staffActor,
} from '../../tests/integration/helpers';
import type { Actor } from './actor';
import { listAuditEvents, listAuditLog, listOwnActivity, recordEvent } from './audit';

const { ctx, db } = setupTestContext();

let admin: Actor;
/** A company the events are about. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;

beforeEach(async () => {
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
  testCompany = await createCompany(db);
});

describe('audit log', () => {
  it('records events with the request origin and lists them newest first', async () => {
    const jane = await staffActor(db, 'support', 'jane@adiutor.test');
    const withRequest = {
      ...ctx,
      /**
       * A fixed request origin.
       *
       * @returns The IP address and browser.
       */
      requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'Firefox' }),
    };
    await recordEvent(withRequest, {
      action: 'role_changed',
      actorUserId: admin.id,
      targetUserId: jane.id,
      companyId: testCompany.id,
      details: { from: 'support', to: 'manager' },
    });
    await recordEvent(ctx, { action: 'sign_in', actorUserId: jane.id, targetUserId: jane.id });

    const events = await listAuditEvents(ctx, admin, { userId: jane.id });

    expect(events.map(({ action }) => action)).toEqual(['sign_in', 'role_changed']);
    expect(events[1]).toMatchObject({
      actor: { id: admin.id, email: 'admin@adiutor.test' },
      target: { id: jane.id },
      company: { id: testCompany.id },
      ip: '203.0.113.7',
      userAgent: 'Firefox',
      details: { from: 'support', to: 'manager' },
    });
  });
});

describe('audit log by user', () => {
  it('lists the newest events by or about the user, each once, within the limit', async () => {
    const jane = await staffActor(db, 'support', 'jane@adiutor.test');
    const sam = await staffActor(db, 'support', 'sam@adiutor.test');
    /**
     * A day in January 2026, for events in a known order.
     *
     * @param day - The day of the month.
     * @returns The date.
     */
    const on = (day: number) => new Date(Date.UTC(2026, 0, day));
    await db.insert(auditEvent).values([
      // By Jane only.
      { action: 'invitation_sent', actorUserId: jane.id, at: on(1) },
      // About Jane only.
      { action: 'role_changed', actorUserId: admin.id, targetUserId: jane.id, at: on(2) },
      // Someone else's.
      { action: 'sign_in', actorUserId: sam.id, targetUserId: sam.id, at: on(3) },
      // By and about Jane.
      { action: 'sign_in', actorUserId: jane.id, targetUserId: jane.id, at: on(4) },
      // By Jane, about Sam.
      { action: 'member_removed', actorUserId: jane.id, targetUserId: sam.id, at: on(5) },
    ]);

    /**
     * Lists Jane's events as the user page does.
     *
     * @param limit - How many.
     * @returns Their actions and days, newest first.
     */
    const janes = async (limit: number) =>
      (await listAuditEvents(ctx, admin, { userId: jane.id }, limit)).map(
        ({ action, at }) => `${action} ${at.getUTCDate()}`,
      );

    expect(await janes(50)).toEqual([
      'member_removed 5',
      'sign_in 4',
      'role_changed 2',
      'invitation_sent 1',
    ]);
    // The newest three of both kinds together, not the newest three of each.
    expect(await janes(3)).toEqual(['member_removed 5', 'sign_in 4', 'role_changed 2']);
  });
});

describe('own activity', () => {
  it('lists only events about the user themselves, newest first, without needing a permission', async () => {
    const jane = await staffActor(db, 'support', 'jane@adiutor.test');
    await recordEvent(ctx, { action: 'sign_in', actorUserId: jane.id, targetUserId: jane.id });
    // Something Jane did to someone else isn't about her account.
    await recordEvent(ctx, {
      action: 'role_changed',
      actorUserId: jane.id,
      targetUserId: admin.id,
      details: { from: 'support', to: 'manager' },
    });
    await recordEvent(ctx, {
      action: 'role_changed',
      actorUserId: admin.id,
      targetUserId: jane.id,
      companyId: testCompany.id,
      details: { from: 'manager', to: 'support' },
    });

    const activity = await listOwnActivity(ctx, jane);

    expect(activity.map(({ action }) => action)).toEqual(['role_changed', 'sign_in']);
    expect(activity[0]).toMatchObject({ actor: { id: admin.id }, company: { id: testCompany.id } });
  });

  it("shows where the user's own actions came from, and no one else's", async () => {
    const jane = await staffActor(db, 'support', 'jane@adiutor.test');
    const withRequest = {
      ...ctx,
      /**
       * A fixed request origin.
       *
       * @returns The IP address and browser.
       */
      requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'Firefox' }),
    };
    await recordEvent(withRequest, {
      action: 'sign_in',
      actorUserId: jane.id,
      targetUserId: jane.id,
    });
    // Anyone can type a wrong password for Jane's address; no one is signed in.
    await recordEvent(withRequest, {
      action: 'sign_in_failed',
      targetUserId: jane.id,
      details: { method: 'password', email: 'jane@adiutor.test' },
    });
    await recordEvent(withRequest, {
      action: 'role_changed',
      actorUserId: admin.id,
      targetUserId: jane.id,
      details: { from: 'manager', to: 'support' },
    });

    // Changed automatically during an admin's request (e.g. invitations revoked with a role).
    await recordEvent(withRequest, {
      action: 'invitation_revoked',
      targetUserId: jane.id,
      details: { automatic: true },
    });
    // Done by an account that was deleted since: the event keeps no actor.
    const leaver = await staffActor(db, 'platform_admin', 'leaver@adiutor.test');
    await recordEvent(withRequest, {
      action: 'mfa_reset',
      actorUserId: leaver.id,
      targetUserId: jane.id,
    });
    await db.delete(user).where(eq(user.id, leaver.id));

    const activity = await listOwnActivity(ctx, jane);

    expect(activity.map(({ action, ip, userAgent }) => ({ action, ip, userAgent }))).toEqual([
      { action: 'mfa_reset', ip: null, userAgent: null },
      { action: 'invitation_revoked', ip: null, userAgent: null },
      { action: 'role_changed', ip: null, userAgent: null },
      { action: 'sign_in_failed', ip: null, userAgent: null },
      { action: 'sign_in', ip: '203.0.113.7', userAgent: 'Firefox' },
    ]);
    // Staff with access to the audit log still see where the wrong password came from.
    const logged = await listAuditEvents(ctx, admin, { userId: jane.id });
    expect(logged.find(({ action }) => action === 'sign_in_failed')).toMatchObject({
      ip: '203.0.113.7',
      userAgent: 'Firefox',
    });
  });
});

describe('the whole audit log', () => {
  /**
   * Records an event at a fixed time.
   *
   * @param at - When it happened.
   * @param event - What happened, by whom, about whom and which company.
   * @param event.action - The event type.
   * @param event.actorUserId - Who did it.
   * @param event.targetUserId - Whom it was about.
   * @param event.companyId - Which company it was about.
   */
  async function eventAt(
    at: string,
    event: {
      action: 'sign_in' | 'role_changed' | 'company_updated' | 'passkey_added';
      actorUserId?: string;
      targetUserId?: string;
      companyId?: string;
    },
  ) {
    await db.insert(auditEvent).values({ ...event, at: new Date(at), details: {} });
  }

  it('is for staff with access to the audit log only', async () => {
    const support = await staffActor(db, 'support', 'support@adiutor.test');
    const manager = await staffActor(db, 'manager', 'manager@adiutor.test');

    await expect(listAuditLog(ctx, support)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listAuditLog(ctx, manager)).resolves.toMatchObject({ total: 0 });
  });

  it('lists every event by or about anyone, newest first, a page at a time', async () => {
    const jane = await staffActor(db, 'support', 'jane@adiutor.test');
    await eventAt('2026-11-01T10:00:00Z', { action: 'sign_in', actorUserId: jane.id });
    await eventAt('2026-11-02T10:00:00Z', {
      action: 'role_changed',
      actorUserId: admin.id,
      targetUserId: jane.id,
      companyId: testCompany.id,
    });
    await eventAt('2026-11-03T10:00:00Z', { action: 'company_updated', companyId: testCompany.id });

    const newest = await listAuditLog(ctx, admin);
    expect(newest.total).toBe(3);
    expect(newest.items.map(({ action }) => action)).toEqual([
      'company_updated',
      'role_changed',
      'sign_in',
    ]);
    expect(newest.items[1]).toMatchObject({
      actor: { id: admin.id },
      target: { id: jane.id },
      company: { id: testCompany.id },
    });

    const oldest = await listAuditLog(ctx, admin, { dir: 'asc' });
    expect(oldest.items.map(({ action }) => action)).toEqual([
      'sign_in',
      'role_changed',
      'company_updated',
    ]);
  });

  it('pages through more events than fit on a page, without repeating one', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        eventAt(`2026-11-01T10:${String(index).padStart(2, '0')}:00Z`, {
          action: 'sign_in',
          actorUserId: admin.id,
        }),
      ),
    );

    const first = await listAuditLog(ctx, admin, { size: 25 });
    const second = await listAuditLog(ctx, admin, { size: 25, page: 2 });

    expect(first).toMatchObject({ total: 30, page: 1 });
    expect(first.items).toHaveLength(25);
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items).toHaveLength(5);
    const ids = [...first.items, ...second.items].map(({ id }) => id);
    expect(new Set(ids).size).toBe(30);
  });

  it('finds events by the name or email of who acted or whom it was about, or the company', async () => {
    const jane = await staffActor(db, 'support', 'jane@adiutor.test');
    const sam = await staffActor(db, 'support', 'sam@adiutor.test');
    const renamed = await createCompany(db, { name: 'Adiutor Tests Renamed' });
    await eventAt('2026-11-01T10:00:00Z', { action: 'sign_in', actorUserId: jane.id });
    await eventAt('2026-11-02T10:00:00Z', {
      action: 'role_changed',
      actorUserId: admin.id,
      targetUserId: sam.id,
    });
    await eventAt('2026-11-03T10:00:00Z', { action: 'company_updated', companyId: renamed.id });

    /**
     * Searches the log.
     *
     * @param search - The text.
     * @returns The actions found, newest first.
     */
    const found = async (search: string) =>
      (await listAuditLog(ctx, admin, { search })).items.map(({ action }) => action);

    expect(await found('JANE@adiutor')).toEqual(['sign_in']);
    expect(await found('sam@')).toEqual(['role_changed']);
    expect(await found('admin@adiutor.test')).toEqual(['role_changed']);
    expect(await found('Renamed')).toEqual(['company_updated']);
    expect(await found('nobody')).toEqual([]);
    // LIKE wildcards are only text.
    expect(await found('%')).toEqual([]);
  });

  it('narrows to one group of event types', async () => {
    await eventAt('2026-11-01T10:00:00Z', { action: 'sign_in', actorUserId: admin.id });
    await eventAt('2026-11-02T10:00:00Z', { action: 'passkey_added', actorUserId: admin.id });
    await eventAt('2026-11-03T10:00:00Z', { action: 'company_updated', companyId: testCompany.id });

    const signIns = await listAuditLog(ctx, admin, { group: 'sign-ins' });
    const methods = await listAuditLog(ctx, admin, { group: 'sign-in-methods' });

    expect(signIns.items.map(({ action }) => action)).toEqual(['sign_in']);
    expect(methods.items.map(({ action }) => action)).toEqual(['passkey_added']);
  });

  it('narrows to a time range, from its start up to (not including) its end', async () => {
    await eventAt('2026-11-01T23:59:59Z', { action: 'sign_in', actorUserId: admin.id });
    await eventAt('2026-11-02T00:00:00Z', { action: 'passkey_added', actorUserId: admin.id });
    await eventAt('2026-11-02T23:59:59Z', { action: 'role_changed', actorUserId: admin.id });
    await eventAt('2026-11-03T00:00:00Z', { action: 'company_updated', companyId: testCompany.id });

    const page = await listAuditLog(ctx, admin, {
      start: new Date('2026-11-02T00:00:00Z'),
      end: new Date('2026-11-03T00:00:00Z'),
    });

    expect(page.items.map(({ action }) => action)).toEqual(['role_changed', 'passkey_added']);
    expect(page.total).toBe(2);
  });
});
