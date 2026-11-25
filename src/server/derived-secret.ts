/**
 * @file Secrets of their own for what the server signs or fingerprints
 * itself (a mention's key, a picture's version), worked out from the current
 * auth secret (the first of `BETTER_AUTH_SECRETS` when it's set, else
 * `BETTER_AUTH_SECRET`), one for each purpose. What's made with one is never
 * a signature of anything else, and nobody without that secret can make it,
 * or check a guess at what it was made from. A rotation changes them, so a
 * secret that leaked is no use against them once it's replaced.
 */
import { createHmac } from 'node:crypto';

import { env } from '@/lib/env';
import { currentSecret, parseAuthSecrets } from '@/lib/sign-in/auth-secrets';

/** The secrets worked out so far, by purpose: each once. */
const secrets = new Map<string, Buffer>();

/**
 * The secret for one purpose: an HMAC-SHA-256 of the purpose's name with
 * the current auth secret (`currentSecret`), the same every time for the
 * same current secret.
 *
 * @param purpose - What it's for, a name no other purpose uses, e.g. `adiutor mention keys`.
 * @returns The secret, to key an HMAC with.
 */
export default function derivedSecret(purpose: string): Buffer {
  const known = secrets.get(purpose);
  if (known) {
    return known;
  }
  const key = currentSecret(env.BETTER_AUTH_SECRET, parseAuthSecrets(env.BETTER_AUTH_SECRETS));
  const secret = createHmac('sha256', key).update(purpose).digest();
  secrets.set(purpose, secret);
  return secret;
}
