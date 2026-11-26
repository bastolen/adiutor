/**
 * @file Claiming an invite link by entering an email address: the first
 * person to open it enters their address, which uses up the link and turns
 * it into a normal email invitation for that address. That proves they own
 * the address and reuses the one acceptance flow.
 *
 * Whatever email is entered, the response is the same "check your inbox",
 * and the link is used up: an open invitation someone sent to that address
 * is kept rather than replaced. Each claim counts against the invitation
 * limits of the link's creator and its company, like an invitation they send.
 * A claim whose email can't be sent is undone, so the link can be used again.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { company, invitation, inviteLink, user } from '@/db/schema';
import { type Role } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { sendFailureOf } from '@/lib/email';
import { isTimeZone } from '@/lib/i18n/time-zones';
import { emailSchema } from '@/lib/validation';

import { assertStillManagesPeople } from '../../access';
import { recordEvent } from '../../audit';
import { loadEmailBrand } from '../../branding';
import type { ServiceContext } from '../../context';
import { type ErrorMessageKey, ServiceError } from '../../errors';
import {
  assertInviteCompanyLimit,
  assertInviteSenderLimit,
  assertRateLimit,
  ipRateLimitKey,
  RATE_LIMITS,
} from '../../rate-limit';
import { requesterLocale } from '../../recipient-locale';
import { auditTarget, createInvitationRecord, lockInvitationsOf } from '../invitations';
import getStaffName from '../staff-name';
import { usableLink, useLink } from './usable';

/**
 * Why a claim is refused when its link's creator, or its company (or the
 * staff), has sent as many invitations as the limits allow for now: the
 * message key. Says nothing about the address entered.
 */
export const LINK_CLAIM_LIMITED_MESSAGE =
  'errors.inviteLinks.claimLimited' satisfies ErrorMessageKey;

/**
 * Counts a claim like an invitation its link's creator sends: against the
 * creator's limit per sender and the company's (or the staff's) limit, as
 * `inviteByEmail` does, so invite links can't be used to send more
 * invitation emails than those limits allow. It counts in the claim's
 * transaction, after the link is used up: a refusal rolls back, so the link
 * stays unused, and so do the counts.
 *
 * @param tx - The claim's transaction.
 * @param createdBy - Who created the link, if their account still exists.
 * @param companyId - The link's company, or `null` for the staff.
 * @throws {ServiceError} `rate_limited` with {@link LINK_CLAIM_LIMITED_MESSAGE}.
 */
async function assertClaimLimits(
  tx: DatabaseTransaction,
  createdBy: string | null,
  companyId: string | null,
): Promise<void> {
  try {
    if (createdBy) {
      await assertInviteSenderLimit({ db: tx }, createdBy);
    }
    await assertInviteCompanyLimit({ db: tx }, companyId);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      throw new ServiceError('rate_limited', LINK_CLAIM_LIMITED_MESSAGE);
    }
    throw error;
  }
}

/** A claim that committed: what {@link undoClaim} needs when its email can't be sent. */
interface CommittedClaim {
  /** The link the claim used up. */
  linkId: string;
  /** The link's company, or `null` for the staff. */
  companyId: string | null;
  /** Who created the link, if their account still existed. */
  createdBy: string | null;
  /** The address entered, normalized. */
  email: string;
  /** The role the link gives. */
  role: Role;
  /** The invitation the claim created, or `null` when it created none. */
  invitationId: string | null;
}

/**
 * Whether a link's creator may still manage the people the link is for, read
 * from their rows as it locks them (`assertStillManagesPeople`, the first
 * statement of its transaction).
 *
 * @param tx - The transaction.
 * @param createdBy - Who created the link.
 * @param companyId - The link's company, or `null` for the staff.
 * @returns Whether they still may.
 */
async function creatorStillManages(
  tx: DatabaseTransaction,
  createdBy: string,
  companyId: string | null,
): Promise<boolean> {
  try {
    await assertStillManagesPeople(tx, { id: createdBy }, companyId);
    return true;
  } catch (error) {
    if (error instanceof ServiceError) {
      return false;
    }
    throw error;
  }
}

