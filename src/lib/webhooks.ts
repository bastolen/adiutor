/**
 * @file The rules about webhooks that the server and the browser share: the
 * events and formats a webhook can choose, why it can be off, what makes its
 * address acceptable, and how a delivery can end. Pure and free of zod, so
 * client components and the database schema import it too. Where a webhook may send is also checked on the
 * server, on every connection (`src/server/webhooks/address-guard.ts`): an
 * address that passes here can still be refused there.
 */
import { WEBHOOK_URL_MAX_LENGTH } from './input-rules';
import { isSecureOrLocalUrl } from './local-host';

/**
 * What a webhook can be told about a request, each a choice of its own: the
 * request was raised (`raised`), someone replied (`reply`, a solution
 * included), wrote an internal note (`note`), changed its status
 * (`status`), assigned or removed a staff member (`assignee`), or changed
 * its title, type or priority (`details`).
 */
export const WEBHOOK_EVENTS = ['raised', 'reply', 'note', 'status', 'assignee', 'details'] as const;

/** One kind of news a webhook can be told. */
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * How a webhook is sent: signed JSON with every detail (`json`, the Standard
 * Webhooks way), or a short message a chat app's incoming webhook shows as
 * it is (`chat`).
 */
export const WEBHOOK_FORMATS = ['json', 'chat'] as const;

/** One format a webhook is sent in. */
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

/**
 * Why a webhook is off: a staff Admin turned it off (`manual`), its
 * deliveries failed for days (`failing`), its receiver said it's gone for
 * good with `410 Gone` (`gone`), or its address or secret can't be decrypted
 * any more (`unreadable`).
 */
export const WEBHOOK_OFF_REASONS = ['manual', 'failing', 'gone', 'unreadable'] as const;

/** One reason a webhook is off. */
export type WebhookOffReason = (typeof WEBHOOK_OFF_REASONS)[number];

/**
 * Where a delivery stands: still to be sent or tried again (`pending`),
 * taken by the receiver (`delivered`), given up (`failed`), or dropped
 * because its webhook was turned off or no longer wants it (`cancelled`).
 */
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'cancelled'] as const;

/** Where one delivery stands. */
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * What can be wrong with a webhook's address:
 * - `too_long`: longer than {@link WEBHOOK_URL_MAX_LENGTH};
 * - `invalid`: not a web address;
 * - `scheme`: neither `https://` nor `http://`;
 * - `credentials`: a user name or password in it (the signature is how a
 *   receiver knows it's Adiutor);
 * - `insecure`: plain `http://` to another computer, in production.
 */
export type WebhookUrlProblem = 'too_long' | 'invalid' | 'scheme' | 'credentials' | 'insecure';

/**
 * What's wrong with a webhook's address, if anything. In production it must
 * be `https://`, or `http://` on this computer, as for the app's own address
 * (`isSecureOrLocalUrl`); outside production plain `http://` is fine, for a
 * receiver in development.
 *
 * @param value - The address as typed.
 * @param options - Where it's checked.
 * @param options.production - Whether Adiutor runs in production.
 * @returns The problem, or `null` when the address is acceptable.
 */
export function webhookUrlProblem(
  value: string,
  options: { production: boolean },
): WebhookUrlProblem | null {
  if (value.length > WEBHOOK_URL_MAX_LENGTH) {
    return 'too_long';
  }
  if (!URL.canParse(value)) {
    return 'invalid';
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'scheme';
  }
  if (url.hostname === '') {
    return 'invalid';
  }
  if (url.username !== '' || url.password !== '') {
    return 'credentials';
  }
  if (options.production && !isSecureOrLocalUrl(url)) {
    return 'insecure';
  }
  return null;
}

/**
 * How an attempt to deliver to a webhook can fail, never with the receiver's
 * own answer:
 * - `timeout`: no answer in time;
 * - `dns`: its host name couldn't be found;
 * - `refused_address`: it points inside Adiutor's own network;
 * - `connection`: the connection was refused or broke off;
 * - `tls`: its certificate or encryption couldn't be trusted;
 * - `redirect`: it answered with a redirect, which is never followed;
 * - `http`: it answered with another status than 2xx (the status is kept);
 * - `unreadable`: its address or secret can't be decrypted any more.
 */
export const WEBHOOK_ERROR_KINDS = [
  'timeout',
  'dns',
  'refused_address',
  'connection',
  'tls',
  'redirect',
  'http',
  'unreadable',
] as const;

/** One way an attempt to deliver to a webhook can fail. */
export type WebhookErrorKind = (typeof WEBHOOK_ERROR_KINDS)[number];
