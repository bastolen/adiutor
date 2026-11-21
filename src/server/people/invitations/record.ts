/**
 * @file Creating an invitation's record: checks for a member or an open
 * invitation, replaces an older one, and builds the email to send, for
 * invitations sent by email and those an invite link sends, in the
 * invitation's language (or the invitee's own, when they have an account).
 */
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { invitation, inviteLink, membership, user } from '@/db/schema';
import { alreadyInvitedEmail } from '@/emails/already-invited';
import { alreadyMemberEmail } from '@/emails/already-member';
import { invitationEmail } from '@/emails/invitation';
import { inviteLinkConfirmationEmail } from '@/emails/invite-link-confirmation';
import { type Role } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import displayName from '@/lib/display-name';
import type { Email } from '@/lib/email';
import { loadLanguageSettings } from '@/lib/i18n/default-locale';
import { type Locale, offeredLocale } from '@/lib/i18n/locales';
import { INVITATION_VALID_DAYS } from '@/lib/invitation-lifetimes';
import type { InviteStatus } from '@/lib/invite-status';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';

import type { Actor } from '../../actor';
import { recordEvent } from '../../audit';
import type { ServiceContext } from '../../context';
import recipientLocale from '../../recipient-locale';
import { lockInvitationsOf } from './locks';
import { type InviteDestination, joinedPath, sameTarget, auditTarget } from './rules';

/**
 * What claiming an invite link can come to: an {@link InviteStatus}, or
 * `already_invited` when the address already has an open invitation that a
 * person sent, which the claim keeps (see {@link createInvitationRecord}). Only
 * for the claim's audit event: whoever claims the link always sees the same
 * answer.
 */
export type LinkClaimStatus = InviteStatus | 'already_invited';

/** Result of creating an invitation record, before its email is sent. */
export interface CreatedInvitation<Status extends LinkClaimStatus = InviteStatus> {
  /** What happened. */
  status: Status;
  /**
   * The new invitation's ID, or `null` when none was created (the person was
   * already a member, or a claimed link kept an invitation a person sent).
   */
  invitationId: string | null;
  /**
   * Renders the email to send. Call it once the transaction has committed,
   * next to sending it, so no locks are held while it renders.
   */
  renderEmail: () => Promise<Email>;
}

/** The invitation {@link createInvitationRecord} creates, whoever it's from. */
interface InvitationRecordInput {
  /** The company or staff. */
  target: InviteDestination;
  /** Normalized email address. */
  email: string;
  /** Role to give; must fit the company. */
  role: Role;
  /** ID of the user sending it (or who created the invite link), if any. */
  invitedBy: string | null;
  /** App URL for the link. */
  baseUrl: string;
  /**
   * The invitation's language (`invitation.locale`): its email, resends and
   * reminder are written in it, unless the invitee has an account with a
   * saved language.
   */
  locale: Locale;
}

/** An invitation someone sends by email: the recipient gets an invitation naming them. */
interface SentInvitationInput extends InvitationRecordInput {
  /** Not from an invite link. */
  fromLink: false;
  /** Name of the person sending it, for the email. */
  inviterName: string;
}

/** The invitation a claimed invite link turns into: the recipient gets a confirmation email. */
interface LinkInvitationInput extends InvitationRecordInput {
  /** From an invite link. */
  fromLink: true;
}