/**
 * Undoes a claim whose email couldn't be sent, in one transaction: revokes
 * the invitation it created and makes the link usable again, so a mail
 * outage doesn't use up a single-use link with nothing in anyone's inbox.
 * The undo is recorded (`invite_link_claimed` with `undone`), like the claim
 * was. What the claim counted against the invitation limits stays counted.
 *
 * It undoes only what is still as the claim left it, taking its locks in the
 * order every transaction takes them (see "Lock order" in
 * `docs/security-measures.md`):
 *
 * 1. The creator's rights, as they are now, first ({@link creatorStillManages}:
 *    their user and membership rows `FOR SHARE`). A creator who lost their
 *    rights meanwhile had their unused links and open invitations revoked
 *    (`revokeInvitesWithoutManager`), which skipped this link because it was
 *    used: freeing it now would give a former Admin's link back. With the
 *    locks, a change to their rights at this moment either came first (and
 *    the link stays used) or waits and then revokes the freed link.
 * 2. The link, only while it's still used up by this claim: a resend points
 *    it at a newer invitation, whose email was sent.
 * 3. The invitation, under the per-address lock, only while it's still open:
 *    one that was accepted (the email got through after all) or revoked by
 *    someone keeps the link used.
 *
 * A claim that created no invitation (the address was a member already, or
 * had an invitation someone sent, which the claim kept) is undone the same
 * way, without the third step, so the link ends up the same whatever the
 * address.
 *
 * @param ctx - Service context.
 * @param claim - The claim, as it committed.
 * @returns Whether the link can be used again.
 */
async function undoClaim(ctx: ServiceContext, claim: CommittedClaim): Promise<boolean> {
  const { linkId, companyId, createdBy, email, role, invitationId } = claim;
  return ctx.db.transaction(async (tx) => {
    if (createdBy && !(await creatorStillManages(tx, createdBy, companyId))) {
      return false;
    }
    const [held] = await tx
      .select({ id: inviteLink.id })
      .from(inviteLink)
      .where(
        and(
          eq(inviteLink.id, linkId),
          isNotNull(inviteLink.usedAt),
          isNull(inviteLink.revokedAt),
          eq(inviteLink.usedByEmail, email),
          invitationId === null
            ? isNull(inviteLink.invitationId)
            : eq(inviteLink.invitationId, invitationId),
        ),
      )
      .for('update');
    if (!held) {
      return false;
    }
    if (invitationId !== null) {
      await lockInvitationsOf(tx, companyId, email);
      const revoked = await tx
        .update(invitation)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invitation.id, invitationId),
            isNull(invitation.acceptedAt),
            isNull(invitation.revokedAt),
          ),
        )
        .returning({ id: invitation.id });
      if (revoked.length === 0) {
        return false;
      }
    }
    await tx
      .update(inviteLink)
      .set({ usedAt: null, usedByEmail: null, invitationId: null })
      .where(eq(inviteLink.id, linkId));
    await recordEvent(
      ctx,
      {
        action: 'invite_link_claimed',
        ...auditTarget(companyId, { email, role, undone: true }),
      },
      tx,
    );
    return true;
  });
}

/**
 * Undoes a claim whose email couldn't be sent ({@link undoClaim}) and logs
 * the failure, without the address or anything else personal: the link's ID,
 * whether it can be used again, and the mail server's codes
 * (`sendFailureOf`). An undo that fails too is logged and leaves the claim
 * as it committed; the caller still reports the failed send.
 *
 * @param ctx - Service context.
 * @param claim - The claim, as it committed.
 * @param sendError - What sending (or rendering) the email threw.
 */
async function undoUnsentClaim(
  ctx: ServiceContext,
  claim: CommittedClaim,
  sendError: unknown,
): Promise<void> {
  let outcome = 'the link stays used up';
  try {
    if (await undoClaim(ctx, claim)) {
      outcome = 'the link can be used again';
    }
  } catch (undoError) {
    // eslint-disable-next-line no-console -- The caller reports the failed send; this is why the link is still used up.
    console.error(`Undoing the claim of invite link ${claim.linkId} failed`, undoError);
  }
  // eslint-disable-next-line no-console -- The claimer only hears that it failed; this says what became of the link.
  console.error(
    `Sending the email for the claim of invite link ${claim.linkId} failed; ${outcome}`,
    sendFailureOf(sendError),
  );
}

