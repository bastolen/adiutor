/**
 * @file Integration tests for the background jobs, against the test
 * database.
 */
import { eq, isNull, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  account,
  appError,
  auditEvent,
  company,
  invitation,
  rateLimitBucket,
  session,
  verification,
} from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import type { Email } from '@/lib/email';
import { hashToken } from '@/lib/sign-in/tokens';

import type { Actor } from './actor';
import { cleanUp, sendInvitationReminders } from './jobs';
import { inviteByEmail } from './people/invitations';
import {
  addMember,
  createCompany,
  createSession,
  createUser,
  memberActor,
  setupTestContext,
  staffActor,
  tokenFrom,
} from '../../tests/integration/helpers';

const { ctx, db, sent } = setupTestContext();

/** Shared fixtures, recreated before each test. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;
let companyAdmin: Actor;

beforeEach(async () => {
  testCompany = await createCompany(db, { name: 'Adiutor Tests Client' });
  companyAdmin = await memberActor(db, testCompany.id, 'admin', 'boss@adiutor.test');
});

describe('cleanUp', () => {
  it('removes expired values, sessions, rate-limit windows and old audit events only', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await db.insert(verification).values([
      { identifier: 'old', value: 'x', expiresAt: past },
      { identifier: 'new', value: 'x', expiresAt: future },
    ]);
    await createSession(db, jane, { expiresAt: past });
    const kept = await createSession(db, jane);
    await db.insert(rateLimitBucket).values([
      { key: 'old', count: 1, resetAt: past },
      { key: 'new', count: 1, resetAt: future },
    ]);
    await db
      .insert(auditEvent)
      .values([{ action: 'sign_in', at: sql`now() - interval '400 days'` }, { action: 'sign_in' }]);

    await expect(cleanUp(ctx)).resolves.toEqual({
      verifications: 1,
      sessions: 1,
      rateLimits: 1,
      auditEvents: 1,
      signInErrors: 0,
      appErrors: 0,
      providerTokens: 0,
    });
    expect((await db.select().from(session)).map(({ id }) => id)).toEqual([kept]);
    expect(await db.select().from(verification)).toHaveLength(1);
    expect(await db.select().from(auditEvent)).toHaveLength(1);
  });

  it('removes errors in the app after 7 days', async () => {
    await db.insert(appError).values([
      {
        reference: 'OLD2-OLD2',
        source: 'server',
        createdAt: sql`now() - interval '8 days'`,
      },
      { reference: 'NEW2-NEW2', source: 'browser', createdAt: sql`now() - interval '6 days'` },
    ]);

    await expect(cleanUp(ctx)).resolves.toMatchObject({ appErrors: 1 });

    expect(
      (await db.select({ reference: appError.reference }).from(appError)).map(
        ({ reference }) => reference,
      ),
    ).toEqual(['NEW2-NEW2']);
  });

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

    await expect(cleanUp(ctx)).resolves.toMatchObject({ providerTokens: 1 });

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

describe('sendInvitationReminders', () => {
  /**
   * Moves an invitation's dates, as if it were sent earlier.
   *
   * @param email - The invited address.
   * @param expiresIn - SQL interval until it expires, e.g. `'1 day'`.
   */
  async function age(email: string, expiresIn: string) {
    await db
      .update(invitation)
      .set({
        createdAt: sql`now() - interval '5 days'`,
        expiresAt: sql`now() + ${expiresIn}::interval`,
      })
      .where(eq(invitation.email, email));
  }

  it('reminds once, shortly before expiry, with a new working link', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'soon@adiutor.test',
      role: 'client',
    });
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'later@adiutor.test',
      role: 'client',
    });
    await age('soon@adiutor.test', '1 day');
    await age('later@adiutor.test', '4 days');
    sent.length = 0;

    await expect(sendInvitationReminders(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
    await expect(sendInvitationReminders(ctx)).resolves.toEqual({ sent: 0, failed: 0 });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'soon@adiutor.test',
      subject: 'Reminder: join Adiutor Tests Client on Adiutor',
    });
    const reminded = firstRow(
      await db.select().from(invitation).where(eq(invitation.email, 'soon@adiutor.test')),
      'the invitation',
    );
    expect(reminded.tokenHash).toBe(hashToken(tokenFrom(defined(sent[0], 'the reminder email'))));
    expect(reminded.reminderSentAt).toBeInstanceOf(Date);
  });

  it('skips fresh, revoked and deactivated-company invitations, but not a due one beside them', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'fresh@adiutor.test',
      role: 'client',
    });
    await db
      .update(invitation)
      .set({ expiresAt: sql`now() + interval '1 day'` })
      .where(eq(invitation.email, 'fresh@adiutor.test'));
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'revoked@adiutor.test',
      role: 'client',
    });
    await age('revoked@adiutor.test', '1 day');
    await db
      .update(invitation)
      .set({ revokedAt: sql`now()` })
      .where(eq(invitation.email, 'revoked@adiutor.test'));
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'due@adiutor.test',
      role: 'client',
    });
    await age('due@adiutor.test', '1 day');
    // Just as due, but in its own company, which is deactivated after it was sent.
    const paused = await createCompany(db, { name: 'Adiutor Tests Paused' });
    const pausedAdmin = await memberActor(db, paused.id, 'admin', 'paused-boss@adiutor.test');
    await inviteByEmail(ctx, pausedAdmin, {
      companyId: paused.id,
      email: 'paused@adiutor.test',
      role: 'client',
    });
    await age('paused@adiutor.test', '1 day');
    await db
      .update(company)
      .set({ deactivatedAt: sql`now()` })
      .where(eq(company.id, paused.id));
    sent.length = 0;

    // Only the due invitation of the active company: each other one has a single reason to skip.
    await expect(sendInvitationReminders(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(sent.map(({ to }) => to)).toEqual(['due@adiutor.test']);
  });

  it('reminds staff invitations too, which have no company', async () => {
    const staffAdmin = await staffActor(db, 'platform_admin', 'staff-boss@adiutor.test');
    await inviteByEmail(ctx, staffAdmin, {
      companyId: null,
      email: 'new.staff@adiutor.test',
      role: 'support',
    });
    await age('new.staff@adiutor.test', '1 day');
    sent.length = 0;

    await expect(sendInvitationReminders(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    // Without staff settings, the staff go by the fallback name.
    expect(sent[0]).toMatchObject({
      to: 'new.staff@adiutor.test',
      subject: 'Reminder: join Adiutor on Adiutor',
    });
  });

  it('skips addresses that joined some other way meanwhile, keeping their invitations', async () => {
    const staffAdmin = await staffActor(db, 'platform_admin', 'staff-boss@adiutor.test');
    const other = await createCompany(db, { name: 'Adiutor Tests Other' });
    /**
     * Invites an address and ages the invitation until its reminder is due.
     *
     * @param email - The address.
     * @param companyId - The company, or `null` for the staff.
     * @param role - The role.
     */
    const dueInvitation = async (email: string, companyId: string | null, role: string) => {
      await inviteByEmail(ctx, companyId ? companyAdmin : staffAdmin, { companyId, email, role });
      await age(email, '1 day');
    };
    await dueInvitation('member@adiutor.test', testCompany.id, 'admin');
    await dueInvitation('elsewhere@adiutor.test', testCompany.id, 'client');
    await dueInvitation('support@adiutor.test', testCompany.id, 'client');
    await dueInvitation('staffer@adiutor.test', null, 'manager');
    // Then they got in another way: added to the company directly, given a staff role.
    await addMember(db, testCompany.id, await createUser(db, 'member@adiutor.test'), 'watcher');
    // A member of another company, or on the staff, isn't a member of this one.
    await addMember(db, other.id, await createUser(db, 'elsewhere@adiutor.test'), 'client');
    await staffActor(db, 'support', 'support@adiutor.test');
    await staffActor(db, 'support', 'staffer@adiutor.test');
    sent.length = 0;

    await expect(sendInvitationReminders(ctx)).resolves.toEqual({ sent: 2, failed: 0 });
    expect(sent.map(({ to }) => to).sort()).toEqual([
      'elsewhere@adiutor.test',
      'support@adiutor.test',
    ]);
    // Skipped, not revoked: removing the person revokes them (`revokeInvitationsTo`).
    const skipped = await db
      .select({ email: invitation.email, reminderSentAt: invitation.reminderSentAt })
      .from(invitation)
      .where(isNull(invitation.revokedAt));
    expect(
      skipped
        .filter(({ reminderSentAt }) => reminderSentAt === null)
        .map(({ email }) => email)
        .sort(),
    ).toEqual(['member@adiutor.test', 'staffer@adiutor.test']);
  });

  describe('when a reminder can’t be sent', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Reads an invitation by its address.
     *
     * @param email - The invited address.
     * @returns The invitation.
     */
    const invitationTo = async (email: string) =>
      firstRow(
        await db.select().from(invitation).where(eq(invitation.email, email)),
        'the invitation',
      );

    it('undoes it, so the old link works and the next run tries again, and sends the others', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      await inviteByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        email: 'bounces@adiutor.test',
        role: 'client',
      });
      await inviteByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        email: 'arrives@adiutor.test',
        role: 'client',
      });
      await age('bounces@adiutor.test', '1 day');
      await age('arrives@adiutor.test', '1 day');
      const before = await invitationTo('bounces@adiutor.test');
      sent.length = 0;
      const bouncing = {
        ...ctx,
        /**
         * Refuses the one address, as a mail server would, and sends the rest.
         *
         * @param email - The email.
         */
        sendEmail: async (email: Email) => {
          if (email.to === 'bounces@adiutor.test') {
            throw Object.assign(new Error('550 <bounces@adiutor.test> rejected'), {
              code: 'EENVELOPE',
              responseCode: 550,
            });
          }
          sent.push(email);
        },
      };

      await expect(sendInvitationReminders(bouncing)).resolves.toEqual({ sent: 1, failed: 1 });

      expect(sent.map(({ to }) => to)).toEqual(['arrives@adiutor.test']);
      const after = await invitationTo('bounces@adiutor.test');
      expect(after.tokenHash).toBe(before.tokenHash);
      expect(after.reminderSentAt).toBeNull();
      // The invitation's ID and the codes only: the error's message quotes the address.
      expect(logged).toHaveBeenCalledWith(
        `Sending the reminder for invitation ${before.id} failed; the next run tries again`,
        { code: 'EENVELOPE', responseCode: 550 },
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain('bounces@adiutor.test');

      // Once mail works again, the next run sends it.
      sent.length = 0;
      await expect(sendInvitationReminders(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
      expect(sent.map(({ to }) => to)).toEqual(['bounces@adiutor.test']);
    });

    it('keeps the link of a resend made while the reminder was on its way', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await inviteByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        email: 'resent@adiutor.test',
        role: 'client',
      });
      await age('resent@adiutor.test', '1 day');
      const resentHash = hashToken('adiutor-tests-resent-token');
      const timingOut = {
        ...ctx,
        /** Someone resends the invitation meanwhile, then the connection times out. */
        sendEmail: async () => {
          await db
            .update(invitation)
            .set({ tokenHash: resentHash })
            .where(eq(invitation.email, 'resent@adiutor.test'));
          throw new Error('Connection timeout');
        },
      };

      await expect(sendInvitationReminders(timingOut)).resolves.toEqual({ sent: 0, failed: 1 });

      expect((await invitationTo('resent@adiutor.test')).tokenHash).toBe(resentHash);
    });
  });
});
