/**
 * @file Integration tests for loading the acting user's MFA state.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { company, membership, passkey, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { loadActor, touchLastActive } from './actor';
import { loadMfaStates } from './auth/mfa-state';
import {
  actorFor,
  addMember,
  addPasskey,
  addPassword,
  connectGitHub,
  createCompany,
  createStaffSettings,
  enableTwoFactor,
  memberActor,
  setupTestContext,
  staffActor,
  turnOffGitHubSignIn,
} from '../../tests/integration/helpers';

const { db } = setupTestContext();

beforeEach(async () => {
  await createStaffSettings(db);
});

describe('loadActor MFA state', () => {
  it('requires MFA for staff Admins and Managers and company Admins, not for anyone else', async () => {
    const testCompany = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const manager = await staffActor(db, 'manager');
    const support = await staffActor(db, 'support');
    const companyAdmin = await memberActor(db, testCompany.id, 'admin');
    const client = await memberActor(db, testCompany.id, 'client');

    expect(
      [admin, manager, support, companyAdmin, client].map((actor) => actor.mfaRequired),
    ).toEqual([true, true, false, true, false]);
    expect(companyAdmin.mfaRole).toBe('company_admin');
    expect(admin.mfaEnabled).toBe(false);
  });

  it('applies company Admin MFA only while the company is active, whatever the staff role', async () => {
    const active = await createCompany(db);
    const deactivated = await createCompany(db, { deactivated: true });
    const formerAdmin = await memberActor(db, deactivated.id, 'admin');
    expect(formerAdmin).toMatchObject({ mfaRole: null, mfaRequired: false });

    // A Support member who is also a company Admin gets the company Admin rules.
    const support = await staffActor(db, 'support');
    await addMember(db, active.id, support.id, 'admin');
    expect(await actorFor(db, support.id)).toMatchObject({
      platformRole: 'support',
      mfaRole: 'company_admin',
      mfaRequired: true,
    });
  });

  it('counts an authenticator app or a passkey as MFA, and email codes only below Manager', async () => {
    const withAuthenticator = await staffActor(db, 'platform_admin');
    await enableTwoFactor(db, withAuthenticator.id);

    const withPasskey = await staffActor(db, 'manager');
    await db.insert(passkey).values({
      userId: withPasskey.id,
      name: 'Work laptop',
      publicKey: 'test-public-key',
      credentialID: 'test-credential',
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: true,
    });

    const managerWithEmailCodes = await staffActor(db, 'manager');
    await enableTwoFactor(db, managerWithEmailCodes.id, 'email');
    const supportWithEmailCodes = await staffActor(db, 'support');
    await enableTwoFactor(db, supportWithEmailCodes.id, 'email');

    expect((await actorFor(db, withAuthenticator.id)).mfaEnabled).toBe(true);
    expect((await actorFor(db, withPasskey.id)).mfaEnabled).toBe(true);
    expect((await actorFor(db, managerWithEmailCodes.id)).mfaEnabled).toBe(false);
    expect((await actorFor(db, supportWithEmailCodes.id)).mfaEnabled).toBe(true);
  });

  it('brings the sign-in setup it judged, as loadMfaStates loads it', async () => {
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id);
    await addPassword(db, manager.id);

    const actor = await actorFor(db, manager.id);

    expect(actor.mfaState).toEqual((await loadMfaStates(db, [manager.id])).get(manager.id));
    expect(actor.mfaState).toMatchObject({ authenticator: true, hasPassword: true });
  });

  it('notices a second step that stops counting as MFA once a password is added', async () => {
    const admin = await staffActor(db, 'platform_admin');
    await connectGitHub(db, admin.id);
    expect(await actorFor(db, admin.id)).toMatchObject({
      mfaEnabled: true,
      canConfirmSessions: true,
    });
    await addPassword(db, admin.id);
    expect(await actorFor(db, admin.id)).toMatchObject({
      mfaEnabled: false,
      canConfirmSessions: true,
    });
  });

  it("doesn't count GitHub with 2FA, as MFA or a second step, while GitHub sign-in is off", async () => {
    const admin = await staffActor(db, 'platform_admin');
    await connectGitHub(db, admin.id);

    turnOffGitHubSignIn();

    expect(await actorFor(db, admin.id)).toMatchObject({
      mfaEnabled: false,
      mfaRequired: true,
      canConfirmSessions: false,
    });
  });

  it('only counts strong second factors of sessions for roles that require MFA', async () => {
    const manager = await staffActor(db, 'manager');
    const viaEmail = await loadActor(db, manager.id, {
      mfaVerified: true,
      mfaMethod: 'email_code',
    });
    const viaApp = await loadActor(db, manager.id, {
      mfaVerified: true,
      mfaMethod: 'authenticator',
    });
    expect(viaEmail?.sessionMfaVerified).toBe(false);
    expect(viaApp?.sessionMfaVerified).toBe(true);
  });

  it('decides whether an email-code session counts with the role the user has now', async () => {
    const testCompany = await createCompany(db);
    const client = await memberActor(db, testCompany.id, 'client');
    const viaEmail = { id: 'adiutor-tests-session', mfaVerified: true, mfaMethod: 'email_code' };
    /**
     * Loads the Client with their session, signed in with an email code.
     *
     * @returns Whether that session counts for them now.
     */
    const counts = async () => (await loadActor(db, client.id, viaEmail))?.sessionMfaVerified;

    expect(await counts()).toBe(true);

    await db.update(membership).set({ role: 'admin' }).where(eq(membership.userId, client.id));
    expect(await counts()).toBe(false);

    // Once the company is deactivated, they're no longer under the company Admin rules.
    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    expect(await counts()).toBe(true);
  });
});

