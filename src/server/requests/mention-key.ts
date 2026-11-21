/**
 * @file The key that stands for a person where the browser has to name
 * someone whose user ID it may not get: in a text that's being written (a
 * mention), on a mention shown to someone who may write in the request (so
 * a copy of it stays one), and in the dialog that changes who is
 * subscribed to a request.
 * Someone at a company never gets a user ID; a key says nothing about who
 * the person is, and is only valid in the company it was made for.
 */
import { createHmac } from 'node:crypto';

import { env } from '@/lib/env';
import { MENTION_KEY_LENGTH } from '@/lib/requests';

/**
 * The secret the keys are made with: its own, worked out from the app's
 * secret once, so a key is never a signature of anything else.
 */
let keySecret: Buffer | undefined;

/**
 * The key that stands for a person in a company. It's the same every time,
 * so a text that was kept in the browser still names them, and it can't be
 * turned back into who they are or used in another company. Nothing is
 * stored for it: the server makes the keys of the people who may be named
 * again and compares.
 *
 * @param companyId - The company the text is written in, or the request is in.
 * @param userId - The person.
 * @returns Their key there.
 */
export default function mentionKey(companyId: string, userId: string): string {
  keySecret ??= createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update('adiutor mention keys')
    .digest();
  return createHmac('sha256', keySecret)
    .update(`${companyId}:${userId}`)
    .digest('base64url')
    .slice(0, MENTION_KEY_LENGTH);
}
