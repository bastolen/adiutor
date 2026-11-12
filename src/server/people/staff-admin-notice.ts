/**
 * @file Tells the other staff Admins when someone becomes a staff Admin
 * (given the role, or by accepting an invitation or using an invite link),
 * so an account a stolen session leaves behind gets noticed. Queued once the
 * change has committed (sent at the next tick); a failure is logged and
 * never undoes it.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';

import { user } from '@/db/schema';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';

import type { ServiceContext } from '../context';
import { queueJob, staffAdminAddedJob } from '../queue';

/** Who became a staff Admin, and how. */
export interface StaffAdminAdded {
  /** The new staff Admin. */
  newAdminId: string;
  /** Given the role by a staff Admin (`role`), or joined from an invitation or link (`invitation`). */
  how: 'role' | 'invitation';
  /** Who gave the role, sent the invitation or created the link, if their account still exists. */
  byUserId: string | null;
}

/**
 * Queues an email to every other active staff Admin that someone became a
 * staff Admin: not the new Admin, and not whoever gave the role or sent the
 * invitation. One job each (`staffAdminAddedJob`), so a refusal for one
 * Admin never sends the others theirs twice; each is written in that Admin's
 * language when it's sent. Never throws: a failure is logged.
 *
 * @param ctx - Service context (only the database is used).
 * @param added - Who became a staff Admin, and how.
 * @param added.newAdminId - The new staff Admin.
 * @param added.how - Given the role, or joined from an invitation or link.
 * @param added.byUserId - Who made it happen, if known.
 * @returns How many emails were queued.
 */
export default async function notifyStaffAdminAdded(
  ctx: Pick<ServiceContext, 'db'>,
  { newAdminId, how, byUserId }: StaffAdminAdded,
): Promise<number> {
  try {
    const recipients = await ctx.db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.platformRole, PLATFORM_ADMIN_ROLE),
          isNull(user.deactivatedAt),
          ne(user.id, newAdminId),
          ...(byUserId ? [ne(user.id, byUserId)] : []),
        ),
      );
    await Promise.all(
      recipients.map(async (recipient) =>
        queueJob(ctx.db, staffAdminAddedJob, {
          recipientId: recipient.id,
          newAdminId,
          how,
          byUserId,
        }),
      ),
    );
    return recipients.length;
  } catch (error) {
    // eslint-disable-next-line no-console -- The change has committed; a lost notice should show up in the logs (database values are left out by the log redaction).
    console.error(`Telling the staff Admins about new staff Admin ${newAdminId} failed`, error);
    return 0;
  }
}
