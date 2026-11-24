/**
 * @file Managing invite links: an admin creates a link for a role, lists
 * the links of their company (or of the staff), and revokes one that's
 * unused. The token is shown once, when the link is created, and never
 * stored.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { inviteLink } from '@/db/schema';
import { type Role } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { isInviteLinkValidity } from '@/lib/invitation-lifetimes';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { INVITE_LINKS_TABLE, type InviteLinkSort } from '@/lib/tables/tables';
import { roleSchema } from '@/lib/validation';

import {
  assertConfirmedForGrant,
  assertNotSignedInAs,
  assertStillManagesPeople,
  getTargetAccess,
} from '../../access';
import type { Actor } from '../../actor';
import { recordEvent } from '../../audit';
import type { ServiceContext } from '../../context';
import { forbiddenError, notFoundError, parseId, ServiceError } from '../../errors';
import { orderTerms, paginate } from '../../pagination';
import { assertCanManage, assertInvitable, auditTarget, sameTarget } from '../invitations';

/** A link's state. */
export type InviteLinkStatus = 'active' | 'used' | 'expired' | 'revoked';

/** An invite link as shown on the members page (without its token). */
export interface InviteLinkSummary {
  /** Link ID. */
  id: string;
  /** Role it gives. */
  role: Role;
  /** Its state. */
  status: InviteLinkStatus;
  /** Email entered when it was used, if used. */
  usedByEmail: string | null;
  /** When it stops working. */
  expiresAt: Date;
  /** When it was created. */
  createdAt: Date;
}

/**
 * Creates a single-use invite link. The token is returned only now; it isn't
 * stored, so the link can't be shown again later. The link and its audit
 * event are written in one transaction, which first checks the actor's rights
 * again as they are by then (`assertStillManagesPeople`): a link created by
 * an Admin demoted, removed or deactivated at that moment would otherwise
 * escape `revokeInvitesWithoutManager`.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`, or `staff:manage` for staff.
 * @param input - Form input.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.role - The role the link gives.
 * @param input.validDays - How long it stays valid: 1, 7 or 30 days.
 * @returns The link and when it expires.
 */
export async function createInviteLink(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string | null; role: string; validDays: number },
): Promise<{ url: string; expiresAt: Date }> {
  assertNotSignedInAs(actor);
  const role = roleSchema.parse(input.role);
  if (!isInviteLinkValidity(input.validDays)) {
    throw new ServiceError('invalid', 'errors.inviteLinks.validity');
  }
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  assertInvitable(access, role);
  // A staff role, or a company's Admin role, needs a recent confirmation, before anything counts.
  assertConfirmedForGrant(actor, { target: access.target, role });
  const companyId = access.company?.id ?? null;

  const token = generateToken();
  const created = await ctx.db.transaction(async (tx) => {
    // The rights the actor was loaded with may be gone by now: only their rows as locked count.
    await assertStillManagesPeople(tx, actor, companyId);
    const inserted = firstRow(
      await tx
        .insert(inviteLink)
        .values({
          companyId,
          role,
          tokenHash: hashToken(token),
          createdBy: actor.id,
          expiresAt: sql`now() + make_interval(days => ${input.validDays})`,
        })
        .returning({ expiresAt: inviteLink.expiresAt }),
      'the new invite link',
    );
    await recordEvent(
      ctx,
      {
        action: 'invite_link_created',
        actorUserId: actor.id,
        ...auditTarget(companyId, { role, validDays: input.validDays }),
      },
      tx,
    );
    return inserted;
  });
  return { url: `${ctx.baseUrl}/join/${token}`, expiresAt: created.expiresAt };
}

/**
 * Lists the invite links of a company or staff, one page at a time.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:view`, or `staff:manage` for staff.
 * @param companyId - The company, or `null` for staff.
 * @param options - Sort and page (by default newest first, the first page).
 * @returns The page of links, without tokens.
 */
export async function listInviteLinks(
  ctx: ServiceContext,
  actor: Actor,
  companyId: string | null,
  options: Partial<TableState<InviteLinkSort>> = {},
): Promise<Paged<InviteLinkSummary>> {
  const access = await getTargetAccess(ctx.db, actor, companyId);
  if (!access.canView) {
    throw forbiddenError();
  }
  const state = resolveTableState(INVITE_LINKS_TABLE, options);
  const where = sameTarget(inviteLink.companyId, access.company?.id ?? null);
  const page = await paginate(
    state,
    () => ctx.db.$count(inviteLink, where),
    (limit, offset) =>
      ctx.db
        .select({
          id: inviteLink.id,
          role: inviteLink.role,
          usedAt: inviteLink.usedAt,
          usedByEmail: inviteLink.usedByEmail,
          revokedAt: inviteLink.revokedAt,
          expiresAt: inviteLink.expiresAt,
          createdAt: inviteLink.createdAt,
          expired: sql<boolean>`${inviteLink.expiresAt} <= now()`,
        })
        .from(inviteLink)
        .where(where)
        .orderBy(...orderTerms(state.dir, inviteLink.createdAt, inviteLink.id))
        .limit(limit)
        .offset(offset),
  );

  return {
    ...page,
    items: page.items.map((row) => {
      let status: InviteLinkStatus = 'active';
      if (row.revokedAt) {
        status = 'revoked';
      } else if (row.usedAt) {
        status = 'used';
      } else if (row.expired) {
        status = 'expired';
      }
      return {
        id: row.id,
        role: row.role,
        status,
        usedByEmail: row.usedByEmail,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      };
    }),
  };
}

/**
 * Revokes an unused invite link, with its audit event, in one transaction
 * that first checks the actor's rights again as they are by then
 * (`assertStillManagesPeople`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`, or `staff:manage` for staff.
 * @param input - Which link.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.linkId - The link.
 */
export async function revokeInviteLink(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string | null; linkId: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  const companyId = access.company?.id ?? null;
  const id = parseId(input.linkId);
  await ctx.db.transaction(async (tx) => {
    // The rights the actor was loaded with may be gone by now: only their rows as locked count.
    await assertStillManagesPeople(tx, actor, companyId);
    const [revoked] = await tx
      .update(inviteLink)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(inviteLink.id, id),
          sameTarget(inviteLink.companyId, companyId),
          isNull(inviteLink.usedAt),
          isNull(inviteLink.revokedAt),
        ),
      )
      .returning({ id: inviteLink.id, role: inviteLink.role });
    if (!revoked) {
      throw notFoundError();
    }
    await recordEvent(
      ctx,
      {
        action: 'invite_link_revoked',
        actorUserId: actor.id,
        ...auditTarget(companyId, { role: revoked.role }),
      },
      tx,
    );
  });
}
