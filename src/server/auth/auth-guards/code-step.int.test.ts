/**
 * @file Integration tests for the code step of a password sign-in: which codes
 * hand their user to the reactions after the request.
 */
import { describe, expect, it, vi } from 'vitest';

import { rateLimitBucket } from '@/db/schema';

import {
  enableTwoFactor,
  inSequence,
  staffActor,
  rateLimitHits,
} from '../../../../tests/integration/helpers';
import { requestState } from '../request-state';
import { beforeAuthRequest } from './before-request';
import {
  db,
  request,
  refusedWith,
  sendCodesOverTime,
  waitForNextCode,
  signedIn,
  repeat,
} from './test-helpers';

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  // Better Auth's request state isn't there outside a request; the tests watch what's added.
  addOAuthServerContext: vi.fn(),
}));

/**
 * The user a request's checks handed to the reactions after it, which record
 * a wrong code at the code step for them.
 *
 * @param ctx - The request.
 * @param ctx.context - Better Auth's request state, which the reactions share.
 * @returns The user's ID, if one was handed over.
 */
const pendingCodeSignIn = (ctx: { context: object }) => requestState(ctx.context).pendingCodeSignIn;

describe('a password sign-in waiting for its code step', () => {
  it('refuses email codes once an authenticator app is set up', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const pending = { pendingUserId: support.id };

    await expect(beforeAuthRequest(request('/two-factor/send-otp', pending))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
    await expect(beforeAuthRequest(request('/two-factor/verify-otp', pending))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
    // Authenticator codes at sign-in are limited by Better Auth itself.
    await expect(
      beforeAuthRequest(request('/two-factor/verify-totp', pending)),
    ).resolves.toBeUndefined();
    expect(await rateLimitHits(db, `email-code:user:${support.id}`)).toBeNull();
  });

  it('lets Managers finish signing in with email codes, within the limit', async () => {
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id, 'email');
    const sendCode = request('/two-factor/send-otp', { pendingUserId: manager.id });

    await sendCodesOverTime(5, sendCode);
    await waitForNextCode();
    await expect(beforeAuthRequest(sendCode)).rejects.toEqual(refusedWith('TOO_MANY_ATTEMPTS'));
    expect(await rateLimitHits(db, `email-code:user:${manager.id}`)).toBe(6);
  });

  it('hands the user of each code it lets through to the reactions after the request', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id, 'email');
    const handedOver = [
      request('/two-factor/verify-totp', { pendingUserId: support.id }),
      request('/two-factor/verify-backup-code', { pendingUserId: support.id }),
      request('/two-factor/verify-otp', { pendingUserId: manager.id }),
    ];
    // Emailing a code checks none; without a pending sign-in Better Auth refuses the code itself.
    const notHandedOver = [
      request('/two-factor/send-otp', { pendingUserId: manager.id }),
      request('/two-factor/verify-totp'),
    ];

    await inSequence([...handedOver, ...notHandedOver], (ctx) => beforeAuthRequest(ctx));
    // A refused one isn't checked by Better Auth either.
    const refused = request('/two-factor/verify-otp', { pendingUserId: support.id });
    await expect(beforeAuthRequest(refused)).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );

    expect(handedOver.map((ctx) => pendingCodeSignIn(ctx))).toEqual([
      support.id,
      support.id,
      manager.id,
    ]);
    expect([...notHandedOver, refused].map((ctx) => pendingCodeSignIn(ctx))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("doesn't hand over a code checked with a session: that's a step-up", async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await signedIn(support.id);
    // The browser still has the two-factor cookie of an earlier password sign-in.
    const ctx = request('/two-factor/verify-totp', { pendingUserId: support.id });

    await beforeAuthRequest(ctx);

    expect(pendingCodeSignIn(ctx)).toBeUndefined();
    expect(await rateLimitHits(db, `step-up-failed:user:${support.id}`)).toBe(1);
  });

  it('leaves requests without a session or pending sign-in to Better Auth', async () => {
    await repeat(6, request('/two-factor/send-otp'));
    await expect(
      beforeAuthRequest(request('/passkey/generate-register-options')),
    ).resolves.toBeUndefined();
    expect(await db.select().from(rateLimitBucket)).toEqual([]);
  });
});
