/**
 * @file Opening an invitation's link and accepting it, signed in or by creating
 * an account, which joins the company or the staff.
 */
import { hashPassword } from 'better-auth/crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { company, invitation, inviteLink, membership, user } from '@/db/schema';
import { mayUseInviteLinks } from '@/lib/authz/permissions';
import {
  isCompanyRole,
  isPlatformRole,
  PLATFORM_ADMIN_ROLE,
  type PlatformRole,
  type Role,
} from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { hashToken } from '@/lib/sign-in/tokens';
import {
  CHOOSE_COMPANY_ROLE_MESSAGE,
  CHOOSE_STAFF_ROLE_MESSAGE,
  nameSchema,
  passwordSchema,
} from '@/lib/validation';

import { assertNotSignedInAs } from '../../access';
import { type Actor } from '../../actor';
import { recordEvent } from '../../audit';
import { withMfaPromotion } from '../../auth/mfa-promotion';
import addPasswordCredential from '../../auth/password-credential';
import type { ServiceContext } from '../../context';
import { ServiceError } from '../../errors';
import notifyStaffAdminAdded, { type StaffAdminAdded } from '../staff-admin-notice';
import getStaffName from '../staff-name';
import { auditTarget } from './rules';

/**
 * Finds a usable invitation by the token in its link: not accepted, revoked
 * or expired, for staff or an active company.
 *
 * @param tx - Database client or transaction.
 * @param token - The token from the link.
 * @param lock - Lock the row until the transaction ends (when accepting).
 * @returns The invitation and its company (`null` for staff), or `null`.
 */
async function findUsableInvitation(tx: DatabaseOrTransaction, token: string, lock = false) {
  // For staff invitations there's no company, so the deactivation check below passes.
  const query = tx
    .select({ invitation, company })
    .from(invitation)
    .leftJoin(company, eq(company.id, invitation.companyId))
    .where(
      and(
        eq(invitation.tokenHash, hashToken(token)),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
        gt(invitation.expiresAt, sql`now()`),
        isNull(company.deactivatedAt),
      ),
    );
  const [found] = lock ? await query.for('update', { of: invitation }) : await query;
  return found ?? null;
}

/** What the public invitation page may show. */
export interface InvitationPreview {
  /** Name of the company, or of the staff. */
  companyName: string;
  /** The role offered; the page names it in the reader's language (`roles.<role>.label`). */
  role: Role;
}

/** An invitation as shown on its public page. */
export interface InvitationDetails extends InvitationPreview {
  /** Whether it was sent by claiming an invite link (Finance and Support can't accept those). */
  fromInviteLink: boolean;
}

/**
 * The refusal for Finance and Support using an invite link, directly or
 * through the invitation a link sent them (see `mayUseInviteLinks`).
 *
 * @returns The error.
 */
export function inviteLinksNotAllowedError(): ServiceError {
  return new ServiceError('forbidden', 'errors.inviteLinks.notAllowed');
}

/**
 * Checks whether an invitation was sent by claiming an invite link (rather
 * than by someone inviting the address).
 *
 * @param tx - Database client or transaction.
 * @param invitationId - The invitation.
 * @returns Whether a link turned into this invitation.
 */
async function isFromInviteLink(tx: DatabaseOrTransaction, invitationId: string): Promise<boolean> {
  const [link] = await tx
    .select({ id: inviteLink.id })
    .from(inviteLink)
    .where(eq(inviteLink.invitationId, invitationId))
    .limit(1);
  return Boolean(link);
}

/**
 * Describes an invitation for its public page. Doesn't include the invited
 * email address.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @returns The preview, or `null` if the link can't be used.
 */
export async function getInvitationPreview(
  ctx: ServiceContext,
  token: string,
): Promise<InvitationDetails | null> {
  const found = await findUsableInvitation(ctx.db, token);
  if (!found) {
    return null;
  }
  const [companyName, fromInviteLink] = await Promise.all([
    found.company?.name ?? getStaffName(ctx.db),
    isFromInviteLink(ctx.db, found.invitation.id),
  ]);
  return { companyName, role: found.invitation.role, fromInviteLink };
}

