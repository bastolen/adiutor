/**
 * @file Sends transactional email (magic links, password resets,
 * invitations). The emails themselves are React Email templates in
 * `src/emails`.
 *
 * In order of precedence:
 * - `EMAIL_OUTBOX_DIR` set: emails are written there as JSON files (for
 *   automated tests).
 * - `SMTP_URL` set: emails are sent through the mail server the server's
 *   environment names, which the Email tab of Settings then only shows.
 *   Settings in the URL win (e.g. `?maxConnections=1`, or `?pool=false`).
 * - Otherwise the mail server saved on the Email tab of Settings
 *   (`email.smtp`, its password decrypted here), read on each send. Its
 *   transport is kept while the setting stays the same, so a save takes
 *   effect at once, also in the jobs. Only this case loads the settings and
 *   the database (`import()`), so `SMTP_URL` alone works as it always has.
 * - Otherwise, only when `NODE_ENV` is explicitly `development` or `test`:
 *   emails are printed to the server console, so links can be opened from
 *   there. Anywhere else (production, or a script run without `NODE_ENV`)
 *   sending fails, so links never end up in logs.
 *
 * Over SMTP, up to {@link SMTP_MAX_CONNECTIONS} connections are reused
 * (nodemailer's pool), so a bulk invitation doesn't connect and sign in once
 * per email, with a time limit on the whole send ({@link SEND_TIMEOUT_MS})
 * and on each of its steps ({@link SMTP_TIMEOUTS}), so a mail server that
 * hangs fails the email instead of holding a request or a job. The sender is
 * `EMAIL_FROM`, else the saved one, else `DEFAULT_EMAIL_FROM`.
 *
 * One email can also go through a given mail server rather than the one in
 * use ({@link sendThrough}): to try settings before they're saved, and to
 * tell the staff Admins of a change through the server it replaced.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createTransport, type Transporter } from 'nodemailer';

import { SEND_TIMEOUT_MS, SMTP_MAX_CONNECTIONS } from './email-limits';
import { env } from './env';
import { DEFAULT_EMAIL_FROM, senderText, type SmtpConfig } from './smtp';

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
 * A pooled transport's settings: emails beyond its connections wait in its
 * queue, which also caps how many go out at once. Scripts end with
 * `process.exit`, so an open connection never keeps them running.
 */
const POOLED = { pool: true, maxConnections: SMTP_MAX_CONNECTIONS } as const;

/** A mail server to send through: its transport, and the sender its emails have. */
interface MailServer {
  /** The nodemailer transport. */
  transport: Transporter;
  /** The sender, as one line (`Name <address>`). */
  from: string;
}

/**
 * The sender of emails through a mail server: `EMAIL_FROM` when the
 * environment names one, else the server's own, else Adiutor's default.
 *
 * @param config - The mail server saved in Settings, if that's the one used.
 * @returns The sender, as one line.
 */
function senderFor(config: SmtpConfig | null): string {
  return env.EMAIL_FROM ?? (config ? senderText(config.from) : DEFAULT_EMAIL_FROM);
}

/**
 * nodemailer's settings for a mail server saved in Settings: TLS from the
 * start, or STARTTLS that must succeed, or neither (STARTTLS is still used
 * when the server offers it), and a login only with a username.
 *
 * @param config - The mail server, its password decrypted.
 * @returns The transport's settings, without pooling.
 */
function transportSettings(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    ...(config.username ? { auth: { user: config.username, pass: config.password ?? '' } } : {}),
    ...SMTP_TIMEOUTS,
  };
}

/** The mail server `SMTP_URL` names, or `null` without one. */
const environmentServer: MailServer | null = env.SMTP_URL
  ? {
      transport: createTransport({ url: env.SMTP_URL, ...POOLED, ...SMTP_TIMEOUTS }),
      from: senderFor(null),
    }
  : null;

/** The transport for the saved mail server, while the setting stays the same. */
let kept: { fingerprint: string; server: MailServer } | null = null;