/**
 * Creates an invitation, or prepares an "already a member" email. Doesn't
 * check permissions; callers must have done so, and call it in a
 * transaction.
 *
 * Any earlier open invitation for the same email and target is revoked, so
 * only the newest link works. That holds for requests at the same moment
 * too (two admins or tabs, a resend, an invite link claimed meanwhile): the
 * newest wins, as if they had come one after another, and neither fails.
 *
 * Except for a claimed invite link (`fromLink`): it never replaces an open
 * invitation that a person sent (one no invite link points to), since anyone
 * holding a link for the target could otherwise cancel or downgrade the
 * invitation an Admin sent to an address they know. The claim then keeps that
 * invitation, creates none, and the address gets an "already invited" email
 * pointing to the earlier invitation (`already_invited`, with no
 * invitation ID): whoever claimed the link sees the same answer as for any
 * other address, and the link is used up all the same. An open invitation
 * that came from another invite link (one points to it, also after a resend)
 * is still replaced.
 *
 * Why a lock: the partial unique indexes `invitation_open_company_email_idx`
 * and `invitation_open_staff_email_idx` allow one open invitation per
 * address and target, and a revoke can't see an invitation another
 * transaction hasn't committed yet. Without the lock, the second request's
 * insert would wait for the first transaction and then fail on the index.
 * So each call first takes a transaction-scoped advisory lock on the target
 * and address: the second waits until the first has committed, and its
 * revoke, a new statement at READ COMMITTED (the default, which no caller
 * changes), then sees and revokes the first one's invitation. Catching the
 * unique violation instead would abort the caller's transaction (Postgres
 * aborts it on any failed statement outside a savepoint), and
 * `registerCompany` would report one that escaped as a taken URL name.
 *
 * The lock is taken before anything is read, so a member's request (which
 * creates no invitation) waits like anyone else's and responses stay alike.
 * Resending and revoking take the same lock ({@link lockInvitationsOf}) and
 * check the invitation is still open once they hold it, so they take turns
 * with this too, and so do removals and deletions revoking the invitations
 * addressed to someone ({@link revokeInvitationsTo}). The lock itself can't
 * deadlock: before it, callers take only locks that come earlier in the lock
 * order (see "Lock order" in `docs/security-measures.md`): the actor's user
 * and membership rows `FOR SHARE` (`assertStillManages`), the invite link a
 * resend re-points, the creator's row, the invite link and the rate-limit
 * rows a claim uses, or the company they've just created. (Row locks keep
 * one order as well: an invite link before invitations, here and in
 * {@link revokeInvitesWithoutManager}.) Two keys with the same hash only make
 * unrelated requests take turns.
 *
 * @param tx - Transaction (the lock lasts until it ends).
 * @param input - Invitation details: someone sending it (with their name), or a claimed invite
 *   link (`fromLink`, whose recipient gets a confirmation email instead of an invitation).
 * @returns What happened, and how to render the email to send once committed.
 */
export async function createInvitationRecord(
  tx: DatabaseTransaction,
  input: SentInvitationInput,
): Promise<CreatedInvitation>;

/**
 * Creates the invitation a claimed invite link turns into (see the overload
 * above), keeping an open invitation a person sent to the address instead.
 *
 * @param tx - Transaction (the lock lasts until it ends).
 * @param input - Invitation details, `fromLink`.
 * @returns What happened (`already_invited` when it kept a person's invitation) and the email to
 *   send.
 */
export async function createInvitationRecord(
  tx: DatabaseTransaction,
  input: LinkInvitationInput,
): Promise<CreatedInvitation<LinkClaimStatus>>;

/**
 * The implementation of both overloads above.
 *
 * @param tx - Transaction (the lock lasts until it ends).
 * @param input - Invitation details.
 * @returns What happened and the email to send.
 */
