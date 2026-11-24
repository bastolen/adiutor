/**
 * @file Secrets of their own for what the server signs or fingerprints
 * itself (a mention's key, a picture's version), worked out from the app's
 * secret (`BETTER_AUTH_SECRET`), one for each purpose. What's made with one
 * is never a signature of anything else, and nobody without the app's secret
 * can make it, or check a guess at what it was made from.
 */
import { createHmac } from 'node:crypto';

import { env } from '@/lib/env';

/** The secrets worked out so far, by purpose: each once. */
const secrets = new Map<string, Buffer>();

/**
 * The secret for one purpose: an HMAC-SHA-256 of the purpose's name with
 * the app's secret, the same every time for the same app secret.
 *
 * @param purpose - What it's for, a name no other purpose uses, e.g. `adiutor mention keys`.
 * @returns The secret, to key an HMAC with.
 */
export default function derivedSecret(purpose: string): Buffer {
  const known = secrets.get(purpose);
  if (known) {
    return known;
  }
  const secret = createHmac('sha256', env.BETTER_AUTH_SECRET).update(purpose).digest();
  secrets.set(purpose, secret);
  return secret;
}
