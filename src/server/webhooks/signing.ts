/**
 * @file Signs what Adiutor sends to a webhook, as the Standard Webhooks
 * specification describes (https://www.standardwebhooks.com), so a receiver
 * can check it with an existing library: three headers, `webhook-id` (the
 * delivery, the same on every attempt), `webhook-timestamp` (when this
 * attempt was sent, in seconds, so an old message can be refused as a
 * replay) and `webhook-signature` (`v1,` and a base64 HMAC-SHA-256 of
 * `<id>.<timestamp>.<body>`, keyed with the secret's bytes). Each webhook
 * has its own secret, made here and shown once.
 */
import { createHmac, randomBytes } from 'node:crypto';

/** What a webhook's secret starts with, as the specification writes secrets. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/** How many random bytes a new secret holds. */
const SECRET_BYTES = 32;

/**
 * Makes a new secret for a webhook: `whsec_` and 32 random bytes in base64.
 *
 * @returns The secret, to seal and show once.
 */
export function newWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64')}`;
}

/** What one attempt sends, as far as the signature covers it. */
export interface SignedMessage {
  /** The delivery's ID, the same on every attempt. */
  id: string;
  /** When this attempt is sent, in whole seconds since 1970 (UTC). */
  timestamp: number;
  /** The body, exactly as sent. */
  body: string;
}

/**
 * The signature of a message: `v1,` and the base64 HMAC-SHA-256 of
 * `<id>.<timestamp>.<body>`, keyed with the secret's bytes (the base64 after
 * `whsec_`).
 *
 * @param secret - The webhook's secret.
 * @param message - What's sent.
 * @returns The value of the `webhook-signature` header.
 */
export function signWebhook(secret: string, message: SignedMessage): string {
  const key = Buffer.from(
    secret.startsWith(WEBHOOK_SECRET_PREFIX) ? secret.slice(WEBHOOK_SECRET_PREFIX.length) : secret,
    'base64',
  );
  const mac = createHmac('sha256', key)
    .update(`${message.id}.${message.timestamp}.${message.body}`)
    .digest('base64');
  return `v1,${mac}`;
}

/**
 * The headers that identify and sign one attempt.
 *
 * @param secret - The webhook's secret.
 * @param message - What's sent.
 * @returns The `webhook-id`, `webhook-timestamp` and `webhook-signature` headers.
 */
export function signedHeaders(secret: string, message: SignedMessage): Record<string, string> {
  return {
    'webhook-id': message.id,
    'webhook-timestamp': String(message.timestamp),
    'webhook-signature': signWebhook(secret, message),
  };
}
