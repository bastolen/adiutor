/**
 * @file A link that can still be used: unused, not revoked, not expired,
 * and for the staff or an active company. What its public page shows, and
 * how a claim or joining uses it up, so two people can't both use it.
 */
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { company, inviteLink } from '@/db/schema';
import { hashToken } from '@/lib/sign-in/tokens';

import type { ServiceContext } from '../../context';
import type { InvitationPreview } from '../invitations';
import getStaffName from '../staff-name';

/**
 * The conditions for a link that can still be used: unused, not revoked, not
 * expired, and for staff or an active company.
 *
 * @param token - The token from the link.
 * @returns The SQL condition.
 */
export function usableLink(token: string) {
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
    role: found.role,
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
export async function useLink(tx: DatabaseOrTransaction, token: string, email: string) {
  const [used] = await tx
    .update(inviteLink)
    .set({ usedAt: sql`now()`, usedByEmail: email })
    .where(usableLink(token))
    .returning();
  return used ?? null;
}
