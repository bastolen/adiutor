/**
 * @file Integration tests for single-use invite links, also when they're
 * claimed at the same moment as another claim, an invitation or a change to
 * their creator's rights, and when they're created by someone losing theirs;
 * a claim keeping an invitation an Admin sent, claims counted against the
 * invitation limits, and resending an invitation that came from a link.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseTransaction } from '@/db';
import {
  auditEvent,
  company,
  invitation,
  inviteLink,
  membership,
  rateLimitBucket,
  user,
} from '@/db/schema';
import { INVITE_LINKS_NOT_ALLOWED } from '@/lib/authz/permissions';
import { defined, firstRow } from '@/lib/defined';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  actorFor,
  atTheSameMoment,
  createCompany,
  createUser,
  emailLanguage,
  fillRateLimitBucket,
  inLanguage,
  memberActor,
  rateLimitHits,
  setupTestContext,
  staffActor,
  tokenFrom,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { RATE_LIMITS } from '../rate-limit';
import {
  acceptInvitation,
  createInvitationRecord,
  createSentInvitation,
  getInvitationPreview,
  inviteByEmail,
  listPendingInvitations,
  resendInvitation,
  revokeInvitesWithoutManager,
} from './invitations';
import {
  claimInviteLink,
  createInviteLink,
  getInviteLinkPreview,
  joinWithInviteLink,
  LINK_CLAIM_LIMITED_MESSAGE,
  listInviteLinks,
  revokeInviteLink,
} from './invite-links';
import { removeMember } from './members';
import { removeFromStaff } from './staff';
import { deleteUser } from './user-admin';

const { ctx, db, sent } = setupTestContext();

/** Shared fixtures, recreated before each test. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;
let admin: Actor;

beforeEach(async () => {
  testCompany = await createCompany(db);
  admin = await memberActor(db, testCompany.id, 'admin');
});

/**
 * Creates a 7-day Client link for the company.
 *
 * @returns The token from the link.
 */
async function newLinkToken(): Promise<string> {
  const { url } = await createInviteLink(ctx, admin, {
    companyId: testCompany.id,
    role: 'client',
    validDays: 7,
  });
  return defined(url.split('/join/')[1], 'the link token');
}

/**
 * Claims a link in a transaction that's held open, the way
 * `claimInviteLink` does (without counting it against the invitation
 * limits): locks the link's creator, marks the link used, creates the
 * invitation (from the creator) and points the link at it.
 *
 * @param tx - The held transaction.
 * @param linkId - The link.
 * @param email - The address entered.
 * @returns The invitation's ID.
 */
async function claimIn(tx: DatabaseTransaction, linkId: string, email: string) {
  const { createdBy } = firstRow(
    await tx
      .select({ createdBy: inviteLink.createdBy })
      .from(inviteLink)
      .where(eq(inviteLink.id, linkId)),
    'the link',
  );
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, defined(createdBy, 'the link creator')))
    .for('key share');
  const used = firstRow(
    await tx
      .update(inviteLink)
      .set({ usedAt: sql`now()`, usedByEmail: email })
      .where(eq(inviteLink.id, linkId))
      .returning(),
    'the claimed link',
  );
  const { invitationId } = await createInvitationRecord(tx, {
    target: { companyId: testCompany.id, name: testCompany.name },
    email,
    role: used.role,
    invitedBy: used.createdBy,
    fromLink: true,
    baseUrl: ctx.baseUrl,
    locale: 'en-US',
  });
  await tx.update(inviteLink).set({ invitationId }).where(eq(inviteLink.id, linkId));
  return defined(invitationId, 'the new invitation');
}