/**
 * Makes the change of `joinTarget`.
 *
 * @param ctx - Service context (for the audit log).
 * @param tx - Transaction.
 * @param input - What to join (see `joinTarget`).
 * @param input.companyId - The company, or `null` for staff.
 * @param input.role - The role to give.
 * @param input.userId - The user joining.
 * @param input.details - Extra audit log details.
 * @returns Whether it made the user a staff Admin (they weren't on the staff before).
 */
async function join(
  ctx: ServiceContext,
  tx: DatabaseOrTransaction,
  input: { companyId: string | null; role: Role; userId: string; details: Record<string, unknown> },
): Promise<boolean> {
  const { companyId, role, userId } = input;
  let becameStaffAdmin = false;
  if (companyId === null) {
    if (!isPlatformRole(role)) {
      throw new ServiceError('invalid', CHOOSE_STAFF_ROLE_MESSAGE);
    }
    const joined = await tx
      .update(user)
      .set({ platformRole: role })
      .where(and(eq(user.id, userId), isNull(user.platformRole)))
      .returning({ id: user.id });
    becameStaffAdmin = joined.length > 0 && role === PLATFORM_ADMIN_ROLE;
  } else {
    if (!isCompanyRole(role)) {
      throw new ServiceError('invalid', CHOOSE_COMPANY_ROLE_MESSAGE);
    }
    await tx
      .insert(membership)
      .values({ companyId, userId, role })
      .onConflictDoNothing({ target: [membership.companyId, membership.userId] });
  }
  await recordEvent(
    ctx,
    {
      action: 'member_joined',
      actorUserId: userId,
      targetUserId: userId,
      ...auditTarget(companyId, { role, ...input.details }),
    },
    tx,
  );
  return becameStaffAdmin;
}

/**
 * Gives a user what an invitation or invite link is for: a membership in the
 * company (keeping their role if they're already a member), or the platform
 * staff role (when they aren't on it yet).
 *
 * @param ctx - Service context (for the audit log).
 * @param tx - Transaction.
 * @param input - What to join.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.role - The role to give.
 * @param input.userId - The user joining.
 * @param input.details - Extra audit log details, e.g. `{ via: 'invite_link' }`.
 * @param input.sessionId - The session they accept an emailed invitation with themselves, if
 *   any: it stays when the new role requires MFA, while their other sessions without it end
 *   (`withMfaPromotion`). Not for invite links, which prove no inbox.
 * @returns Whether it made the user a staff Admin, so the other staff Admins can be told.
 */
export async function joinTarget(
  ctx: ServiceContext,
  tx: DatabaseOrTransaction,
  input: {
    companyId: string | null;
    role: Role;
    userId: string;
    details: Record<string, unknown>;
    sessionId?: string | null;
  },
): Promise<boolean> {
  return withMfaPromotion(ctx, tx, [input.userId], () => join(ctx, tx, input), {
    keepSessionId: input.sessionId,
    companyId: input.companyId,
  });
}

/**
 * Gives the user what the invitation is for and marks it accepted.
 *
 * @param ctx - Service context (for the audit log).
 * @param tx - Transaction.
 * @param accepted - The invitation being accepted.
 * @param userId - The user joining.
 * @param sessionId - The session they accept it with, if signed in (see `joinTarget`).
 * @returns Whether accepting it made the user a staff Admin.
 */
async function acceptAs(
  ctx: ServiceContext,
  tx: DatabaseOrTransaction,
  accepted: typeof invitation.$inferSelect,
  userId: string,
  sessionId: string | null = null,
): Promise<boolean> {
  const becameStaffAdmin = await joinTarget(ctx, tx, {
    companyId: accepted.companyId,
    role: accepted.role,
    userId,
    details: { email: accepted.email },
    sessionId,
  });
  await tx
    .update(invitation)
    .set({ acceptedAt: sql`now()` })
    .where(eq(invitation.id, accepted.id));
  return becameStaffAdmin;
}

/** Result of accepting an invitation as a signed-in user. */
export type AcceptResult =
  | { status: 'joined'; companyId: string | null }
  | { status: 'invalid' }
  | { status: 'wrong_account' };

/**
 * Accepts an invitation as the signed-in user, who must have the invited email
 * address. Joining a company you're already in keeps your current role, and
 * so does joining the staff when you're already on it. `companyId` is `null`
 * after joining the staff.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @param signedIn - The signed-in user.
 * @param signedIn.id - Their user ID.
 * @param signedIn.email - Their email address.
 * @param signedIn.platformRole - Their staff role; Finance and Support can't accept an invitation
 *   that came from an invite link.
 * @param signedIn.sessionId - The session they accept it with, which stays when the new role
 *   requires MFA (see `joinTarget`).
 * @param signedIn.signedInAs - The staff member signed in as them, if any: they accept nothing.
 * @returns What happened.
 * @throws {ServiceError} `forbidden` for Finance and Support with an invitation from a link;
 *   `signed_in_as` while a staff member is signed in as them.
 */