describe('loadActor confirmation window', () => {
  /** Fifteen minutes: how long a confirmation allows changing sign-in methods. */
  const WINDOW_MS = 15 * 60_000;

  it('lets a session change sign-in methods until 15 minutes after its second factor', async () => {
    const support = await staffActor(db, 'support');
    const verifiedAt = new Date(Date.now() - 5 * 60_000);
    const confirmed = { mfaVerified: true, mfaMethod: 'authenticator' };

    const actor = await loadActor(db, support.id, { ...confirmed, mfaVerifiedAt: verifiedAt });
    // Better Auth's session data can carry the time as a string.
    const fromString = await loadActor(db, support.id, {
      ...confirmed,
      mfaVerifiedAt: verifiedAt.toISOString(),
    });

    expect(actor?.mfaConfirmedUntil).toEqual(new Date(verifiedAt.getTime() + WINDOW_MS));
    expect(fromString?.mfaConfirmedUntil).toEqual(new Date(verifiedAt.getTime() + WINDOW_MS));
  });

  it('has no window for a trusted device, an unconfirmed session or one without a time', async () => {
    const support = await staffActor(db, 'support');
    const now = new Date();

    const sessions = [
      { mfaVerified: true, mfaMethod: 'trusted_device', mfaVerifiedAt: now },
      { mfaVerified: false, mfaMethod: null, mfaVerifiedAt: now },
      { mfaVerified: true, mfaMethod: 'authenticator', mfaVerifiedAt: null },
      {},
    ];
    const actors = await Promise.all(sessions.map((found) => loadActor(db, support.id, found)));

    expect(actors.map((actor) => actor?.mfaConfirmedUntil)).toEqual([null, null, null, null]);
  });

  it('has no window for an email-code session of a role that requires MFA', async () => {
    const manager = await staffActor(db, 'manager');
    const support = await staffActor(db, 'support');
    const viaEmail = { mfaVerified: true, mfaMethod: 'email_code', mfaVerifiedAt: new Date() };

    expect((await loadActor(db, manager.id, viaEmail))?.mfaConfirmedUntil).toBeNull();
    expect((await loadActor(db, support.id, viaEmail))?.mfaConfirmedUntil).toEqual(
      new Date(viaEmail.mfaVerifiedAt.getTime() + WINDOW_MS),
    );
  });

  describe('of a session confirmed with GitHub', () => {
    /**
     * A session that just signed in with GitHub, whose account has 2FA.
     *
     * @returns The session's ID and MFA facts.
     */
    const viaGitHub = () => ({
      id: 'adiutor-tests-session',
      mfaVerified: true,
      mfaMethod: 'github',
      mfaVerifiedAt: new Date(),
    });

    it('opens the window when GitHub is the only strong step', async () => {
      const admin = await staffActor(db, 'platform_admin');
      await connectGitHub(db, admin.id);
      const session = viaGitHub();

      expect(await loadActor(db, admin.id, session)).toMatchObject({
        sessionMfaVerified: true,
        canConfirmSessions: true,
        mfaConfirmedUntil: new Date(session.mfaVerifiedAt.getTime() + WINDOW_MS),
      });
    });

    it('confirms the session but opens no window next to a passkey or an authenticator app', async () => {
      const withPasskey = await staffActor(db, 'platform_admin');
      await connectGitHub(db, withPasskey.id);
      await addPasskey(db, withPasskey.id);
      const withApp = await staffActor(db, 'support');
      await connectGitHub(db, withApp.id);
      await enableTwoFactor(db, withApp.id);

      const actors = await Promise.all(
        [withPasskey.id, withApp.id].map((userId) => loadActor(db, userId, viaGitHub())),
      );

      actors.forEach((actor) => {
        expect(actor).toMatchObject({
          sessionMfaVerified: true,
          canConfirmSessions: true,
          mfaConfirmedUntil: null,
        });
      });
      // The passkey itself still opens it.
      const viaPasskey = { ...viaGitHub(), mfaMethod: 'passkey' };
      expect((await loadActor(db, withPasskey.id, viaPasskey))?.mfaConfirmedUntil).toEqual(
        new Date(viaPasskey.mfaVerifiedAt.getTime() + WINDOW_MS),
      );
    });
  });
});

