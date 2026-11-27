/**
 * @file Tells the operator when a production server can't send email.
 * `src/instrumentation.ts` runs {@link warnIfEmailCantBeSent} once when a
 * production server starts, in the background. Without a mail server
 * (`SMTP_URL`, or one saved on the Connections tab of Settings) the server still
 * serves pages, and every email (sign-in links, password resets,
 * invitations, security notices) fails only when it's sent (`sendEmail` in
 * `src/lib/email.ts`), so the log says so from the start.
 *
 * It's a warning rather than a refusal to start: builds and preview
 * deployments run in production without a mail server. It doesn't import
 * `src/lib/email.ts`, so starting the server doesn't load nodemailer, and it
 * reads the settings only when the environment doesn't decide.
 */
import { db } from '@/db';
import { env } from '@/lib/env';

import { readSettings } from './settings';

/** The settings that decide whether a server can send email. */
export interface EmailDeliverySettings {
  /** Which build is running (`NODE_ENV`). */
  NODE_ENV?: string;
  /** The mail server (`SMTP_URL`), if any. */
  SMTP_URL?: string;
  /** The folder the end-to-end tests read their emails from (`EMAIL_OUTBOX_DIR`), if any. */
  EMAIL_OUTBOX_DIR?: string;
}

/**
 * Whether the environment alone decides that email can be sent: outside
 * production (which prints emails), or with a mail server or the end-to-end
 * tests' outbox.
 *
 * @param settings - The server's settings.
 * @returns Whether email can be sent without a mail server saved in Settings.
 */
function sendsWithoutSettings(settings: EmailDeliverySettings): boolean {
  return (
    settings.NODE_ENV !== 'production' || Boolean(settings.SMTP_URL || settings.EMAIL_OUTBOX_DIR)
  );
}

/**
 * The warning for a production server that has no way to send email: neither
 * a mail server (in the environment or saved in Settings) nor the end-to-end
 * tests' outbox. Development and tests print their emails instead, so they
 * never get it. It names the settings, never a value from the configuration.
 *
 * @param settings - The server's settings.
 * @param savedServer - Whether a mail server is saved on the Connections tab of Settings.
 * @returns The warning, or `null` when email can be sent.
 */
export function emailDeliveryWarning(
  settings: EmailDeliverySettings,
  savedServer = false,
): string | null {
  if (sendsWithoutSettings(settings) || savedServer) {
    return null;
  }
  return "No mail server is set up (SMTP_URL, or the Connections tab of Settings), so Adiutor can't send email: sign-in links, password resets, invitations and security notices fail until one is. See docs/deploying.md.";
}

/**
 * Logs {@link emailDeliveryWarning} for this server's settings, when there
 * is one. It reads the saved mail server only when the environment doesn't
 * decide.
 */
export async function warnIfEmailCantBeSent(): Promise<void> {
  if (sendsWithoutSettings(env)) {
    return;
  }
  const { 'email.smtp': saved } = await readSettings(db, ['email.smtp']);
  const warning = emailDeliveryWarning(env, saved !== null);
  if (warning) {
    // eslint-disable-next-line no-console -- Tells the operator at startup; names the settings only.
    console.warn(warning);
  }
}
