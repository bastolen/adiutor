/**
 * @file The open invitations of a company or the staff: listing, resending and
 * revoking them.
 */
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { invitation, inviteLink } from '@/db/schema';
import { type Role } from '@/lib/authz/roles';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { INVITATIONS_TABLE, type InvitationSort } from '@/lib/tables/tables';

import {
  assertConfirmedForGrant,
  assertStillManagesPeople,
  getTargetAccess,
  assertNotSignedInAs,
} from '../../access';
import type { Actor } from '../../actor';
import { recordEvent } from '../../audit';
import { loadEmailBrand } from '../../branding';
import type { ServiceContext } from '../../context';
import { forbiddenError, notFoundError, parseId } from '../../errors';
import { orderTerms, paginate } from '../../pagination';
import { lockInvitationsOf } from './locks';
import { createSentInvitation } from './record';
import {
  sameTarget,
  assertCanManage,
  assertInviteRateLimits,
  assertInvitable,
  auditTarget,
} from './rules';

/** An open invitation as shown on the members page. */
export interface PendingInvitation {
  /** Invitation ID. */
  id: string;
  /** Invited email address. */
  email: string;
  /** Role they'll get. */
  role: Role;
  /** When the link stops working. */
  expiresAt: Date;
  /** Whether the link has stopped working. */
  expired: boolean;
  /** When it was sent. */
  createdAt: Date;
  /**
   * Whether it was sent by claiming an invite link (an invite link points to
   * it, also after a resend), so Finance and Support can't accept it.
   */
  fromInviteLink: boolean;
}

/**
 * Lists the open invitations of a company or staff (not accepted or
 * revoked; expired ones included so they can be resent), one page at a time,
 * with whether each came from an invite link.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:view`, or `staff:manage` for staff.
 * @param companyId - The company, or `null` for staff.
 * @param options - Sort and page (by default newest first, the first page).
 * @returns The page of invitations.
 */
export async function listPendingInvitations(
  ctx: ServiceContext,
  actor: Actor,
  companyId: string | null,
  options: Partial<TableState<InvitationSort>> = {},
): Promise<Paged<PendingInvitation>> {
  const access = await getTargetAccess(ctx.db, actor, companyId);
  if (!access.canView) {
    throw forbiddenError();
  }
  const state = resolveTableState(INVITATIONS_TABLE, options);
  const where = and(
    sameTarget(invitation.companyId, access.company?.id ?? null),
    isNull(invitation.acceptedAt),
    isNull(invitation.revokedAt),
  );
  // Addresses are stored in lower case, so they sort the same in any collation.
  const order =
    state.sort === 'email'
      ? orderTerms(state.dir, invitation.email, invitation.id)
      : orderTerms(state.dir, invitation.createdAt, invitation.id);
  return paginate(
    state,
    () => ctx.db.$count(invitation, where),
    (limit, offset) =>
      ctx.db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          expired: sql<boolean>`${invitation.expiresAt} <= now()`,
          createdAt: invitation.createdAt,
          // The subquery builder names both tables (a plain `sql` here would leave
          // `invitation.id` unqualified, which inside the subquery means `invite_link.id`).
          fromInviteLink: exists(
            ctx.db
              .select({ one: sql`1` })
              .from(inviteLink)
              .where(eq(inviteLink.invitationId, invitation.id)),
          ).mapWith(Boolean),
        })
        .from(invitation)
        .where(where)
        .orderBy(...order)
        .limit(limit)
        .offset(offset),
  );
}

/**
 * Loads an open invitation of a company or staff, for resending or
 * revoking.
 *
 * @param tx - Database client or transaction.
 * @param companyId - The company, or `null` for staff.
 * @param invitationId - The invitation (unvalidated input is fine).
 * @returns The invitation.
 * @throws {ServiceError} `not_found` if it doesn't exist, belongs elsewhere or is closed.
 */
async function findTargetInvitation(
  tx: DatabaseOrTransaction,
  companyId: string | null,
  invitationId: string,
) {
  const id = parseId(invitationId);
  const [found] = await tx
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.id, id),
        sameTarget(invitation.companyId, companyId),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
      ),
    );
  if (!found) {
    throw notFoundError();
  }
  return found;
}