describe('loadActor sign-in time', () => {
  it('is the session’s, for the one-hour rule', async () => {
    const support = await staffActor(db, 'support');
    const createdAt = new Date(Date.now() - 30 * 60_000);

    const actor = await loadActor(db, support.id, { id: 'adiutor-tests-session', createdAt });
    // Better Auth's session data can carry the time as a string.
    const fromString = await loadActor(db, support.id, { createdAt: createdAt.toISOString() });

    expect(actor?.signedInAt).toEqual(createdAt);
    expect(fromString?.signedInAt).toEqual(createdAt);
  });

  it('is unknown outside a request', async () => {
    const support = await staffActor(db, 'support');

    expect((await loadActor(db, support.id))?.signedInAt).toBeNull();
    expect((await loadActor(db, support.id, { createdAt: null }))?.signedInAt).toBeNull();
  });
});

describe('loadActor for an unknown user', () => {
  it('gives null, though its queries all ran at once', async () => {
    expect(await loadActor(db, '01900000-0000-7000-8000-000000000000')).toBeNull();
  });
});

describe('touchLastActive', () => {
  it('records activity at most once a minute', async () => {
    const jane = await staffActor(db, 'support');
    await touchLastActive(db, jane.id);
    const first = firstRow(await db.select().from(user).where(eq(user.id, jane.id)), 'the user');
    expect(first.lastActiveAt).toBeInstanceOf(Date);

    await touchLastActive(db, jane.id);
    const again = firstRow(
      await db.select().from(user).where(eq(user.id, jane.id)),
      'the user again',
    );
    expect(again.lastActiveAt).toEqual(first.lastActiveAt);

    await db
      .update(user)
      .set({ lastActiveAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(user.id, jane.id));
    await touchLastActive(db, jane.id);
    const later = firstRow(
      await db.select().from(user).where(eq(user.id, jane.id)),
      'the user later',
    );
    expect(
      defined(later.lastActiveAt, 'the time the user was last active').getTime(),
    ).toBeGreaterThan(Date.now() - 10_000);
  });
});