describe('invite links', () => {
  it('turn into an email invitation for whoever uses them first', async () => {
    const token = await newLinkToken();
    expect(await getInviteLinkPreview(ctx, token)).toEqual({
      companyName: 'Adiutor Tests',
      roleLabel: 'Client',
    });

    expect(await claimInviteLink(ctx, token, 'New@Adiutor.test')).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    const confirmation = defined(sent[0], 'the confirmation email');
    expect(confirmation.to).toBe('new@adiutor.test');
    expect(confirmation.subject).toBe('Confirm your email to join Adiutor Tests');
    expect(await getInvitationPreview(ctx, tokenFrom(confirmation))).toEqual({
      companyName: 'Adiutor Tests',
      roleLabel: 'Client',
      fromInviteLink: true,
    });

    const [link] = (await listInviteLinks(ctx, admin, testCompany.id)).items;
    expect(link).toMatchObject({ status: 'used', usedByEmail: 'new@adiutor.test' });
  });

  it('work only once', async () => {
    const token = await newLinkToken();
    await claimInviteLink(ctx, token, 'first@adiutor.test');
    expect(await claimInviteLink(ctx, token, 'second@adiutor.test')).toEqual({ status: 'invalid' });
    expect(await getInviteLinkPreview(ctx, token)).toBeNull();
  });

  it('can be used by only one of two simultaneous requests', async () => {
    const token = await newLinkToken();
    const results = await Promise.all([
      claimInviteLink(ctx, token, 'first@adiutor.test'),
      claimInviteLink(ctx, token, 'second@adiutor.test'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['invalid', 'sent']);
    expect(sent).toHaveLength(1);
  });

  it('keep an invitation an Admin sends to the same address at the same moment', async () => {
    const token = await newLinkToken();
    const email = 'new@adiutor.test';

    const { first, second } = await atTheSameMoment(
      db,
      (tx) =>
        createSentInvitation(ctx, tx, admin, {
          target: { companyId: testCompany.id, name: testCompany.name },
          email,
          role: 'admin',
        }),
      () => claimInviteLink(ctx, token, email),
    );
    // The invitation is rendered and emailed once its transaction has committed.
    const firstEmail = await first.renderEmail();
    await ctx.sendEmail(firstEmail);

    // The claim waited for the Admin's invitation, then kept it: the address is told to use it.
    expect(second).toEqual({ status: 'fulfilled', value: { status: 'sent' } });
    expect(sent).toHaveLength(2);
    const alreadyInvited = defined(sent[0], 'the already-invited email');
    const kept = defined(sent[1], 'the kept invitation email');
    expect(kept).toBe(firstEmail);
    expect(alreadyInvited).toMatchObject({
      to: email,
      subject: 'You already have an invitation to Adiutor Tests on Adiutor',
    });
    const open = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(and(eq(invitation.email, email), isNull(invitation.revokedAt)));
    expect(open).toEqual([{ id: first.invitationId }]);
    const [link] = await db.select().from(inviteLink);
    expect(link).toMatchObject({ usedByEmail: email, invitationId: null });
    expect(await getInvitationPreview(ctx, tokenFrom(kept))).toEqual({
      companyName: 'Adiutor Tests',
      roleLabel: 'Admin',
      fromInviteLink: false,
    });
  });

  it('replace an invitation another link sent to the same address at the same moment', async () => {
    await newLinkToken();
    const earlier = firstRow(
      await db.select({ id: inviteLink.id }).from(inviteLink),
      'the earlier link',
    );
    const token = await newLinkToken();
    const email = 'new@adiutor.test';

    const { first, second } = await atTheSameMoment(
      db,
      (tx) => claimIn(tx, earlier.id, email),
      () => claimInviteLink(ctx, token, email),
    );

    // Both came from links, so the newest wins, as if one came after the other.
    expect(second).toEqual({ status: 'fulfilled', value: { status: 'sent' } });
    expect(sent).toEqual([
      expect.objectContaining({ to: email, subject: 'Confirm your email to join Adiutor Tests' }),
    ]);
    const replaced = firstRow(
      await db
        .select({ revokedAt: invitation.revokedAt })
        .from(invitation)
        .where(eq(invitation.id, first)),
      'the replaced invitation',
    );
    expect(replaced.revokedAt).toBeInstanceOf(Date);
    const used = firstRow(
      await db
        .select({ invitationId: inviteLink.invitationId })
        .from(inviteLink)
        .where(eq(inviteLink.tokenHash, hashToken(token))),
      'the used link',
    );
    const open = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(and(eq(invitation.email, email), isNull(invitation.revokedAt)));
    expect(open).toEqual([{ id: used.invitationId }]);
    expect(
      await getInvitationPreview(ctx, tokenFrom(defined(sent[0], 'the confirmation email'))),
    ).toMatchObject({
      fromInviteLink: true,
    });
  });

  it('keep an open invitation an Admin sent to the address, answering as for any other', async () => {
    await inviteByEmail(ctx, admin, {
      companyId: testCompany.id,
      email: 'invited@adiutor.test',
      role: 'admin',
    });
    const adminToken = tokenFrom(defined(sent[0], 'the Admin invitation email'));
    const before = firstRow(await db.select().from(invitation), 'the Admin invitation');
    sent.length = 0;

    // The same answer as for an address nobody invited.
    expect(await claimInviteLink(ctx, await newLinkToken(), 'Invited@Adiutor.test')).toEqual(
      await claimInviteLink(ctx, await newLinkToken(), 'stranger@adiutor.test'),
    );

    // The Admin's invitation is untouched and still works; the address is told to use it.
    expect(await db.select().from(invitation).where(eq(invitation.id, before.id))).toEqual([
      before,
    ]);
    expect(
      await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(and(eq(invitation.email, 'invited@adiutor.test'), isNull(invitation.revokedAt))),
    ).toEqual([{ id: before.id }]);
    expect(await getInvitationPreview(ctx, adminToken)).toEqual({
      companyName: 'Adiutor Tests',
      roleLabel: 'Admin',
      fromInviteLink: false,
    });
    const alreadyInvited = defined(
      sent.find((email) => email.to === 'invited@adiutor.test'),
      'the email to the invited address',
    );
    expect(alreadyInvited.subject).toBe(
      'You already have an invitation to Adiutor Tests on Adiutor',
    );
    expect(alreadyInvited.text).not.toMatch(/\/(?:invite|join)\//);

    // The link is used up all the same, pointing at no invitation.
    const links = await db
      .select({ usedByEmail: inviteLink.usedByEmail, invitationId: inviteLink.invitationId })
      .from(inviteLink)
      .where(eq(inviteLink.usedByEmail, 'invited@adiutor.test'));
    expect(links).toEqual([{ usedByEmail: 'invited@adiutor.test', invitationId: null }]);
    const claims = await db
      .select({ details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'invite_link_claimed'));
    expect(claims.map(({ details }) => details.status).sort()).toEqual(['already_invited', 'sent']);
  });

  it('write the confirmation and an “already invited” email in the language of whoever opened the link', async () => {
    await inviteByEmail(ctx, admin, {
      companyId: testCompany.id,
      email: 'invited@adiutor.test',
      role: 'admin',
      locale: 'en-US',
    });
    sent.length = 0;

    const spanish = inLanguage(ctx, 'es-ES');
    await claimInviteLink(spanish, await newLinkToken(), 'new@adiutor.test');
    await claimInviteLink(spanish, await newLinkToken(), 'invited@adiutor.test');

    expect(sent.map((email) => [email.to, emailLanguage(email), email.subject])).toEqual([
      ['new@adiutor.test', 'es-ES', 'Confirma tu correo para unirte a Adiutor Tests'],
      ['invited@adiutor.test', 'es-ES', 'Ya tienes una invitación a Adiutor Tests en Adiutor'],
    ]);
    // The invitation the link turned into keeps that language, for its resends and reminder.
    const [claimed] = await db
      .select({ locale: invitation.locale })
      .from(invitation)
      .where(eq(invitation.email, 'new@adiutor.test'));
    expect(claimed?.locale).toBe('es-ES');
  });

  it('respond the same when the email is already a member', async () => {
    await memberActor(db, testCompany.id, 'watcher', 'member@adiutor.test');
    const token = await newLinkToken();
    expect(await claimInviteLink(ctx, token, 'member@adiutor.test')).toEqual({ status: 'sent' });
    expect(defined(sent[0], 'the email to the member').subject).toMatch(/already a member/);
  });

  it('let a signed-in user join directly', async () => {
    const token = await newLinkToken();
    const joiner = await actorFor(db, await createUser(db, 'joiner@adiutor.test'));
    expect(await joinWithInviteLink(ctx, token, joiner)).toEqual({
      status: 'joined',
      companyId: testCompany.id,
      signedOut: false,
    });
    const joined = firstRow(
      await db
        .select()
        .from(membership)
        .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, joiner.id))),
      'the new membership',
    );
    expect(joined.role).toBe('client');
  });

  it("can't be used by Finance or Support, and stay usable for someone else", async () => {
    const token = await newLinkToken();
    await Promise.all(
      (['finance', 'support'] as const).map(async (role) => {
        const viewer = await staffActor(db, role);
        await expect(joinWithInviteLink(ctx, token, viewer)).rejects.toMatchObject({
          code: 'forbidden',
          message: INVITE_LINKS_NOT_ALLOWED,
        });
      }),
    );
    expect(
      await db.select().from(membership).where(eq(membership.companyId, testCompany.id)),
    ).toHaveLength(1);

    // The refusals didn't use the link up.
    const joiner = await actorFor(db, await createUser(db, 'joiner@adiutor.test'));
    expect(await joinWithInviteLink(ctx, token, joiner)).toMatchObject({ status: 'joined' });
  });

  it('can be used by staff Managers and Admins', async () => {
    const manager = await staffActor(db, 'manager');
    expect(await joinWithInviteLink(ctx, await newLinkToken(), manager)).toMatchObject({
      status: 'joined',
    });
    const staffAdmin = await staffActor(db, 'platform_admin');
    expect(await joinWithInviteLink(ctx, await newLinkToken(), staffAdmin)).toMatchObject({
      status: 'joined',
    });
  });

  it('stop working when revoked or when the company is deactivated', async () => {
    const revokedToken = await newLinkToken();
    const link = firstRow(
      (await listInviteLinks(ctx, admin, testCompany.id)).items,
      'the invite link',
    );
    await revokeInviteLink(ctx, admin, { companyId: testCompany.id, linkId: link.id });
    expect(await claimInviteLink(ctx, revokedToken, 'x@adiutor.test')).toEqual({
      status: 'invalid',
    });

    const token = await newLinkToken();
    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    expect(await getInviteLinkPreview(ctx, token)).toBeNull();
  });

  describe("claimed while their creator's rights are taken away", () => {
    it.each([
      [
        'removed from the company',
        async (staffAdmin: Actor) =>
          removeMember(ctx, staffAdmin, {
            companyId: testCompany.id,
            membershipId: firstRow(
              await db
                .select({ id: membership.id })
                .from(membership)
                .where(eq(membership.userId, admin.id)),
              'the creator membership',
            ).id,
          }),
      ],
      ['deleted', async (staffAdmin: Actor) => deleteUser(ctx, staffAdmin, admin.id, admin.email)],
    ])('leave no open invitation when the creator is %s', async (_, takeAway) => {
      // Another admin, so the company keeps one.
      await memberActor(db, testCompany.id, 'admin');
      const staffAdmin = await staffActor(db, 'platform_admin');
      await createInviteLink(ctx, admin, {
        companyId: testCompany.id,
        role: 'admin',
        validDays: 7,
      });
      const link = firstRow(
        await db.select({ id: inviteLink.id }).from(inviteLink),
        'the invite link',
      );
      const email = 'claimed@adiutor.test';

      // The claim commits only once the change is waiting for it: on the link, or on the creator.
      const { first: invitationId, second } = await atTheSameMoment(
        db,
        (tx) => claimIn(tx, link.id, email),
        () => takeAway(staffAdmin),
      );

      expect(second.status).toBe('fulfilled');
      const claimed = firstRow(
        await db
          .select({ revokedAt: invitation.revokedAt })
          .from(invitation)
          .where(eq(invitation.id, invitationId)),
        'the claimed invitation',
      );
      expect(claimed.revokedAt).toBeInstanceOf(Date);
      expect(
        await db
          .select({ id: invitation.id })
          .from(invitation)
          .where(and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt))),
      ).toEqual([]);
      // The link stays "used" (it turned into that invitation), not "revoked".
      const [after] = await db
        .select({ usedByEmail: inviteLink.usedByEmail, revokedAt: inviteLink.revokedAt })
        .from(inviteLink);
      expect(after).toEqual({ usedByEmail: email, revokedAt: null });
    });
  });

  it('let a claim and the removal of its creator from the staff take turns', async () => {
    const creator = await staffActor(db, 'platform_admin');
    const staffAdmin = await staffActor(db, 'platform_admin');
    const { url } = await createInviteLink(ctx, creator, {
      companyId: null,
      role: 'support',
      validDays: 7,
    });
    const email = 'claimed@adiutor.test';

    /**
     * Waits until exactly one other session waits for a lock that a session holds.
     *
     * @param pid - The session holding the lock.
     * @returns The waiting session.
     */
    const waiterOf = (pid: number) =>
      vi.waitFor(
        async () => {
          const { rows } = await db.execute<{ pid: number }>(
            sql`select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
          );
          expect(rows).toHaveLength(1);
          return defined(rows[0], 'the waiting session').pid;
        },
        { timeout: 5_000 },
      );

    // Stops the claim at the per-address lock, once it holds the link (and, now, the creator).
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const { promise: held, resolve: holding } = Promise.withResolvers<number>();
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`invitation:staff:${email}`}, 0))`,
      );
      const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holding(defined(rows[0], 'the backend row').pid);
      await released;
    });
    /** What claiming the link answers. */
    type Claimed = Awaited<ReturnType<typeof claimInviteLink>>;
    let claim: Promise<PromiseSettledResult<Claimed>[]> = Promise.resolve([]);
    let removal: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
    try {
      const holderPid = await held;
      claim = Promise.allSettled([
        claimInviteLink(ctx, defined(url.split('/join/')[1], 'the link token'), email),
      ]);
      const claimPid = await waiterOf(holderPid);
      // The removal locks the creator's row and would then wait for the link the claim holds,
      // while the claim's invitation would wait for the creator's row: a deadlock, unless the
      // claim locked the creator first, so the removal waits for the whole claim.
      removal = Promise.allSettled([removeFromStaff(ctx, staffAdmin, creator.id)]);
      await waiterOf(claimPid);
    } finally {
      release();
      await holder;
    }

    expect(await claim).toEqual([{ status: 'fulfilled', value: { status: 'sent' } }]);
    expect(await removal).toEqual([{ status: 'fulfilled', value: undefined }]);
    // The removal came second, so it revoked the claim's invitation; the link stays "used".
    expect(
      await db
        .select({ revokedAt: invitation.revokedAt })
        .from(invitation)
        .where(eq(invitation.email, email)),
    ).toEqual([{ revokedAt: expect.any(Date) }]);
    const [link] = await db
      .select({ usedByEmail: inviteLink.usedByEmail, revokedAt: inviteLink.revokedAt })
      .from(inviteLink);
    expect(link).toEqual({ usedByEmail: email, revokedAt: null });
  });

  describe('created by someone losing their rights at that moment', () => {
    /** The refusal for an actor whose rights are gone by the time the change is made. */
    const FORBIDDEN = expect.objectContaining({
      code: 'forbidden',
      message: "You don't have permission to do that.",
    });

    /**
     * Lists the links that can still be used.
     *
     * @returns Their IDs.
     */
    const usableLinks = async () =>
      db
        .select({ id: inviteLink.id })
        .from(inviteLink)
        .where(and(isNull(inviteLink.usedAt), isNull(inviteLink.revokedAt)));

    it('refuses a staff link from an Admin removed from the staff', async () => {
      const staffAdmin = await staffActor(db, 'platform_admin');
      // Another Admin, so the staff keeps one.
      await staffActor(db, 'platform_admin');

      const { second } = await atTheSameMoment(
        db,
        // Taken off the staff the way `setStaffRole` does: the role goes, then what they sent.
        async (tx) => {
          await tx.update(user).set({ platformRole: null }).where(eq(user.id, staffAdmin.id));
          await revokeInvitesWithoutManager(ctx, tx, staffAdmin.id);
        },
        // `staffAdmin` still carries the rights it was loaded with before the removal.
        () =>
          createInviteLink(ctx, staffAdmin, {
            companyId: null,
            role: 'platform_admin',
            validDays: 30,
          }),
      );

      expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
      expect(await usableLinks()).toEqual([]);
    });

    it.each([
      [
        'demoted',
        async (tx: DatabaseTransaction) => {
          await tx
            .update(membership)
            .set({ role: 'client' })
            .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, admin.id)));
          await revokeInvitesWithoutManager(ctx, tx, admin.id);
        },
      ],
      [
        'deactivated',
        async (tx: DatabaseTransaction) => {
          await tx.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, admin.id));
          await revokeInvitesWithoutManager(ctx, tx, admin.id, { all: true });
        },
      ],
    ])('refuses a link from a company Admin %s', async (_, takeAway) => {
      // Another admin, so the company keeps one.
      await memberActor(db, testCompany.id, 'admin');

      const { second } = await atTheSameMoment(
        db,
        (tx) => takeAway(tx),
        () =>
          createInviteLink(ctx, admin, { companyId: testCompany.id, role: 'admin', validDays: 30 }),
      );

      expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
      expect(await usableLinks()).toEqual([]);
    });

    it('refuses revoking a link for a company Admin demoted', async () => {
      const otherAdmin = await memberActor(db, testCompany.id, 'admin');
      await createInviteLink(ctx, otherAdmin, {
        companyId: testCompany.id,
        role: 'client',
        validDays: 7,
      });
      const link = firstRow(await usableLinks(), 'the usable link');

      const { second } = await atTheSameMoment(
        db,
        (tx) =>
          tx
            .update(membership)
            .set({ role: 'client' })
            .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, admin.id))),
        () => revokeInviteLink(ctx, admin, { companyId: testCompany.id, linkId: link.id }),
      );

      expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
      expect(await usableLinks()).toEqual([link]);
    });
  });

  it('can only be created for fitting roles and validity periods', async () => {
    await expect(
      createInviteLink(ctx, admin, { companyId: testCompany.id, role: 'support', validDays: 7 }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      createInviteLink(ctx, admin, { companyId: testCompany.id, role: 'client', validDays: 365 }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('invite link claims and the invitation limits', () => {
  /** The refusal past a limit, the same whatever address was entered. */
  const LIMITED = expect.objectContaining({
    code: 'rate_limited',
    message: LINK_CLAIM_LIMITED_MESSAGE,
  });

  it('count each claim like an invitation its creator sends, for them and the company', async () => {
    await claimInviteLink(ctx, await newLinkToken(), 'first@adiutor.test');
    await inviteByEmail(ctx, admin, {
      companyId: testCompany.id,
      email: 'second@adiutor.test',
      role: 'client',
    });

    expect(await rateLimitHits(db, `invite:user:${admin.id}`)).toBe(2);
    expect(await rateLimitHits(db, `invite:company:${testCompany.id}`)).toBe(2);
  });

  it.each([
    ["the link's creator", () => `invite:user:${admin.id}`, RATE_LIMITS.invitesPerUser.limit],
    ['the company', () => `invite:company:${testCompany.id}`, RATE_LIMITS.invitesPerCompany.limit],
  ])('refuse a claim past the limit of %s, leaving the link unused', async (_, key, limit) => {
    const token = await newLinkToken();
    await fillRateLimitBucket(db, key(), limit);

    await expect(claimInviteLink(ctx, token, 'late@adiutor.test')).rejects.toEqual(LIMITED);
    // Nobody got an email, and nothing was used up or counted: the claim rolled back.
    expect(sent).toEqual([]);
    expect(await db.select().from(invitation)).toEqual([]);
    expect(await getInviteLinkPreview(ctx, token)).not.toBeNull();
    const [link] = await db.select().from(inviteLink);
    expect(link).toMatchObject({ usedAt: null, usedByEmail: null, invitationId: null });
    expect(await rateLimitHits(db, key())).toBe(limit);

    // It works again once the window has passed.
    await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, key()));
    expect(await claimInviteLink(ctx, token, 'late@adiutor.test')).toEqual({ status: 'sent' });
  });

  it('refuse a staff link claim past the staff limit, whatever the address', async () => {
    const staffAdmin = await staffActor(db, 'platform_admin');
    const { url } = await createInviteLink(ctx, staffAdmin, {
      companyId: null,
      role: 'support',
      validDays: 7,
    });
    await fillRateLimitBucket(db, 'invite:company:staff', RATE_LIMITS.invitesPerCompany.limit);

    await expect(
      claimInviteLink(ctx, defined(url.split('/join/')[1], 'the link token'), staffAdmin.email),
    ).rejects.toEqual(LIMITED);
    await expect(
      claimInviteLink(
        ctx,
        defined(url.split('/join/')[1], 'the link token'),
        'nobody@adiutor.test',
      ),
    ).rejects.toEqual(LIMITED);
    expect(sent).toEqual([]);
  });
});

describe('resending an invitation that came from an invite link', () => {
  it("keeps it from the link, so Support still can't accept it", async () => {
    const support = await staffActor(db, 'support', 'sam.support@adiutor.test');
    await claimInviteLink(ctx, await newLinkToken(), support.email);
    const claimed = firstRow(
      (await listPendingInvitations(ctx, admin, testCompany.id)).items,
      'the claimed invitation',
    );
    expect(claimed).toMatchObject({ email: support.email, fromInviteLink: true });

    await resendInvitation(ctx, admin, { companyId: testCompany.id, invitationId: claimed.id });

    // A new invitation, which the link now points to.
    const resent = firstRow(
      (await listPendingInvitations(ctx, admin, testCompany.id)).items,
      'the resent invitation',
    );
    expect(resent.id).not.toBe(claimed.id);
    expect(resent).toMatchObject({ email: support.email, fromInviteLink: true });
    const link = firstRow(
      await db.select({ invitationId: inviteLink.invitationId }).from(inviteLink),
      'the invite link',
    );
    expect(link.invitationId).toBe(resent.id);
    const token = tokenFrom(defined(sent.at(-1), 'the last email'));
    expect(await getInvitationPreview(ctx, token)).toMatchObject({ fromInviteLink: true });
    await expect(acceptInvitation(ctx, token, support)).rejects.toMatchObject({
      code: 'forbidden',
      message: INVITE_LINKS_NOT_ALLOWED,
    });

    // Someone else, invited from a link and resent, can still accept it.
    const joiner = await actorFor(db, await createUser(db, 'joiner@adiutor.test'));
    await claimInviteLink(ctx, await newLinkToken(), joiner.email);
    const pending = (await listPendingInvitations(ctx, admin, testCompany.id)).items;
    const forJoiner = defined(
      pending.find((row) => row.email === joiner.email),
      'the invitation for the joiner',
    );
    await resendInvitation(ctx, admin, { companyId: testCompany.id, invitationId: forJoiner.id });
    expect(
      await acceptInvitation(ctx, tokenFrom(defined(sent.at(-1), 'the last email')), joiner),
    ).toEqual({
      status: 'joined',
      companyId: testCompany.id,
    });
  });

  it("doesn't mark an invitation an Admin sent, resent or not", async () => {
    await inviteByEmail(ctx, admin, {
      companyId: testCompany.id,
      email: 'invited@adiutor.test',
      role: 'client',
    });
    const pending = firstRow(
      (await listPendingInvitations(ctx, admin, testCompany.id)).items,
      'the pending invitation',
    );
    expect(pending.fromInviteLink).toBe(false);
    await resendInvitation(ctx, admin, { companyId: testCompany.id, invitationId: pending.id });
    const [resent] = (await listPendingInvitations(ctx, admin, testCompany.id)).items;
    expect(resent).toMatchObject({ email: 'invited@adiutor.test', fromInviteLink: false });
  });
});

describe('listInviteLinks sorting and paging', () => {
  /**
   * Inserts an unused link for the shared company with a known creation time (creating them
   * through the service would stamp the current time).
   *
   * @param createdAt - When it was created.
   * @param values - Other columns to set, e.g. to use it up, revoke it or give it to another company.
   * @returns The link's ID.
   */
  async function insertLink(
    createdAt: Date,
    values: Partial<typeof inviteLink.$inferInsert> = {},
  ): Promise<string> {
    const created = firstRow(
      await db
        .insert(inviteLink)
        .values({
          companyId: testCompany.id,
          role: 'client',
          tokenHash: randomUUID(),
          createdBy: admin.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt,
          ...values,
        })
        .returning({ id: inviteLink.id }),
      'the new link',
    );
    return created.id;
  }

  /**
   * The start of a day in January 2026, in UTC.
   *
   * @param day - The day of the month.
   * @returns The date.
   */
  const january = (day: number) => new Date(Date.UTC(2026, 0, day));

  it('lists the newest first by default and the oldest first the other way round', async () => {
    const oldest = await insertLink(january(1), { role: 'client' });
    const middle = await insertLink(january(2), { role: 'watcher' });
    const newest = await insertLink(january(3), { role: 'admin' });

    /**
     * Lists the shared company's links in an order.
     *
     * @param options - Sort and page.
     * @returns The links' IDs, in order.
     */
    const ids = async (options: Parameters<typeof listInviteLinks>[3] = {}) =>
      (await listInviteLinks(ctx, admin, testCompany.id, options)).items.map((link) => link.id);

    expect(await ids()).toEqual([newest, middle, oldest]);
    expect(await ids({ sort: 'created' })).toEqual([newest, middle, oldest]);
    expect(await ids({ dir: 'asc' })).toEqual([oldest, middle, newest]);
    expect(await ids({ sort: 'created', dir: 'desc' })).toEqual([newest, middle, oldest]);
  });

  it('works out the status of each link on the page', async () => {
    const past = new Date(Date.now() - 60_000);
    await insertLink(january(1));
    await insertLink(january(2), { expiresAt: past });
    await insertLink(january(3), { usedAt: new Date(), usedByEmail: 'used@adiutor.test' });
    await insertLink(january(4), { revokedAt: new Date() });
    // Revoking counts before everything else, and using a link up before it expires.
    await insertLink(january(5), { expiresAt: past, revokedAt: new Date() });
    await insertLink(january(6), {
      expiresAt: past,
      usedAt: new Date(),
      usedByEmail: 'late@adiutor.test',
    });

    const { items } = await listInviteLinks(ctx, admin, testCompany.id, { dir: 'asc' });

    expect(items.map((link) => link.status)).toEqual([
      'active',
      'expired',
      'used',
      'revoked',
      'revoked',
      'used',
    ]);
    expect(items.map((link) => link.usedByEmail)).toEqual([
      null,
      null,
      'used@adiutor.test',
      null,
      null,
      'late@adiutor.test',
    ]);
  });

  it('shows 25 links a page, counting all of them, and the last page for one past it', async () => {
    await Promise.all(Array.from({ length: 26 }, (_, index) => insertLink(january(index + 1))));
    // Another company's link and a staff link aren't this company's.
    const other = await createCompany(db);
    await insertLink(january(27), { companyId: other.id });
    await insertLink(january(28), { companyId: null, role: 'support' });

    const first = await listInviteLinks(ctx, admin, testCompany.id);
    expect(first).toMatchObject({ total: 26, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first link').createdAt).toEqual(january(26));
    expect(defined(first.items[24], 'the last link').createdAt).toEqual(january(2));

    const second = await listInviteLinks(ctx, admin, testCompany.id, { page: 2 });
    expect(second).toMatchObject({ total: 26, page: 2 });
    expect(second.items.map((link) => link.createdAt)).toEqual([january(1)]);

    const past = await listInviteLinks(ctx, admin, testCompany.id, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map((link) => link.id)).toEqual(second.items.map((link) => link.id));

    // Oldest first, the newest link is alone on the second page.
    const oldestFirst = await listInviteLinks(ctx, admin, testCompany.id, { dir: 'asc', page: 2 });
    expect(oldestFirst.items.map((link) => link.createdAt)).toEqual([january(26)]);

    const fifty = await listInviteLinks(ctx, admin, testCompany.id, { size: 50 });
    expect(fifty).toMatchObject({ total: 26, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(26);

    const staffAdmin = await staffActor(db, 'platform_admin');
    expect((await listInviteLinks(ctx, staffAdmin, null)).total).toBe(1);
  });
});
