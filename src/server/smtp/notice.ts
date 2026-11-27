/**
 * @file Tells the staff Admins that the mail server changed (decision 0045):
 * whoever controls it can read every sign-in link and code Adiutor sends, so
 * a change made with a stolen session gets noticed. Every active staff Admin
 * is told, the one who made the change too, whose account it may not have
 * been, and who is then told even on an install with one staff Admin. The
 * email goes straight away through the mail server that was in use before
 * the change, which the new one can't hold back, one at a time, so a
 * provider's limit on connections doesn't turn any away. When there was
 * none, or it fails within its time limit, it's queued (`smtp-changed`) and
 * goes out through the new one. One email per staff Admin, read when it's
 * sent: names, addresses and the language aren't kept anywhere else.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { user } from '@/db/schema';
import { smtpChangedEmail } from '@/emails/smtp-changed';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';
import type { Email } from '@/lib/email';
import { type SmtpConfig, smtpFailureOf } from '@/lib/smtp';

import { loadEmailBrand } from '../branding';
import type { ServiceContext } from '../context';
import { queueJob, smtpChangedJob } from '../queue';
import recipientLocale from '../recipient-locale';

/** What one staff Admin's email is about: who changed it, and the new mail server. */
export interface MailServerChange {
  /** The staff Admin to tell. */
  recipientId: string;
  /** The staff Admin who changed it. */
  byUserId: string;
  /** The new mail server, as `host:port`. */
  server: string;
}

/**
 * A mail server's name in an email and the audit log: its host and port,
 * never a username or password.
 *
 * @param config - The mail server.
 * @param config.host - Its host.
 * @param config.port - Its port.
 * @returns E.g. `smtp.adiutor.dev:587`.
 */
export function serverName({ host, port }: Pick<SmtpConfig, 'host' | 'port'>): string {
  return `${host}:${port}`;
}

/**
 * One staff Admin's email about the change, read now: the recipient in their
 * own language, who made it by name, in the brand colours (decision 0049).
 *
 * @param ctx - Service context (the database and the app's address).
 * @param change - Who to tell, who changed it, and the new mail server.
 * @returns The email, or `null` when the recipient is no longer an active staff Admin.
 */
export async function smtpChangedEmailFor(
  ctx: Pick<ServiceContext, 'db' | 'baseUrl'>,
  change: MailServerChange,
): Promise<Email | null> {
  const { recipientId, byUserId, server } = change;
  const people = await ctx.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      role: user.platformRole,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .where(inArray(user.id, [recipientId, byUserId]));
  const recipient = people.find((person) => person.id === recipientId);
  const by = people.find((person) => person.id === byUserId);
  if (!recipient || recipient.role !== PLATFORM_ADMIN_ROLE || recipient.deactivatedAt !== null) {
    return null;
  }
  return smtpChangedEmail(recipient.email, {
    appUrl: ctx.baseUrl,
    locale: await recipientLocale(ctx, recipient.locale),
    server,
    byName: by ? displayName(by) : null,
    url: `${ctx.baseUrl}/admin/settings/integrations#mail-server`,
    brand: await loadEmailBrand(ctx.db),
  });
}

/**
 * Tells one staff Admin through the previous mail server.
 *
 * @param ctx - Service context (the database and the app's address).
 * @param previous - The mail server in use before, its password decrypted.
 * @param change - Who to tell, who changed it, and the new mail server.
 * @param send - Sends one email through a given mail server (`sendThrough`).
 * @returns Whether it's done (sent, or nothing to send to someone no longer
 *   a staff Admin); `false` when the previous mail server failed.
 */
async function tellThroughPrevious(
  ctx: Pick<ServiceContext, 'db' | 'baseUrl'>,
  previous: SmtpConfig,
  change: MailServerChange,
  send: (config: SmtpConfig, email: Email) => Promise<void>,
): Promise<boolean> {
  try {
    const email = await smtpChangedEmailFor(ctx, change);
    if (email) {
      await send(previous, email);
    }
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- The kind only: never the server's reply or an address.
    console.warn(
      'Telling the staff Admins about the new mail server through the previous one failed, so the rest are queued:',
      smtpFailureOf(error) ?? 'error',
    );
    return false;
  }
}

/**
 * Tells every active staff Admin that the mail server changed, the one who
 * changed it too, once the change has committed: straight away through the
 * previous mail server, one at a time. Once that fails, it isn't tried again
 * for the ones left (each would wait out its time limit), and they're queued
 * instead, as everyone is when there was no previous mail server. A failure
 * here never undoes the change; it's logged without personal data.
 *
 * @param ctx - Service context.
 * @param change - The change.
 * @param change.byUserId - The staff Admin who made it.
 * @param change.server - The new mail server, as `host:port`.
 * @param change.previous - The mail server in use before, its password decrypted, or `null`.
 * @param change.send - Sends one email through a given mail server (`sendThrough`).
 * @returns How many staff Admins are told.
 */
export async function tellStaffAdminsOfMailServerChange(
  ctx: Pick<ServiceContext, 'db' | 'baseUrl'>,
  {
    byUserId,
    server,
    previous,
    send,
  }: {
    byUserId: string;
    server: string;
    previous: SmtpConfig | null;
    send: (config: SmtpConfig, email: Email) => Promise<void>;
  },
): Promise<number> {
  try {
    const recipients = await ctx.db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.platformRole, PLATFORM_ADMIN_ROLE), isNull(user.deactivatedAt)))
      .orderBy(asc(user.id));
    let through = previous;
    for (const { id: recipientId } of recipients) {
      const change = { recipientId, byUserId, server };
      const told =
        through !== null &&
        // eslint-disable-next-line no-await-in-loop -- One at a time, so a provider's limit on connections refuses none.
        (await tellThroughPrevious(ctx, through, change, send));
      if (!told) {
        through = null;
        // eslint-disable-next-line no-await-in-loop -- In order with the ones told before.
        await queueJob(ctx.db, smtpChangedJob, change);
      }
    }
    return recipients.length;
  } catch (error) {
    // eslint-disable-next-line no-console -- The change has committed; a lost notice should show up in the logs (database values are left out by the log redaction).
    console.error('Telling the staff Admins about the new mail server failed', error);
    return 0;
  }
}
