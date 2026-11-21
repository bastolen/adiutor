/**
 * @file Integration tests for the job that reminds people of invitations
 * that expire soon, against the test database: who's reminded and when, and
 * that the link they have only gives way once the reminder is out, whatever
 * happens to the run meanwhile.
 */
import { eq, isNull, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { company, invitation, staffSettings } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import type { Email } from '@/lib/email';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  addMember,
  createCompany,
  createUser,
  emailLanguage,
  later,
  memberActor,
  setupTestContext,
  setUserLocale,
  staffActor,
  tokenFrom,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import type { ServiceContext } from '../../context';
import { inviteByEmail } from '../../people/invitations';
import invitationReminders, {
  REMINDER_GROUP_SIZE,
  REMINDER_LEASE_MINUTES,
} from './invitation-reminders';

const { ctx, db, sent } = setupTestContext();

/** Shared fixtures, recreated before each test. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;
let companyAdmin: Actor;

beforeEach(async () => {
  testCompany = await createCompany(db, { name: 'Adiutor Tests Client' });
  companyAdmin = await memberActor(db, testCompany.id, 'admin', 'boss@adiutor.test');
});

/**
 * Runs the job once.
 *
 * @param context - The service context to run it with.
 * @returns How many reminders were sent and how many failed.
 */
async function remind(context: ServiceContext) {
  return (await invitationReminders.run(context, { deadline: later })).summary;
}

describe('invitation-reminders', () => {
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

    await expect(remind(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
    await expect(remind(ctx)).resolves.toEqual({ sent: 0, failed: 0 });

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
    expect(reminded.reminderClaimedAt).toBeNull();
  });

  it('reminds the soonest-expiring first, a group at a time, leaving the rest at its deadline', async () => {
    // One more than a group, expiring an hour apart, the first soonest.
    await db.insert(invitation).values(
      Array.from({ length: REMINDER_GROUP_SIZE + 1 }, (_, index) => ({
        companyId: testCompany.id,
        email: `due${index}@adiutor.test`,
        role: 'client' as const,
        tokenHash: hashToken(`adiutor-tests-due-${index}`),
        invitedBy: companyAdmin.id,
        createdAt: sql`now() - interval '5 days'`,
        expiresAt: sql`now() + make_interval(hours => ${index + 1})`,
      })),
    );
    const groupEnd = new Date(Date.now() + 60_000);
    // The first group takes until past the deadline.
    const slowMail: ServiceContext = {
      ...ctx,
      /**
       * Sends like the test context, then moves the clock past the deadline.
       *
       * @param email - The email.
       */
      sendEmail: async (email) => {
        await ctx.sendEmail(email);
        vi.setSystemTime(new Date(groupEnd.getTime() + 1));
      },
    };
    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      const { summary } = await invitationReminders.run(slowMail, { deadline: groupEnd });

      expect(summary).toEqual({ sent: REMINDER_GROUP_SIZE, failed: 0 });
    } finally {
      vi.useRealTimers();
    }
    // The one that expires last waits for the next run.
    expect(
      await db
        .select({ email: invitation.email })
        .from(invitation)
        .where(isNull(invitation.reminderSentAt)),
    ).toEqual([{ email: `due${REMINDER_GROUP_SIZE}@adiutor.test` }]);
  });

  it('reminds in the invitation’s language, or the invitee’s own when they saved one', async () => {
    const input = { companyId: testCompany.id, role: 'client', locale: 'nl-NL' } as const;
    await inviteByEmail(ctx, companyAdmin, { ...input, email: 'new@adiutor.test' });
    await inviteByEmail(ctx, companyAdmin, { ...input, email: 'known@adiutor.test' });
    // Signed up meanwhile (without joining the company), with Spanish saved.
    await setUserLocale(db, await createUser(db, 'known@adiutor.test'), 'es-ES');
    await age('new@adiutor.test', '1 day');
    await age('known@adiutor.test', '1 day');
    sent.length = 0;

    await expect(remind(ctx)).resolves.toEqual({ sent: 2, failed: 0 });

    const byAddress = Object.fromEntries(sent.map((email) => [email.to, email]));
    expect(emailLanguage(defined(byAddress['new@adiutor.test'], 'the Dutch reminder'))).toBe(
      'nl-NL',
    );
    expect(defined(byAddress['new@adiutor.test'], 'the Dutch reminder').subject).toBe(
      'Herinnering: word lid van Adiutor Tests Client op Adiutor',
    );
    expect(emailLanguage(defined(byAddress['known@adiutor.test'], 'the Spanish reminder'))).toBe(
      'es-ES',
    );
  });

  it('reminds in the default language once the invitation’s language is turned off', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      role: 'client',
      locale: 'nl-NL',
      email: 'new@adiutor.test',
    });
    await age('new@adiutor.test', '1 day');
    await db.insert(staffSettings).values({
      name: 'Adiutor Tests',
      defaultLocale: 'en-US',
      offeredLocales: ['en-US', 'es-ES'],
    });
    sent.length = 0;

    await expect(remind(ctx)).resolves.toEqual({ sent: 1, failed: 0 });

    expect(emailLanguage(defined(sent[0], 'the reminder'))).toBe('en-US');
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
    await expect(remind(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
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

    await expect(remind(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
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

    await expect(remind(ctx)).resolves.toEqual({ sent: 2, failed: 0 });
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

    it('leaves the link they have and lets go, so the next run tries again, and sends the others', async () => {
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

      // The run counts as failed, so the failure shows; it says how many, not who.
      await expect(invitationReminders.run(bouncing, { deadline: later })).resolves.toEqual({
        summary: { sent: 1, failed: 1 },
        failure: "Reminders that couldn't be sent: 1; the next run tries them again",
      });

      expect(sent.map(({ to }) => to)).toEqual(['arrives@adiutor.test']);
      const after = await invitationTo('bounces@adiutor.test');
      expect(after.tokenHash).toBe(before.tokenHash);
      expect(after.reminderSentAt).toBeNull();
      expect(after.reminderClaimedAt).toBeNull();
      // The invitation's ID and the codes only: the error's message quotes the address.
      expect(logged).toHaveBeenCalledWith(
        `Sending the reminder for invitation ${before.id} failed; the next run tries again`,
        { code: 'EENVELOPE', responseCode: 550 },
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain('bounces@adiutor.test');

      // Once mail works again, the next run sends it.
      sent.length = 0;
      await expect(remind(ctx)).resolves.toEqual({ sent: 1, failed: 0 });
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

      await expect(remind(timingOut)).resolves.toEqual({ sent: 0, failed: 1 });

      expect((await invitationTo('resent@adiutor.test')).tokenHash).toBe(resentHash);
    });
  });

  describe('while a reminder is on its way', () => {
    /**
     * Reads what the job keeps of an invitation.
     *
     * @param email - The invited address.
     * @returns Its stored link, when its reminder was sent and since when a run holds it.
     */
    const stateOf = async (email: string) =>
      firstRow(
        await db
          .select({
            tokenHash: invitation.tokenHash,
            reminderSentAt: invitation.reminderSentAt,
            reminderClaimedAt: invitation.reminderClaimedAt,
          })
          .from(invitation)
          .where(eq(invitation.email, email)),
        'the invitation',
      );

    /**
     * Invites an address and ages the invitation until its reminder is due.
     *
     * @param email - The address.
     * @returns The invitation as stored, with the link they were sent.
     */
    const dueInvitation = async (email: string) => {
      await inviteByEmail(ctx, companyAdmin, { companyId: testCompany.id, email, role: 'client' });
      await age(email, '1 day');
      sent.length = 0;
      return stateOf(email);
    };

    it('keeps the link they have until the email is out, and holds the invitation meanwhile', async () => {
      const before = await dueInvitation('waiting@adiutor.test');
      /** Says that the send has started; set by the promise below. */
      let sendStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        sendStarted = resolve;
      });
      /** Lets the send finish; set by the promise below. */
      let letThrough: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        letThrough = resolve;
      });
      const hanging: ServiceContext = {
        ...ctx,
        /**
         * A mail server that takes the email and then keeps the test waiting.
         *
         * @param email - The email.
         */
        sendEmail: async (email) => {
          sendStarted();
          await held;
          sent.push(email);
        },
      };

      const run = invitationReminders.run(hanging, { deadline: later });
      await started;

      // Mid-send, as a run the platform stops would leave it: the link they have still works.
      expect(await stateOf('waiting@adiutor.test')).toEqual({
        tokenHash: before.tokenHash,
        reminderSentAt: null,
        reminderClaimedAt: expect.any(Date),
      });
      // A run at the same moment leaves it to the run that holds it.
      await expect(remind(ctx)).resolves.toEqual({ sent: 0, failed: 0 });
      expect(sent).toEqual([]);

      letThrough();
      await expect(run).resolves.toEqual({ summary: { sent: 1, failed: 0 } });

      // Only now does the reminder's link take the place of the one they had.
      const after = await stateOf('waiting@adiutor.test');
      expect(after.tokenHash).toBe(hashToken(tokenFrom(defined(sent[0], 'the reminder email'))));
      expect(after.tokenHash).not.toBe(before.tokenHash);
      expect(after).toMatchObject({ reminderSentAt: expect.any(Date), reminderClaimedAt: null });
    });

    it('takes an invitation again once the claim of a run that was stopped has run out', async () => {
      const stopped = await dueInvitation('stopped@adiutor.test');
      const held = await dueInvitation('held@adiutor.test');
      /**
       * Leaves a claim behind, as a run that was stopped mid-send does.
       *
       * @param email - The invited address.
       * @param minutesAgo - How long ago the run claimed it.
       */
      const claimed = async (email: string, minutesAgo: number) => {
        await db
          .update(invitation)
          .set({ reminderClaimedAt: sql`now() - make_interval(mins => ${minutesAgo})` })
          .where(eq(invitation.email, email));
      };
      await claimed('stopped@adiutor.test', REMINDER_LEASE_MINUTES + 1);
      await claimed('held@adiutor.test', REMINDER_LEASE_MINUTES - 1);

      await expect(remind(ctx)).resolves.toEqual({ sent: 1, failed: 0 });

      // The one whose claim ran out gets a second reminder, with a link that works.
      expect(sent.map(({ to }) => to)).toEqual(['stopped@adiutor.test']);
      const after = await stateOf('stopped@adiutor.test');
      expect(after.tokenHash).toBe(hashToken(tokenFrom(defined(sent[0], 'the reminder email'))));
      expect(after.tokenHash).not.toBe(stopped.tokenHash);
      expect(after).toMatchObject({ reminderSentAt: expect.any(Date), reminderClaimedAt: null });
      // The one a run may still be sending is left alone, link and all.
      expect(await stateOf('held@adiutor.test')).toEqual({
        tokenHash: held.tokenHash,
        reminderSentAt: null,
        reminderClaimedAt: expect.any(Date),
      });
    });

    it('keeps a newer link stored meanwhile, also when the reminder was sent', async () => {
      await dueInvitation('newer@adiutor.test');
      const newerHash = hashToken('adiutor-tests-newer-token');
      const overtaken: ServiceContext = {
        ...ctx,
        /**
         * Sends like the test context, after a newer link was stored for the invitation.
         *
         * @param email - The email.
         */
        sendEmail: async (email) => {
          await db
            .update(invitation)
            .set({ tokenHash: newerHash })
            .where(eq(invitation.email, 'newer@adiutor.test'));
          await ctx.sendEmail(email);
        },
      };

      await expect(remind(overtaken)).resolves.toEqual({ sent: 1, failed: 0 });

      expect((await stateOf('newer@adiutor.test')).tokenHash).toBe(newerHash);
    });
  });
});
