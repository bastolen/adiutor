/**
 * @file Authenticator-app (TOTP) helpers both test runners share: the code an
 * app shows for a secret, and the rows Better Auth stores once a user has set
 * one up.
 */
import { createHmac } from 'node:crypto';

import { symmetricEncrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../../src/db/schema';
import { firstRow } from '../../src/lib/defined';

/**
 * The code an authenticator app shows (RFC 6238: HMAC-SHA1, 6 digits,
 * 30 seconds), as Better Auth checks it.
 *
 * @param secret - The secret's bytes, or its raw text as Better Auth stores it.
 * @param stepOffset - Which 30 seconds, from now; the current ones by default.
 * @returns The 6-digit code.
 */
export function authenticatorCode(secret: Buffer | string, stepOffset = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  // Dynamic truncation: the low 4 bits pick an offset, the top bit of the 31-bit value is dropped.
  const offset = hmac.readUInt8(hmac.length - 1) % 16;
  const value = hmac.readUInt32BE(offset) % 2 ** 31;
  return (value % 1_000_000).toString().padStart(6, '0');
}

/**
 * Sets up an authenticator app for a user, as Better Auth stores it once its
 * first code was right: two-factor turned on, the secret, and no backup codes
 * left, both encrypted with the auth secret.
 *
 * @param db - A Drizzle client on the test database.
 * @param userId - The user.
 * @param rawSecret - The raw authenticator secret.
 * @param key - The auth secret the values are encrypted with.
 */
export async function storeAuthenticator(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  rawSecret: string,
  key: Parameters<typeof symmetricEncrypt>[0]['key'],
): Promise<void> {
  firstRow(
    await db
      .update(schema.user)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.user.id, userId))
      .returning({ id: schema.user.id }),
    'the user',
  );
  await db.insert(schema.twoFactor).values({
    userId,
    secret: await symmetricEncrypt({ key, data: rawSecret }),
    backupCodes: await symmetricEncrypt({ key, data: JSON.stringify([]) }),
    verified: true,
  });
}
