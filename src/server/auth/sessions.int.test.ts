/**
 * @file Integration tests for signing out your own devices (which also
 * forgets the devices you trusted at the code step, and is recorded), and
 * everyone or one user from the command line, against the test database.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { session, verification } from '@/db/schema';

import {
  actorFor,
  createSession,
  createUser,
  setupTestContext,
  sendQueuedEmails,
  auditEvents,
} from '../../../tests/integration/helpers';
import { revokeAllSessions, revokeOtherOwnSessions, revokeOwnSession } from './sessions';

const { ctx, db, sent } = setupTestContext();

/**
 * Lists a user's session IDs.
 *
 * @param userId - The user.
 * @returns The IDs.
 */
async function sessionIds(userId: string) {
  const rows = await db.select({ id: session.id }).from(session).where(eq(session.userId, userId));
  return rows.map(({ id }) => id).sort();
}

/**
 * Stores a device a user trusted at the code step, as Better Auth does.
 *
 * @param userId - The user.
 * @param name - Part of its identifier.
 */
const trustDevice = async (userId: string, name: string): Promise<void> => {
  await db.insert(verification).values({
    identifier: `trust-device-${name}`,
    value: userId,
    expiresAt: new Date(Date.now() + 1e6),
  });
};

/**
 * Lists the trusted devices (and other verification rows) left.
 *
 * @returns Their identifiers.
 */
const trustedDevices = async () =>
  (await db.select({ identifier: verification.identifier }).from(verification))
    .map(({ identifier }) => identifier)
    .sort();

describe('own sessions', () => {
  it('signs out another device, but not this one or someone else’s', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    const current = await createSession(db, jane);
    const other = await createSession(db, jane);
    const samSession = await createSession(db, sam);
    const actor = { ...(await actorFor(db, jane)), sessionId: current };

    await expect(revokeOwnSession(ctx, actor, current)).rejects.toMatchObject({ code: 'invalid' });
    await expect(revokeOwnSession(ctx, actor, samSession)).rejects.toMatchObject({
      code: 'not_found',
    });
    // The refused attempts recorded nothing.
    expect(await auditEvents(db)).toEqual([]);
    await revokeOwnSession(ctx, actor, other);

    expect(await sessionIds(jane)).toEqual([current]);
    expect(await sessionIds(sam)).toEqual([samSession]);
    expect(await auditEvents(db, { fields: ['action', 'actorUserId', 'targetUserId'] })).toEqual([
      { action: 'session_revoked', actorUserId: jane, targetUserId: jane },
    ]);
  });

  it('forgets every device the user trusted when signing out another device, and no one else’s', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    const current = await createSession(db, jane);
    const other = await createSession(db, jane);
    const samSession = await createSession(db, sam);
    await trustDevice(jane, 'lost-laptop');
    await trustDevice(jane, 'this-browser');
    await trustDevice(sam, 'phone');
    const actor = { ...(await actorFor(db, jane)), sessionId: current };

    // A refused sign-out forgets nothing.
    await expect(revokeOwnSession(ctx, actor, samSession)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await trustedDevices()).toEqual([
      'trust-device-lost-laptop',
      'trust-device-phone',
      'trust-device-this-browser',
    ]);

    await revokeOwnSession(ctx, actor, other);

    // A session doesn't say which trusted device is its browser's, so all of Jane's go.
    expect(await trustedDevices()).toEqual(['trust-device-phone']);
  });

  it('signs out every other device', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const current = await createSession(db, jane);
    await createSession(db, jane);
    await createSession(db, jane);
    const actor = { ...(await actorFor(db, jane)), sessionId: current };

    await expect(revokeOtherOwnSessions(ctx, actor)).resolves.toBe(2);
    expect(await sessionIds(jane)).toEqual([current]);
  });

  it('forgets every device the user trusted when signing out every other device, and no one else’s', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    const current = await createSession(db, jane);
    await createSession(db, jane);
    await trustDevice(jane, 'lost-laptop');
    await trustDevice(jane, 'this-browser');
    await trustDevice(sam, 'phone');
    await db
      .insert(verification)
      .values({ identifier: 'sign-in-link', value: jane, expiresAt: new Date(Date.now() + 1e6) });
    const actor = { ...(await actorFor(db, jane)), sessionId: current };

    await revokeOtherOwnSessions(ctx, actor);

    // Other verification rows of the user, such as a sign-in link, stay.
    expect(await trustedDevices()).toEqual(['sign-in-link', 'trust-device-phone']);
  });
});

describe('signing out from the command line', () => {
  it('signs everyone out and forgets trusted devices, recording it without emailing anyone', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    await createSession(db, jane);
    await createSession(db, jane);
    await createSession(db, sam);
    await trustDevice(jane, 'laptop');
    await trustDevice(sam, 'phone');
    await db
      .insert(verification)
      .values({ identifier: 'sign-in-link', value: 'x', expiresAt: new Date(Date.now() + 1e6) });

    await expect(revokeAllSessions(ctx)).resolves.toEqual({
      count: 3,
      email: null,
      noticeQueued: false,
    });

    expect(await db.select().from(session)).toEqual([]);
    expect(await trustedDevices()).toEqual(['sign-in-link']);
    expect(await auditEvents(db, { fields: ['action', 'targetUserId', 'details'] })).toEqual([
      {
        action: 'sessions_revoked',
        targetUserId: null,
        details: { commandLine: true, count: 3, everyone: true },
      },
    ]);
    expect(sent).toEqual([]);
  });

  it('signs one user out by address, and tells them', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    await createSession(db, jane);
    await createSession(db, jane);
    const samSession = await createSession(db, sam);
    await trustDevice(jane, 'stolen');
    await trustDevice(sam, 'phone');

    await expect(revokeAllSessions(ctx, { email: ' Jane@Adiutor.test ' })).resolves.toEqual({
      count: 2,
      email: 'jane@adiutor.test',
      noticeQueued: true,
    });
    await sendQueuedEmails(ctx);

    expect(await sessionIds(jane)).toEqual([]);
    expect(await sessionIds(sam)).toEqual([samSession]);
    expect(await trustedDevices()).toEqual(['trust-device-phone']);
    expect(await auditEvents(db, { fields: ['targetUserId', 'details'] })).toEqual([
      { targetUserId: jane, details: { commandLine: true, count: 2 } },
    ]);
    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'jane@adiutor.test', subject: 'You were signed out of Adiutor' },
    ]);
  });

  it('refuses an empty address or one without an account, ending nothing', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const janeSession = await createSession(db, jane);

    await expect(revokeAllSessions(ctx, { email: 'nobody@adiutor.test' })).rejects.toMatchObject({
      code: 'not_found',
    });
    // Never everyone by mistake, e.g. from an empty variable.
    await expect(revokeAllSessions(ctx, { email: '  ' })).rejects.toMatchObject({
      code: 'invalid',
    });

    expect(await sessionIds(jane)).toEqual([janeSession]);
    expect(await auditEvents(db)).toEqual([]);
  });
});
