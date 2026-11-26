/**
 * @file Integration tests for claiming single-use invite links, also when they're
 * claimed at the same moment as another claim, an invitation or a change to
 * their creator's rights; a claim keeping an invitation an Admin sent, claims
 * counted against the invitation limits and the limit per IP address, a claim
 * undone because its email couldn't be sent, and resending an invitation that
 * came from a link.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseTransaction } from '@/db';
import { company, invitation, inviteLink, membership, rateLimitBucket, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import type { Email } from '@/lib/email';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  actorFor,
  atTheSameMoment,
  createUser,
  emailLanguage,
  fillRateLimitBucket,
  inLanguage,
  memberActor,
  rateLimitHits,
  staffActor,
  tokenFrom,
  auditEvents,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { loadEmailBrand } from '../../branding';
import type { ServiceContext } from '../../context';
import { RATE_LIMITS } from '../../rate-limit';
import {
  acceptInvitation,
  createInvitationRecord,
  createSentInvitation,
  getInvitationPreview,
  inviteByEmail,
  listPendingInvitations,
  resendInvitation,
} from '../invitations';
import { removeMember } from '../members';
import { removeFromStaff } from '../staff';
import { deleteUser } from '../user-admin';
import { claimInviteLink, LINK_CLAIM_LIMITED_MESSAGE } from './claim';
import { createInviteLink, listInviteLinks, revokeInviteLink } from './manage';
import { admin, ctx, db, newLinkToken, sent, testCompany } from './test-helpers';
import { getInviteLinkPreview } from './usable';

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
    timeZone: null,
  });
  await tx.update(inviteLink).set({ invitationId }).where(eq(inviteLink.id, linkId));
  return defined(invitationId, 'the new invitation');
}

describe('invite links', () => {
  it('turn into an email invitation for whoever uses them first', async () => {
    const token = await newLinkToken();
    expect(await getInviteLinkPreview(ctx, token)).toEqual({
      companyName: 'Adiutor Tests',
      target: 'company',
      role: 'client',
    });

    expect(await claimInviteLink(ctx, token, 'New@Adiutor.test')).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    const confirmation = defined(sent[0], 'the confirmation email');
    expect(confirmation.to).toBe('new@adiutor.test');
    expect(confirmation.subject).toBe('Confirm your email to join Adiutor Tests');
    expect(await getInvitationPreview(ctx, tokenFrom(confirmation))).toEqual({
      companyName: 'Adiutor Tests',
      target: 'company',
      role: 'client',
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
    const firstEmail = await first.renderEmail(await loadEmailBrand(db));
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
      target: 'company',
      role: 'admin',
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
      target: 'company',
      role: 'admin',
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
    const claims = await auditEvents(db, { action: 'invite_link_claimed', fields: ['details'] });
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

  it('turn into an invitation with the zone of whoever created the link', async () => {
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, admin.id));

    await claimInviteLink(ctx, await newLinkToken(), 'new@adiutor.test');

    const [claimed] = await db
      .select({ timeZone: invitation.timeZone })
      .from(invitation)
      .where(eq(invitation.email, 'new@adiutor.test'));
    expect(claimed?.timeZone).toBe('Asia/Kolkata');
  });

  it('respond the same when the email is already a member', async () => {
    await memberActor(db, testCompany.id, 'watcher', 'member@adiutor.test');
    const token = await newLinkToken();
    expect(await claimInviteLink(ctx, token, 'member@adiutor.test')).toEqual({ status: 'sent' });
    expect(defined(sent[0], 'the email to the member').subject).toMatch(/already a member/);
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
});

describe('invite link claims and the invitation limits', () => {
  /** The refusal past a limit, the same whatever address was entered. */
  const LIMITED = expect.objectContaining({
    code: 'rate_limited',
    key: LINK_CLAIM_LIMITED_MESSAGE,
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

  it('count each claim against the IP address it came from, refusing past its limit', async () => {
    /**
     * The request's client, as `requestInfoFromHeaders` would give it.
     *
     * @returns The IP address, without a browser.
     */
    const requestInfo = async () => ({ ip: '203.0.113.7', userAgent: null });
    const fromAddress = { ...ctx, requestInfo };

    await claimInviteLink(fromAddress, await newLinkToken(), 'first@adiutor.test');
    await claimInviteLink(ctx, await newLinkToken(), 'second@adiutor.test');

    expect(await rateLimitHits(db, 'invite-link-claim:ip:203.0.113.7')).toBe(1);
    // Outside a request there's no address: those claims share one bucket.
    expect(await rateLimitHits(db, 'invite-link-claim:ip:unknown')).toBe(1);

    await db
      .update(rateLimitBucket)
      .set({ count: RATE_LIMITS.linkClaimsPerIp.limit })
      .where(eq(rateLimitBucket.key, 'invite-link-claim:ip:203.0.113.7'));
    const token = await newLinkToken();
    await expect(claimInviteLink(fromAddress, token, 'late@adiutor.test')).rejects.toMatchObject({
      code: 'rate_limited',
      key: 'errors.tooManyAttempts',
    });
    // Refused before the link is looked at: it stays usable, from another address too.
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

describe('an invite link claim whose email can’t be sent', () => {
  /** What sending throws while the mail server is down; its message quotes the address. */
  const MAIL_DOWN = Object.assign(new Error('Connection refused for new@adiutor.test'), {
    code: 'ECONNECTION',
  });

  /** A link nobody has used, as its row says it. */
  const UNUSED = { usedAt: null, usedByEmail: null, invitationId: null, revokedAt: null };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A service context whose mail server is down.
   *
   * @param before - What happens between the claim and its failed send, given the email.
   * @returns The context.
   */
  function withMailDown(before: (email: Email) => Promise<unknown> = async () => {}) {
    /**
     * Fails to send an email, after whatever happens first.
     *
     * @param email - The email.
     */
    const sendEmail = async (email: Email): Promise<void> => {
      await before(email);
      throw MAIL_DOWN;
    };
    return { ...ctx, sendEmail } satisfies ServiceContext;
  }

  /**
   * Reads the one invite link.
   *
   * @returns Who used it, its invitation and whether it was revoked.
   */
  async function theLink() {
    return firstRow(
      await db
        .select({
          usedAt: inviteLink.usedAt,
          usedByEmail: inviteLink.usedByEmail,
          invitationId: inviteLink.invitationId,
          revokedAt: inviteLink.revokedAt,
        })
        .from(inviteLink),
      'the invite link',
    );
  }

  /**
   * Lists the invitations that are still open.
   *
   * @returns Their IDs and addresses.
   */
  async function openInvitations() {
    return db
      .select({ id: invitation.id, email: invitation.email })
      .from(invitation)
      .where(and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
      .orderBy(invitation.id);
  }

  it('frees the link and revokes its invitation, so claiming it again works', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = await newLinkToken();

    await expect(claimInviteLink(withMailDown(), token, 'New@Adiutor.test')).rejects.toBe(
      MAIL_DOWN,
    );

    // The link is as it was, and the invitation the claim created is revoked.
    expect(await theLink()).toEqual(UNUSED);
    expect(await getInviteLinkPreview(ctx, token)).not.toBeNull();
    expect(await openInvitations()).toEqual([]);
    expect(await db.$count(invitation)).toBe(1);
    // The claim and its undoing are both in the audit log.
    const claims = await auditEvents(db, { action: 'invite_link_claimed', fields: ['details'] });
    expect(claims.map(({ details }) => details)).toEqual([
      { email: 'new@adiutor.test', role: 'client', status: 'sent' },
      { email: 'new@adiutor.test', role: 'client', undone: true },
    ]);
    // The log says what became of the link, with the mail server's codes and no address.
    expect(logged.mock.calls).toEqual([
      [
        expect.stringMatching(
          /^Sending the email for the claim of invite link [0-9a-f-]{36} failed; the link can be used again$/,
        ),
        { code: 'ECONNECTION', responseCode: null },
      ],
    ]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('adiutor.test');
    // The failed claim still counts against the invitation limits.
    expect(await rateLimitHits(db, `invite:user:${admin.id}`)).toBe(1);

    // Once the mail server is back, the same link works.
    expect(await claimInviteLink(ctx, token, 'new@adiutor.test')).toEqual({ status: 'sent' });
    expect(sent.map((email) => email.to)).toEqual(['new@adiutor.test']);
    expect(await getInvitationPreview(ctx, tokenFrom(defined(sent[0], 'the email')))).toMatchObject(
      { fromInviteLink: true },
    );
    expect(await openInvitations()).toHaveLength(1);
    expect(await rateLimitHits(db, `invite:user:${admin.id}`)).toBe(2);
  });

  it.each([
    [
      'is already a member',
      async () => {
        await memberActor(db, testCompany.id, 'watcher', 'known@adiutor.test');
      },
    ],
    [
      'already has an invitation someone sent',
      async () => {
        await inviteByEmail(ctx, admin, {
          companyId: testCompany.id,
          email: 'known@adiutor.test',
          role: 'admin',
        });
        sent.length = 0;
      },
    ],
  ])('frees the link just the same when the address %s', async (_, arrange) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await arrange();
    const openBefore = await openInvitations();
    const token = await newLinkToken();

    // The same failure as for any other address.
    await expect(claimInviteLink(withMailDown(), token, 'known@adiutor.test')).rejects.toBe(
      MAIL_DOWN,
    );

    expect(await theLink()).toEqual(UNUSED);
    // The claim created no invitation, so undoing it revoked none: what was open still is.
    expect(await openInvitations()).toEqual(openBefore);
    expect(await claimInviteLink(ctx, token, 'new@adiutor.test')).toEqual({ status: 'sent' });
  });

  it('keeps the link used up when its creator lost their rights meanwhile', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Another Admin, so the company keeps one.
    await memberActor(db, testCompany.id, 'admin');
    const staffAdmin = await staffActor(db, 'platform_admin');
    const token = await newLinkToken();
    /**
     * Removes the link's creator from the company, which revokes what they sent.
     *
     * @returns Nothing.
     */
    const removeCreator = async () =>
      removeMember(ctx, staffAdmin, {
        companyId: testCompany.id,
        membershipId: firstRow(
          await db
            .select({ id: membership.id })
            .from(membership)
            .where(eq(membership.userId, admin.id)),
          'the creator membership',
        ).id,
      });

    await expect(
      claimInviteLink(withMailDown(removeCreator), token, 'new@adiutor.test'),
    ).rejects.toBe(MAIL_DOWN);

    // Freeing it would give a former Admin's link back: it stays used, and nothing is open.
    expect(await theLink()).toMatchObject({ usedByEmail: 'new@adiutor.test', revokedAt: null });
    expect(await getInviteLinkPreview(ctx, token)).toBeNull();
    expect(await claimInviteLink(ctx, token, 'new@adiutor.test')).toEqual({ status: 'invalid' });
    expect(await openInvitations()).toEqual([]);
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(/failed; the link stays used up$/),
    ]);
  });

  it('keeps the link used up when its invitation was resent meanwhile, whose email was sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = await newLinkToken();
    /**
     * Resends the invitation the claim created, as an Admin who saw it in the list would.
     *
     * @returns Nothing.
     */
    const resend = async () =>
      resendInvitation(ctx, admin, {
        companyId: testCompany.id,
        invitationId: firstRow(await openInvitations(), 'the claimed invitation').id,
      });

    await expect(claimInviteLink(withMailDown(resend), token, 'new@adiutor.test')).rejects.toBe(
      MAIL_DOWN,
    );

    // The resend's invitation is open, its email went out, and the link points at it.
    const open = await openInvitations();
    expect(open).toEqual([{ id: expect.any(String), email: 'new@adiutor.test' }]);
    expect(sent.map((email) => email.to)).toEqual(['new@adiutor.test']);
    expect(await theLink()).toMatchObject({
      usedByEmail: 'new@adiutor.test',
      invitationId: open[0]?.id,
    });
  });

  it('keeps the link used up when the invitation was accepted: the email got through after all', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const invitee = await createUser(db, 'new@adiutor.test');
    const token = await newLinkToken();
    /**
     * Accepts the invitation with the link from its email.
     *
     * @param email - The email the send reported as failed.
     * @returns What accepting it answered.
     */
    const accept = async (email: Email) =>
      acceptInvitation(ctx, tokenFrom(email), {
        id: invitee,
        email: 'new@adiutor.test',
        platformRole: null,
      });

    await expect(claimInviteLink(withMailDown(accept), token, 'new@adiutor.test')).rejects.toBe(
      MAIL_DOWN,
    );

    expect(await theLink()).toMatchObject({ usedByEmail: 'new@adiutor.test', revokedAt: null });
    expect(await getInviteLinkPreview(ctx, token)).toBeNull();
    expect(
      await db.$count(
        membership,
        and(eq(membership.companyId, testCompany.id), eq(membership.userId, invitee)),
      ),
    ).toBe(1);
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
      key: 'errors.inviteLinks.notAllowed',
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
