/**
 * @file What a failed email send says about itself without the email, for
 * log lines that must not hold personal data (a mail server's refusal can
 * quote the address).
 */

/**
 * Picks nodemailer's error code and the SMTP reply code from a failed send.
 *
 * @param error - What the send threw.
 * @returns The codes, where there are any.
 */
export default function sendFailureOf(error: unknown): { code: unknown; responseCode: unknown } {
  const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  return { code: code ?? null, responseCode: responseCode ?? null };
}