/**
 * The mail server saved in Settings, read now: the transport made for it
 * last time while the setting is unchanged (its encrypted text, which a save
 * always changes), else a new one, after closing the one it replaces. Sends
 * at the same moment after a save build it once: the check is made again
 * once the password is decrypted, so a send never closes the transport
 * another one has just made and is sending through.
 *
 * @returns The mail server, or `null` when none is saved.
 */
async function savedServer(): Promise<MailServer | null> {
  const [{ db }, { readSettings }, { openSecret }] = await Promise.all([
    import('@/db'),
    import('@/server/settings'),
    import('@/server/sealed-secrets'),
  ]);
  const { 'email.smtp': stored } = await readSettings(db, ['email.smtp']);
  if (!stored) {
    return null;
  }
  const fingerprint = JSON.stringify(stored);
  if (kept?.fingerprint === fingerprint) {
    return kept.server;
  }
  const config = {
    ...stored,
    password: stored.password ? await openSecret(stored.password) : null,
  };
  // Another send may have made it while the password was decrypted.
  if (kept?.fingerprint === fingerprint) {
    return kept.server;
  }
  const replaced = kept;
  kept = {
    fingerprint,
    server: {
      transport: createTransport({ ...transportSettings(config), ...POOLED }),
      from: senderFor(config),
    },
  };
  replaced?.server.transport.close();
  return kept.server;
}

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
 * Writes an email to the outbox folder (`EMAIL_OUTBOX_DIR`) as a JSON file.
 *
 * @param outbox - The folder.
 * @param email - The email.
 */
async function toOutbox(outbox: string, email: Email): Promise<void> {
  const { to, subject, text, html } = email;
  await mkdir(outbox, { recursive: true });
  const file = join(outbox, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(
    file,
    JSON.stringify({ to, subject, text, html, sentAt: new Date().toISOString() }),
  );
}

/**
 * Sends an email. Over SMTP, the whole send takes at most
 * {@link SEND_TIMEOUT_MS}.
 *
 * @throws {Error} When the mail server refuses the email or doesn't accept it
 *   in time; outside development and tests, when neither an outbox nor a mail
 *   server is set up.
 */
export async function sendEmail(email: Email): Promise<void> {
  if (env.EMAIL_OUTBOX_DIR) {
    await toOutbox(env.EMAIL_OUTBOX_DIR, email);
    return;
  }

  const server = environmentServer ?? (await savedServer());
  if (server) {
    const { to, subject, text, html } = email;
    await withinSendTimeout(
      server.transport.sendMail({ from: server.from, to, subject, text, html }),
    );
    return;
  }

  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error(
      'No mail server: set SMTP_URL, or set one up on the Email tab of Settings, to send email outside development.',
    );
  }

  // eslint-disable-next-line no-console -- Development fallback: print the email so its link can be opened.
  console.info(`\n📧 Email to ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
}

/**
 * Sends one email through a given mail server, not the one in use: to try
 * settings before they're saved, and to tell the staff Admins of a change
 * through the server it replaced. Its own connection, closed afterwards,
 * within the same time limits. With an outbox (`EMAIL_OUTBOX_DIR`, the e2e
 * tests) the email goes there, as every other does.
 *
 * @param config - The mail server, its password decrypted.
 * @param email - The email.
 * @throws {Error} When the mail server can't be reached, refuses the login or
 *   the email, or doesn't accept it in time (nodemailer's error, with its code).
 */
export async function sendThrough(config: SmtpConfig, email: Email): Promise<void> {
  if (env.EMAIL_OUTBOX_DIR) {
    await toOutbox(env.EMAIL_OUTBOX_DIR, email);
    return;
  }
  const transport = createTransport(transportSettings(config));
  try {
    const { to, subject, text, html } = email;
    await withinSendTimeout(
      transport.sendMail({ from: senderFor(config), to, subject, text, html }),
    );
  } finally {
    transport.close();
  }
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