/**
 * Uses a link by entering an email address. The link turns into an email
 * invitation for that address (or an "already a member" email, or an
 * "already invited" one when the address has an open invitation a person
 * sent, which the claim keeps; see `createInvitationRecord`), so the response
 * is the same whatever the address, and the link is used up either way.
 *
 * When that email can't be sent, the claim is undone ({@link undoClaim}): its
 * invitation is revoked and the link can be used again, whatever the address,
 * and the failure is reported to the caller as it was thrown.
 *
 * The claim counts against its creator's and its company's invitation limits
 * ({@link assertClaimLimits}), in its transaction once the link is used up:
 * past them it's refused with {@link LINK_CLAIM_LIMITED_MESSAGE} and the link
 * stays unused.
 *
 * Before it uses the link up, the transaction locks the link's creator's row
 * (`FOR KEY SHARE`, as the invitation's `invited_by` would anyway), keeping
 * user rows before invite links (see "Lock order" in
 * `docs/security-measures.md`). Without it, a claim holding the link could
 * deadlock with a change to the creator's rights: the change locks their row
 * and then waits for the link (`revokeInvitesWithoutManager`), while the
 * claim's invitation waits for their row. Now either the change waits for the
 * claim and revokes its invitation, or the claim waits for the change and
 * finds the link revoked.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @param rawEmail - The email address entered.
 * @returns `sent` when the link was usable, `invalid` otherwise.
 * @throws {ServiceError} `rate_limited` past the claims per IP address, or past the invitation
 *   limits of the link's creator or company.
 */
export async function claimInviteLink(
  ctx: ServiceContext,
  token: string,
  rawEmail: string,
): Promise<{ status: 'sent' | 'invalid' }> {
  const email = emailSchema.parse(rawEmail);
  const claimsKey = await ipRateLimitKey(ctx, 'invite-link-claim');
  // The confirmation is in the language of whoever opened the link, and so is the invitation.
  const locale = await requesterLocale(ctx);
  await assertRateLimit(ctx, claimsKey, RATE_LIMITS.linkClaimsPerIp);
  const created = await ctx.db.transaction(async (tx) => {
    const [usable] = await tx
      .select({ createdBy: inviteLink.createdBy })
      .from(inviteLink)
      .where(usableLink(token));
    if (!usable) {
      return null;
    }
    // The creator before the link: user rows come before invite links in the lock order. Their
    // zone is the invitation's (they sent it), for the reminder's expiry.
    const [creator] = usable.createdBy
      ? await tx
          .select({ timeZone: user.timeZone })
          .from(user)
          .where(eq(user.id, usable.createdBy))
          .for('key share')
      : [];
    const used = await useLink(tx, token, email);
    if (!used) {
      return null;
    }
    // After the link (the bucket rows come after invite links in the lock order), before the
    // per-address lock; a refusal rolls back, so the link stays unused.
    await assertClaimLimits(tx, used.createdBy, used.companyId);
    // The staff's name only for a link to the staff: a company's link shows the company's.
    const { name } =
      used.companyId === null
        ? { name: await getStaffName(tx) }
        : firstRow(
            await tx
              .select({ name: company.name })
              .from(company)
              .where(eq(company.id, used.companyId)),
            "the link's company",
          );
    // Keeps an open invitation a person sent to the address (`already_invited`), creating none.
    const result = await createInvitationRecord(tx, {
      target: { companyId: used.companyId, name },
      email,
      role: used.role,
      invitedBy: used.createdBy,
      fromLink: true,
      baseUrl: ctx.baseUrl,
      locale,
      timeZone: creator && isTimeZone(creator.timeZone) ? creator.timeZone : null,
    });
    // `null` when it created no invitation: the link is used up, pointing at nothing.
    await tx
      .update(inviteLink)
      .set({ invitationId: result.invitationId })
      .where(eq(inviteLink.id, used.id));
    await recordEvent(
      ctx,
      {
        action: 'invite_link_claimed',
        ...auditTarget(used.companyId, { email, role: used.role, status: result.status }),
      },
      tx,
    );
    return {
      renderEmail: result.renderEmail,
      claim: {
        linkId: used.id,
        companyId: used.companyId,
        createdBy: used.createdBy,
        email,
        role: used.role,
        invitationId: result.invitationId,
      },
    };
  });

  if (!created) {
    return { status: 'invalid' };
  }
  try {
    // Rendered only now, once the transaction has committed and released its locks.
    await ctx.sendEmail(await created.renderEmail(await loadEmailBrand(ctx.db)));
  } catch (error) {
    await undoUnsentClaim(ctx, created.claim, error);
    throw error;
  }
  return { status: 'sent' };
}