export async function createInvitationRecord(
  tx: DatabaseTransaction,
  input: SentInvitationInput | LinkInvitationInput,
): Promise<CreatedInvitation<LinkClaimStatus>> {
  const { target, email, role, invitedBy, baseUrl, locale } = input;
  // One request per target and address at a time, until its transaction ends (see above).
  await lockInvitationsOf(tx, target.companyId, email);

  const [existingUser] = await tx
    .select({ id: user.id, platformRole: user.platformRole, locale: user.locale })
    .from(user)
    .where(eq(user.email, email));
  // Someone with an account reads their own language while it's offered; anyone else the
  // invitation's.
  const { offered } = await loadLanguageSettings(tx);
  const inviteeLocale = offeredLocale(existingUser?.locale, offered) ?? locale;

  if (existingUser) {
    let alreadyIn = existingUser.platformRole !== null;
    if (target.companyId !== null) {
      const [existingMembership] = await tx
        .select({ id: membership.id })
        .from(membership)
        .where(
          and(eq(membership.companyId, target.companyId), eq(membership.userId, existingUser.id)),
        );
      alreadyIn = Boolean(existingMembership);
    }
    if (alreadyIn) {
      return {
        status: 'already_member',
        invitationId: null,
        /**
         * Renders the "already a member" email, once the transaction has committed.
         *
         * @returns The email.
         */
        renderEmail: () =>
          alreadyMemberEmail(email, {
            appUrl: baseUrl,
            locale: inviteeLocale,
            companyName: target.name,
            url: `${baseUrl}${joinedPath(target.companyId)}`,
          }),
      };
    }
  }

  if (input.fromLink) {
    // A new statement under the lock: it sees an invitation sent (or resent, re-pointing its
    // link) just before. At most one is open per target and address (the partial unique indexes).
    const [sentByPerson] = await tx
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          sameTarget(invitation.companyId, target.companyId),
          eq(invitation.email, email),
          isNull(invitation.acceptedAt),
          isNull(invitation.revokedAt),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(inviteLink)
              .where(eq(inviteLink.invitationId, invitation.id)),
          ),
        ),
      );
    if (sentByPerson) {
      return {
        status: 'already_invited',
        invitationId: null,
        /**
         * Renders the "already invited" email, once the transaction has committed, in the
         * language of whoever claimed the link.
         *
         * @returns The email.
         */
        renderEmail: () =>
          alreadyInvitedEmail(email, { appUrl: baseUrl, locale, companyName: target.name }),
      };
    }
  }

  await tx
    .update(invitation)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        sameTarget(invitation.companyId, target.companyId),
        eq(invitation.email, email),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
      ),
    );

  const token = generateToken();
  const created = firstRow(
    await tx
      .insert(invitation)
      .values({
        companyId: target.companyId,
        email,
        role,
        tokenHash: hashToken(token),
        invitedBy,
        locale,
        expiresAt: sql`now() + make_interval(days => ${INVITATION_VALID_DAYS})`,
      })
      .returning({ id: invitation.id }),
    'the new invitation',
  );

  const details = {
    appUrl: baseUrl,
    companyName: target.name,
    role,
    url: `${baseUrl}/invite/${token}`,
    validDays: INVITATION_VALID_DAYS,
  };
  return {
    status: existingUser ? 'sent_existing_user' : 'sent',
    invitationId: created.id,
    // A link's confirmation is in the language of whoever claimed it (they just did).
    renderEmail: input.fromLink
      ? () => inviteLinkConfirmationEmail(email, { ...details, locale })
      : () =>
          invitationEmail(email, {
            ...details,
            locale: inviteeLocale,
            inviterName: input.inviterName,
          }),
  };
}

/**
 * Creates an invitation sent by a user and records it in the audit log, in
 * the caller's transaction. A resend is recorded as `resent` instead of with
 * the invitation's status. Doesn't check permissions or limits; callers must
 * have done so, and send the email once the transaction is committed.
 *
 * @param ctx - Service context (for the app URL and the audit log).
 * @param tx - Transaction.
 * @param actor - Who's sending it.
 * @param input - The invitation.
 * @param input.target - The company or staff.
 * @param input.email - Normalized email address.
 * @param input.role - Role to give; must fit the company.
 * @param input.resent - Whether it replaces an earlier invitation.
 * @param input.locale - The invitation's language; by default Adiutor's default
 *   language, else English (US).
 * @returns What happened and the email to send.
 */
export async function createSentInvitation(
  ctx: ServiceContext,
  tx: DatabaseTransaction,
  actor: Actor,
  input: {
    target: InviteDestination;
    email: string;
    role: Role;
    resent?: boolean;
    locale?: Locale;
  },
): Promise<CreatedInvitation> {
  const { target, email, role } = input;
  const created = await createInvitationRecord(tx, {
    target,
    email,
    role,
    invitedBy: actor.id,
    fromLink: false,
    inviterName: displayName(actor),
    baseUrl: ctx.baseUrl,
    locale: input.locale ?? (await recipientLocale(ctx)),
  });
  await recordEvent(
    ctx,
    {
      action: 'invitation_sent',
      actorUserId: actor.id,
      ...auditTarget(target.companyId, {
        email,
        role,
        ...(input.resent ? { resent: true } : { status: created.status }),
      }),
    },
    tx,
  );
  return created;
}
