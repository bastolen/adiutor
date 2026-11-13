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
 *   bulk invitation doesn't connect and sign in once per email, with time
 *   limits ({@link SMTP_TIMEOUTS}) so a mail server that hangs fails the
 *   email instead of holding a request or a job. Settings in the URL win
 *   (e.g. `?maxConnections=1`, or `?pool=false`).
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
const SMTP_MAX_CONNECTIONS = 3;

/**
 * How long to wait for the mail server, in milliseconds, instead of
 * nodemailer's 2 minutes, 30 seconds and 10 minutes: well within a request,
 * and within the background jobs' tick (45 seconds), so a server that hangs
 * fails one email (which a queued job then tries again) instead of holding
 * the request or the tick until the platform stops it.
 */
export const SMTP_TIMEOUTS = {
  /** To connect. */
  connectionTimeout: 10_000,
  /** For the server's greeting once connected. */
  greetingTimeout: 10_000,
  /** Of silence while sending. */
  socketTimeout: 20_000,
} as const;

/**
 * SMTP transport, pooled, or `null` when SMTP isn't configured. The pool
 * queues emails beyond its connections, which also caps how many go out at
 * once. Scripts end with `process.exit`, so an open connection never keeps
 * them running.
 */
const transport = env.SMTP_URL
  ? createTransport({
      url: env.SMTP_URL,
      pool: true,
      maxConnections: SMTP_MAX_CONNECTIONS,
      ...SMTP_TIMEOUTS,
    })
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

/**
 * Picks nodemailer's error code and the SMTP reply code from a failed send,
 * for log lines that must not hold personal data (a mail server's refusal can
 * quote the address).
 *
 * @param error - What the send threw.
 * @returns The codes, where there are any.
 */
export function sendFailureOf(error: unknown): { code: unknown; responseCode: unknown } {
  const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  return { code: code ?? null, responseCode: responseCode ?? null };
}
