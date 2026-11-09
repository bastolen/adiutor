/**
 * @file Single-use invite links to a company or to the staff (no
 * company).
 *
 * An admin creates a link for a role. The first person to open it enters
 * their email address, which uses up the link and turns it into a normal
 * email invitation for that address. That proves they own the address and
 * reuses the one acceptance flow. A signed-in user can instead join directly
 * with their own account.
 *
 * Whatever email is entered, the response is the same "check your inbox",
 * and the link is used up: an open invitation someone sent to that address
 * is kept rather than replaced. Each claim counts against the invitation
 * limits of the link's creator and its company, like an invitation they send.
 */
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction, DatabaseTransaction } from '@/db';
import { company, inviteLink, session, user } from '@/db/schema';
import { mayUseInviteLinks } from '@/lib/authz/permissions';
import { type PlatformRole, ROLE_LABELS, type Role } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { isInviteLinkValidity } from '@/lib/invitation-lifetimes';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { INVITE_LINKS_TABLE, type InviteLinkSort } from '@/lib/tables/tables';
import { emailSchema, roleSchema } from '@/lib/validation';

import {
  assertConfirmedForGrant,
  assertStillManages,
  getTargetAccess,
  managePermission,
} from '../access';
import type { Actor } from '../actor';
import notifyStaffAdminAdded from './staff-admin-notice';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { forbiddenError, notFoundError, ServiceError, parseId } from '../errors';
import {
  assertCanManage,
  assertInvitable,
  auditTarget,
  createInvitationRecord,
  type InvitationPreview,
  inviteLinksNotAllowedError,
  joinTarget,
  sameTarget,
} from './invitations';
import { orderTerms, paginate } from '../pagination';
import {
  assertInviteCompanyLimit,
  assertInviteSenderLimit,
  assertRateLimit,
  RATE_LIMITS,
} from '../rate-limit';
import recipientLocale from '../recipient-locale';
import getStaffName from './staff-name';

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
 * again as they are by then (`assertStillManages`): a link created by an
 * Admin demoted, removed or deactivated at that moment would otherwise escape
 * `revokeInvitesWithoutManager`.
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
  const role = roleSchema.parse(input.role);
  if (!isInviteLinkValidity(input.validDays)) {
    throw new ServiceError('invalid', 'Choose how long the link stays valid.');
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
    await assertStillManages(tx, actor, companyId, managePermission(companyId));
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
 * (`assertStillManages`).
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
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  const companyId = access.company?.id ?? null;
  const id = parseId(input.linkId);
  await ctx.db.transaction(async (tx) => {
    // The rights the actor was loaded with may be gone by now: only their rows as locked count.
    await assertStillManages(tx, actor, companyId, managePermission(companyId));
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

/**
 * The conditions for a link that can still be used: unused, not revoked, not
 * expired, and for staff or an active company.
 *
 * @param token - The token from the link.
 * @returns The SQL condition.
 */
function usableLink(token: string) {
  return and(
    eq(inviteLink.tokenHash, hashToken(token)),
    isNull(inviteLink.usedAt),
    isNull(inviteLink.revokedAt),
    gt(inviteLink.expiresAt, sql`now()`),
    or(
      isNull(inviteLink.companyId),
      sql`exists (select 1 from ${company} where ${company.id} = ${inviteLink.companyId} and ${company.deactivatedAt} is null)`,
    ),
  );
}

/**
 * Describes a usable link for its public page.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @returns The preview, or `null` if the link can't be used.
 */
export async function getInviteLinkPreview(
  ctx: ServiceContext,
  token: string,
): Promise<InvitationPreview | null> {
  const [found] = await ctx.db
    .select({ companyName: company.name, role: inviteLink.role })
    .from(inviteLink)
    .leftJoin(company, eq(company.id, inviteLink.companyId))
    .where(usableLink(token));
  if (!found) {
    return null;
  }
  return {
    companyName: found.companyName ?? (await getStaffName(ctx.db)),
    roleLabel: ROLE_LABELS[found.role],
  };
}

/**
 * Uses up a link in one atomic update, so two people can't both use it.
 *
 * @param tx - Transaction.
 * @param token - The token from the link.
 * @param email - The email address of whoever uses it.
 * @returns The used link, or `null` if it wasn't usable.
 */
async function useLink(tx: DatabaseOrTransaction, token: string, email: string) {
  const [used] = await tx
    .update(inviteLink)
    .set({ usedAt: sql`now()`, usedByEmail: email })
    .where(usableLink(token))
    .returning();
  return used ?? null;
}

/**
 * Why a claim is refused when its link's creator, or its company (or the
 * staff), has sent as many invitations as the limits allow for now. Says
 * nothing about the address entered.
 */
export const LINK_CLAIM_LIMITED_MESSAGE =
  "This invite link can't be used right now. Try again later.";

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

/**
 * Uses a link by entering an email address. The link turns into an email
 * invitation for that address (or an "already a member" email, or an
 * "already invited" one when the address has an open invitation a person
 * sent, which the claim keeps; see `createInvitationRecord`), so the response
 * is the same whatever the address, and the link is used up either way.
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
  const request = ctx.requestInfo ? await ctx.requestInfo() : null;
  // The confirmation is in the language of whoever opened the link, and so is the invitation.
  const locale = await recipientLocale(ctx);
  await assertRateLimit(
    ctx,
    `invite-link-claim:ip:${request?.ip ?? 'unknown'}`,
    RATE_LIMITS.linkClaimsPerIp,
  );
  const created = await ctx.db.transaction(async (tx) => {
    const [usable] = await tx
      .select({ createdBy: inviteLink.createdBy })
      .from(inviteLink)
      .where(usableLink(token));
    if (!usable) {
      return null;
    }
    // The creator before the link: user rows come before invite links in the lock order.
    if (usable.createdBy) {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, usable.createdBy))
        .for('key share');
    }
    const used = await useLink(tx, token, email);
    if (!used) {
      return null;
    }
    // After the link (the bucket rows come after invite links in the lock order), before the
    // per-address lock; a refusal rolls back, so the link stays unused.
    await assertClaimLimits(tx, used.createdBy, used.companyId);
    let name = await getStaffName(tx);
    if (used.companyId !== null) {
      ({ name } = firstRow(
        await tx.select({ name: company.name }).from(company).where(eq(company.id, used.companyId)),
        "the link's company",
      ));
    }
    // Keeps an open invitation a person sent to the address (`already_invited`), creating none.
    const result = await createInvitationRecord(tx, {
      target: { companyId: used.companyId, name },
      email,
      role: used.role,
      invitedBy: used.createdBy,
      fromLink: true,
      baseUrl: ctx.baseUrl,
      locale,
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
    return result;
  });

  if (!created) {
    return { status: 'invalid' };
  }
  // Rendered only now, once the transaction has committed and released its locks.
  await ctx.sendEmail(await created.renderEmail());
  return { status: 'sent' };
}

/**
 * Uses a link to join directly as the signed-in user. Joining a company
 * you're already in keeps your current role, and so does joining the staff
 * when you're already on it. `companyId` is `null` after joining the staff.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @param signedIn - The signed-in user.
 * @param signedIn.id - Their user ID.
 * @param signedIn.email - Their email address.
 * @param signedIn.platformRole - Their staff role; Finance and Support may not use invite links.
 * @param signedIn.sessionId - The session they join with. Unlike an emailed invitation, a link
 *   proves no inbox, so when the new role requires MFA this session ends too unless it was
 *   confirmed with a strong factor (`withMfaPromotion`).
 * @returns What was joined (and whether that ended the session it was joined with), or
 *   `invalid` if the link wasn't usable.
 * @throws {ServiceError} `forbidden` for Finance and Support (see `mayUseInviteLinks`).
 */
export async function joinWithInviteLink(
  ctx: ServiceContext,
  token: string,
  signedIn: {
    id: string;
    email: string;
    platformRole: PlatformRole | null;
    sessionId?: string | null;
  },
): Promise<
  { status: 'joined'; companyId: string | null; signedOut: boolean } | { status: 'invalid' }
> {
  // Checked before the link is used up, so it still works for whoever it was meant for.
  if (!mayUseInviteLinks(signedIn.platformRole)) {
    throw inviteLinksNotAllowedError();
  }
  const { result, newStaffAdmin } = await ctx.db.transaction(async (tx) => {
    const used = await useLink(tx, token, signedIn.email.toLowerCase());
    if (!used) {
      return { result: { status: 'invalid' as const }, newStaffAdmin: null };
    }
    const becameStaffAdmin = await joinTarget(ctx, tx, {
      companyId: used.companyId,
      role: used.role,
      userId: signedIn.id,
      details: { via: 'invite_link' },
    });
    const [still] = signedIn.sessionId
      ? await tx.select({ id: session.id }).from(session).where(eq(session.id, signedIn.sessionId))
      : [];
    return {
      result: {
        status: 'joined' as const,
        companyId: used.companyId,
        signedOut: Boolean(signedIn.sessionId) && !still,
      },
      newStaffAdmin: becameStaffAdmin
        ? { newAdminId: signedIn.id, how: 'invitation' as const, byUserId: used.createdBy }
        : null,
    };
  });
  // Once committed: the other staff Admins hear about a new one.
  if (newStaffAdmin) {
    await notifyStaffAdminAdded(ctx, newStaffAdmin);
  }
  return result;
}
