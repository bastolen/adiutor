/**
 * @file The rules about webhooks that the server and the browser share: what
 * makes a webhook's address acceptable, and the kinds of failure a delivery
 * can end in. Pure and free of zod, so client components and the database
 * schema import it too. Where a webhook may send is also checked on the
 * server, on every connection (`src/server/webhooks/address-guard.ts`): an
 * address that passes here can still be refused there.
 */
import { WEBHOOK_URL_MAX_LENGTH } from './input-rules';
import { isSecureOrLocalUrl } from './local-host';

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