/**
 * Sends a fresh link for an open invitation; the old link stops working. The
 * actor's rights are checked again as the first step of the transaction
 * (`assertStillManagesPeople`), before the per-address lock.
 *
 * An invitation that came from an invite link stays one: the resend locks the
 * link that points to it (before the per-address lock: invite links come
 * first in the lock order) and points it at the new invitation, so Finance
 * and Support still can't accept it (`isFromInviteLink`), and the pending
 * list still says where it came from.
 *
 * The new invitation keeps the language the invitation was sent in
 * (`invitation.locale`); an invitee who has an account with a saved language
 * gets that instead.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`, or `staff:manage` for staff.
 * @param input - Which invitation.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.invitationId - The invitation.
 */
export async function resendInvitation(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string | null; invitationId: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  const companyId = access.company?.id ?? null;
  // A fresh link for a staff role, or a company's Admin role, needs a recent confirmation too;
  // checked before the limits count (the role can't change, so reading it unlocked is enough).
  const pending = await findTargetInvitation(ctx.db, companyId, input.invitationId);
  assertConfirmedForGrant(actor, { target: access.target, role: pending.role });
  await assertInviteRateLimits(ctx, actor, companyId);
  const created = await ctx.db.transaction(async (tx) => {
    // First, before the per-address lock (see "Lock order" in `docs/security-measures.md`).
    await assertStillManagesPeople(tx, actor, companyId);
    const found = await findTargetInvitation(tx, companyId, input.invitationId);
    // The invite link it came from, if any, before the per-address lock (see "Lock order" in
    // `docs/security-measures.md`). Locked, so a resend at the same moment waits here.
    const links = await tx
      .select({ id: inviteLink.id })
      .from(inviteLink)
      .where(eq(inviteLink.invitationId, found.id))
      .orderBy(inviteLink.id)
      .for('update');
    // Take turns with other requests for the address, then check it's still open: a revoke or
    // resend at the same moment may have closed it meanwhile.
    await lockInvitationsOf(tx, companyId, found.email);
    const existing = await findTargetInvitation(tx, companyId, found.id);
    assertInvitable(access, existing.role);
    const resent = await createSentInvitation(ctx, tx, actor, {
      target: { companyId, name: access.name },
      email: existing.email,
      role: existing.role,
      resent: true,
      locale: existing.locale,
    });
    // Still from the link: Finance and Support mustn't be able to accept it now.
    if (links.length > 0 && resent.invitationId) {
      await tx
        .update(inviteLink)
        .set({ invitationId: resent.invitationId })
        .where(
          inArray(
            inviteLink.id,
            links.map((link) => link.id),
          ),
        );
    }
    return resent;
  });
  // Rendered only now, once the transaction has committed and released its locks.
  await ctx.sendEmail(await created.renderEmail(await loadEmailBrand(ctx.db)));
}

/**
 * Revokes an open invitation; its link stops working. The actor's rights are
 * checked again as the first step of the transaction
 * (`assertStillManagesPeople`), before the per-address lock.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`, or `staff:manage` for staff.
 * @param input - Which invitation.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.invitationId - The invitation.
 */
export async function revokeInvitation(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string | null; invitationId: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  const companyId = access.company?.id ?? null;
  await ctx.db.transaction(async (tx) => {
    // First, before the per-address lock (see "Lock order" in `docs/security-measures.md`).
    await assertStillManagesPeople(tx, actor, companyId);
    const found = await findTargetInvitation(tx, companyId, input.invitationId);
    // Take turns with a resend at the same moment, which would otherwise send a new link for the
    // invitation this revokes (see `createInvitationRecord`).
    await lockInvitationsOf(tx, companyId, found.email);
    const existing = await findTargetInvitation(tx, companyId, found.id);
    await tx
      .update(invitation)
      .set({ revokedAt: sql`now()` })
      .where(eq(invitation.id, existing.id));
    await recordEvent(
      ctx,
      {
        action: 'invitation_revoked',
        actorUserId: actor.id,
        ...auditTarget(companyId, { email: existing.email, role: existing.role }),
      },
      tx,
    );
  });
}
