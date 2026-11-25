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
 *   bulk invitation doesn't connect and sign in once per email, with a time
 *   limit on the whole send ({@link SEND_TIMEOUT_MS}) and on each of its
 *   steps ({@link SMTP_TIMEOUTS}), so a mail server that hangs fails the
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

import { SEND_TIMEOUT_MS, SMTP_MAX_CONNECTIONS } from './email-limits';
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

/**
 * How long to wait for the mail server at each step, in milliseconds, instead
 * of nodemailer's 2 minutes, 30 seconds and 10 minutes. Together they'd let
 * one send take up to 40 seconds, so they aren't the limit on a send
 * ({@link SEND_TIMEOUT_MS} is): they close the connection of a send that was
 * given up, which hands it back to the pool.
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
 * Waits for a send over SMTP, for at most {@link SEND_TIMEOUT_MS}. The
 * transport's own attempt isn't cut off: the mail server may still accept
 * the email afterwards, so a job that tries again can send it twice, which
 * jobs accept (they run at least once).
 *
 * @param sending - The transport's send.
 * @throws {Error} What the transport threw, or, when the time ran out first,
 *   an error with nodemailer's code for a timeout (`ETIMEDOUT`), so callers
 *   log and handle it like any other failed send ({@link sendFailureOf}).
 */
async function withinSendTimeout(sending: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Sending the email timed out'), { code: 'ETIMEDOUT' }));
    }, SEND_TIMEOUT_MS);
  });
  try {
    // The race also handles a send that fails after the time ran out: it's never left unhandled.
    await Promise.race([sending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends an email. Over SMTP, the whole send takes at most
 * {@link SEND_TIMEOUT_MS}.
 *
 * @throws {Error} When the mail server refuses the email or doesn't accept it
 *   in time; outside development and tests, when neither an outbox nor SMTP
 *   is configured.
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
    await withinSendTimeout(transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html }));
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