export async function acceptInvitation(
  ctx: ServiceContext,
  token: string,
  signedIn: {
    id: string;
    email: string;
    platformRole: PlatformRole | null;
    sessionId?: string | null;
    signedInAs?: Actor['signedInAs'];
  },
): Promise<AcceptResult> {
  assertNotSignedInAs(signedIn);
  const { result, newStaffAdmin } = await ctx.db.transaction(
    async (tx): Promise<{ result: AcceptResult; newStaffAdmin: StaffAdminAdded | null }> => {
      const found = await findUsableInvitation(tx, token, true);
      if (!found) {
        return { result: { status: 'invalid' }, newStaffAdmin: null };
      }
      if (found.invitation.email !== signedIn.email.toLowerCase()) {
        return { result: { status: 'wrong_account' }, newStaffAdmin: null };
      }
      if (
        !mayUseInviteLinks(signedIn.platformRole) &&
        (await isFromInviteLink(tx, found.invitation.id))
      ) {
        throw inviteLinksNotAllowedError();
      }
      const becameStaffAdmin = await acceptAs(
        ctx,
        tx,
        found.invitation,
        signedIn.id,
        signedIn.sessionId ?? null,
      );
      return {
        result: { status: 'joined', companyId: found.invitation.companyId },
        newStaffAdmin: becameStaffAdmin
          ? { newAdminId: signedIn.id, how: 'invitation', byUserId: found.invitation.invitedBy }
          : null,
      };
    },
  );
  // Once committed: the other staff Admins hear about a new one.
  if (newStaffAdmin) {
    await notifyStaffAdminAdded(ctx, newStaffAdmin);
  }
  return result;
}

/** Result of accepting an invitation by creating an account. */
export type CreateAccountResult =
  | { status: 'created'; email: string; companyId: string | null }
  | { status: 'account_exists' }
  | { status: 'invalid' };

/**
 * Accepts an invitation by creating a new account for the invited address.
 * The token proves the person can read that inbox, so the email counts as
 * verified. If the address already has an account, nothing changes and the
 * person is asked to sign in instead.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @param input - The new account's details.
 * @param input.name - Display name.
 * @param input.password - Password.
 * @returns What happened; when created, the email to sign in with.
 */
export async function acceptInvitationWithNewAccount(
  ctx: ServiceContext,
  token: string,
  input: { name: string; password: string },
): Promise<CreateAccountResult> {
  const name = nameSchema.parse(input.name);
  const password = passwordSchema.parse(input.password);
  const passwordHash = await hashPassword(password);

  const { result, newStaffAdmin } = await ctx.db.transaction(
    async (tx): Promise<{ result: CreateAccountResult; newStaffAdmin: StaffAdminAdded | null }> => {
      const found = await findUsableInvitation(tx, token, true);
      if (!found) {
        return { result: { status: 'invalid' }, newStaffAdmin: null };
      }
      const { email } = found.invitation;
      const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (existing) {
        return { result: { status: 'account_exists' }, newStaffAdmin: null };
      }

      const created = firstRow(
        await tx
          .insert(user)
          .values({ name, email, emailVerified: true })
          .returning({ id: user.id }),
        'the new user',
      );
      // The emailed invitation proves the inbox, like a password reset, so this also lifts the
      // pause from wrong passwords typed for the address before.
      await addPasswordCredential(tx, { userId: created.id, email, passwordHash });
      const becameStaffAdmin = await acceptAs(ctx, tx, found.invitation, created.id);
      return {
        result: { status: 'created', email, companyId: found.invitation.companyId },
        newStaffAdmin: becameStaffAdmin
          ? { newAdminId: created.id, how: 'invitation', byUserId: found.invitation.invitedBy }
          : null,
      };
    },
  );
  // Once committed: the other staff Admins hear about a new one.
  if (newStaffAdmin) {
    await notifyStaffAdminAdded(ctx, newStaffAdmin);
  }
  return result;
}
