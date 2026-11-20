/**
 * @file Tells the operator when a production server can't send email.
 * `src/instrumentation.ts` runs {@link warnIfEmailCantBeSent} once when a
 * production server starts, in the background. Without `SMTP_URL` the server
 * still serves pages, and every email (sign-in links, password resets,
 * invitations, security notices) fails only when it's sent
 * (`sendEmail` in `src/lib/email.ts`), so the log says so from the start.
 *
 * It's a warning rather than a refusal to start: builds and preview
 * deployments run in production without a mail server. It doesn't import
 * `src/lib/email.ts`, so starting the server doesn't load nodemailer.
 */
import { env } from '@/lib/env';

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
 * The warning for a production server that has no way to send email: neither
 * a mail server nor the end-to-end tests' outbox. Development and tests print
 * their emails instead, so they never get it. It names the setting, never a
 * value from the configuration.
 *
 * @param settings - The server's settings.
 * @returns The warning, or `null` when email can be sent.
 */
export function emailDeliveryWarning(settings: EmailDeliverySettings): string | null {
  if (settings.NODE_ENV !== 'production' || settings.SMTP_URL || settings.EMAIL_OUTBOX_DIR) {
    return null;
  }
  return "SMTP_URL isn't set, so Adiutor can't send email: sign-in links, password resets, invitations and security notices fail until it is. See docs/deploying.md.";
}

/**
 * Logs {@link emailDeliveryWarning} for this server's settings, when there
 * is one.
 */
export function warnIfEmailCantBeSent(): void {
  const warning = emailDeliveryWarning(env);
  if (warning) {
    // eslint-disable-next-line no-console -- Tells the operator at startup; names the setting only.
    console.warn(warning);
  }
}
