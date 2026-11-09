/**
 * @file Tells the other staff Admins when someone becomes a staff Admin
 * (given the role, or by accepting an invitation or using an invite link),
 * so an account a stolen session leaves behind gets noticed. Sent once the
 * change has committed; a failure is logged and never undoes it.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import { user } from '@/db/schema';
import { staffAdminAddedEmail } from '@/emails/staff-admin-added';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';

import type { ServiceContext } from '../context';
import recipientLocale from '../recipient-locale';
import sendFailureOf from '../send-failure';

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
 * Emails every other active staff Admin that someone became a staff Admin:
 * not the new Admin, and not whoever gave the role or sent the invitation.
 * Each in their own language (`recipientLocale`). Never throws: a failure is
 * logged (without addresses).
 *
 * @param ctx - Service context (database, email, app URL, the request's language).
 * @param added - Who became a staff Admin, and how.
 * @param added.newAdminId - The new staff Admin.
 * @param added.how - Given the role, or joined from an invitation or link.
 * @param added.byUserId - Who made it happen, if known.
 * @returns How many Admins were emailed.
 */
export default async function notifyStaffAdminAdded(
  ctx: Pick<ServiceContext, 'db' | 'sendEmail' | 'baseUrl' | 'requestLocale'>,
  { newAdminId, how, byUserId }: StaffAdminAdded,
): Promise<number> {
  try {
    const named = byUserId ? [newAdminId, byUserId] : [newAdminId];
    const people = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.platformRole,
        locale: user.locale,
      })
      .from(user)
      .where(
        or(
          inArray(user.id, named),
          and(eq(user.platformRole, PLATFORM_ADMIN_ROLE), isNull(user.deactivatedAt)),
        ),
      );
    const newAdmin = people.find((person) => person.id === newAdminId);
    if (!newAdmin) {
      return 0;
    }
    const by = byUserId ? people.find((person) => person.id === byUserId) : undefined;
    const recipients = people.filter(
      (person) =>
        person.role === PLATFORM_ADMIN_ROLE && person.id !== newAdminId && person.id !== byUserId,
    );

    const sent = await Promise.all(
      recipients.map(async (recipient) => {
        try {
          await ctx.sendEmail(
            await staffAdminAddedEmail(recipient.email, {
              appUrl: ctx.baseUrl,
              locale: await recipientLocale(ctx, recipient.locale),
              newAdminName: displayName(newAdmin),
              newAdminEmail: newAdmin.email,
              how,
              byName: by ? displayName(by) : null,
              url: `${ctx.baseUrl}/admin/staff`,
            }),
          );
          return true;
        } catch (error) {
          // eslint-disable-next-line no-console -- A failed email must not undo the change, but should show up in the logs.
          console.error(
            `Telling staff Admin ${recipient.id} about new staff Admin ${newAdminId} failed`,
            sendFailureOf(error),
          );
          return false;
        }
      }),
    );
    return sent.filter(Boolean).length;
  } catch (error) {
    // eslint-disable-next-line no-console -- As above; database values are left out by the log redaction.
    console.error(`Telling the staff Admins about new staff Admin ${newAdminId} failed`, error);
    return 0;
  }
}
