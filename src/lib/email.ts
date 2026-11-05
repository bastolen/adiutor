/**
 * @file Sends transactional email (magic links, password resets,
 * invitations). The emails themselves are React Email templates in
 * `src/emails`.
 *
 * In order of precedence:
 * - `EMAIL_OUTBOX_DIR` set: emails are written there as JSON files (for
 *   automated tests).
 * - `SMTP_URL` set: emails are sent over SMTP, reusing up to
 *   {@link SMTP_MAX_CONNECTIONS} open connections (nodemailer's pool), so a
 *   bulk invitation doesn't connect and sign in once per email. Settings in
 *   the URL win (e.g. `?maxConnections=1`, or `?pool=false`).
 * - Otherwise, only when `NODE_ENV` is explicitly `development` or `test`:
 *   emails are printed to the server console, so links can be opened from
 *   there. Anywhere else (production, or a script run without `NODE_ENV`)
 *   sending fails, so links never end up in logs.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createTransport } from 'nodemailer';

import { env } from './env';

/**
 * An email to send.
 */
export interface Email {
  /** Recipient address. */
  to: string;
  /** Subject line. */
  subject: string;
  /** Plain-text body, for clients that don't show HTML. */
  text: string;
  /** HTML body. */
  html: string;
}

/** How many SMTP connections are kept open and reused at most, unless `SMTP_URL` says otherwise. */
export const SMTP_MAX_CONNECTIONS = 3;

/**
 * SMTP transport, pooled, or `null` when SMTP isn't configured. The pool
 * queues emails beyond its connections, which also caps how many go out at
 * once. Scripts end with `process.exit`, so an open connection never keeps
 * them running.
 */
const transport = env.SMTP_URL
  ? createTransport({ url: env.SMTP_URL, pool: true, maxConnections: SMTP_MAX_CONNECTIONS })
  : null;

/**
 * Sends an email.
 *
 * @param email - The email to send.
 * @param email.to - Recipient address.
 * @param email.subject - Subject line.
 * @param email.text - Plain-text body.
 * @param email.html - HTML body.
 * @throws {Error} Outside development and tests when neither an outbox nor SMTP is configured.
 */
export async function sendEmail({ to, subject, text, html }: Email): Promise<void> {
  if (env.EMAIL_OUTBOX_DIR) {
    await mkdir(env.EMAIL_OUTBOX_DIR, { recursive: true });
    const file = join(env.EMAIL_OUTBOX_DIR, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(
      file,
      JSON.stringify({ to, subject, text, html, sentAt: new Date().toISOString() }),
    );
    return;
  }

  if (transport) {
    await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
    return;
  }

  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error('SMTP_URL must be set to send email outside development.');
  }

  // eslint-disable-next-line no-console -- Development fallback: print the email so its link can be opened.
  console.info(`\n📧 Email to ${to}\nSubject: ${subject}\n\n${text}\n`);
}
