/**
 * @file Integration tests for looking up a sign-in link without using it:
 * which links name an account, that the link still works afterwards, and the
 * limit on links that can't be used, per IP address.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user, verification } from '@/db/schema';
import { emailLinkVerificationIdentifier } from '@/lib/sign-in/tokens';

import { createUser, setupTestContext } from '../../../tests/integration/helpers';
import type { ServiceContext } from '../context';
import { RATE_LIMITS } from '../rate-limit';
import { getEmailLinkPreview } from './email-links';

const { db, ctx } = setupTestContext();

/**
 * The service context of a request from an IP address.
 *
 * @param ip - The client's address.
 * @returns The context.
 */
function from(ip: string): ServiceContext {
  /**
   * The request's client, as `requestInfoFromHeaders` would give it.
   *
   * @returns The IP address, without a browser.
   */
  const requestInfo = async () => ({ ip, userAgent: null });
  return { ...ctx, requestInfo };
}

/**
 * Stores a sign-in link the way Better Auth's magic-link plugin does.
 *
 * @param token - The link's token.
 * @param email - The address it was requested for, as typed.
 * @param options - Overrides.
 * @param options.expiresInSeconds - When it expires (negative for the past).
 * @param options.value - The stored value, instead of a sign-in link's.
 */
async function storeLink(
  token: string,
  email: string,
  options: { expiresInSeconds?: number; value?: string } = {},
): Promise<void> {
  await db.insert(verification).values({
    identifier: emailLinkVerificationIdentifier(token),
    value: options.value ?? JSON.stringify({ type: 'magic-link', email }),
    expiresAt: sql`now() + make_interval(secs => ${options.expiresInSeconds ?? 300})`,
  });
}

describe('getEmailLinkPreview', () => {
  it('names the account a link signs in to, with its address', async () => {
    const userId = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ name: 'Jane Tester' }).where(eq(user.id, userId));
    // Better Auth keeps the address as it was typed into the form.
    await storeLink('valid-token', 'Jane@Adiutor.test');

    expect(await getEmailLinkPreview(from('203.0.113.1'), 'valid-token')).toEqual({
      userId,
      name: 'Jane Tester',
      email: 'jane@adiutor.test',
    });
  });

  it("doesn't use the link", async () => {
    await createUser(db, 'jane@adiutor.test');
    await storeLink('valid-token', 'jane@adiutor.test');

    await getEmailLinkPreview(from('203.0.113.1'), 'valid-token');

    expect(await getEmailLinkPreview(from('203.0.113.1'), 'valid-token')).not.toBeNull();
    expect(await db.select().from(verification)).toHaveLength(1);
  });

  it("gives nothing for a link that can't be used, whatever the reason", async () => {
    const deactivatedId = await createUser(db, 'gone@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, deactivatedId));
    await createUser(db, 'jane@adiutor.test');
    await storeLink('expired', 'jane@adiutor.test', { expiresInSeconds: -1 });
    await storeLink('deactivated', 'gone@adiutor.test');
    await storeLink('no-account', 'nobody@adiutor.test');
    await storeLink('other-kind', 'jane@adiutor.test', {
      value: JSON.stringify({ type: 'reset-password', email: 'jane@adiutor.test' }),
    });
    await storeLink('not-json', 'jane@adiutor.test', { value: 'jane@adiutor.test' });

    const ctxFrom = from('203.0.113.1');
    await Promise.all(
      ['expired', 'deactivated', 'no-account', 'other-kind', 'not-json', 'never-sent', ''].map(
        async (token) => expect(await getEmailLinkPreview(ctxFrom, token)).toBeNull(),
      ),
    );
  });

  it("refuses lookups from an address after too many links that couldn't be used", async () => {
    await createUser(db, 'jane@adiutor.test');
    await storeLink('valid-token', 'jane@adiutor.test');
    const { limit } = RATE_LIMITS.emailLinkMissesPerIp;
    const attacker = from('203.0.113.66');

    for (let attempt = 0; attempt < limit; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- One at a time, so the count is exact.
      expect(await getEmailLinkPreview(attacker, `guess-${attempt}`)).toBeNull();
    }

    await expect(getEmailLinkPreview(attacker, 'valid-token')).rejects.toMatchObject({
      code: 'rate_limited',
    });
    // Another address isn't affected.
    expect(await getEmailLinkPreview(from('203.0.113.1'), 'valid-token')).not.toBeNull();
  });

  it('counts only links that could not be used', async () => {
    await createUser(db, 'jane@adiutor.test');
    await storeLink('valid-token', 'jane@adiutor.test');
    const { limit } = RATE_LIMITS.emailLinkMissesPerIp;
    const office = from('203.0.113.7');

    for (let attempt = 0; attempt < limit + 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- One at a time, so the count is exact.
      expect(await getEmailLinkPreview(office, 'valid-token')).not.toBeNull();
    }
    for (let attempt = 0; attempt < limit - 1; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- Same.
      await getEmailLinkPreview(office, `guess-${attempt}`);
    }

    expect(await getEmailLinkPreview(office, 'valid-token')).not.toBeNull();
  });
});
