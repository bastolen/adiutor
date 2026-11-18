/**
 * @file Tests for the rate limit message and the key of a limit per IP
 * address (the limits themselves are covered by the integration tests).
 */
import { describe, expect, it } from 'vitest';

import { serviceErrorMessage } from './errors';
import { ipRateLimitKey, tooManyAttemptsError, waitMinutes } from './rate-limit';

describe('ipRateLimitKey', () => {
  /**
   * A service context of a request from an IP address.
   *
   * @param ip - The client's address, or `null` when it isn't known.
   * @returns The part of the context the key is built from.
   */
  const from = (ip: string | null) => ({
    /**
     * The request's client, as `requestInfoFromHeaders` would give it.
     *
     * @returns The IP address, without a browser.
     */
    requestInfo: async () => ({ ip, userAgent: null }),
  });

  it.each([
    ['app-error', '203.0.113.7', 'app-error:ip:203.0.113.7'],
    ['invite-link-claim', '2001:db8::7', 'invite-link-claim:ip:2001:db8::7'],
  ])('names the purpose %s and the address %s', async (purpose, ip, key) => {
    await expect(ipRateLimitKey(from(ip), purpose)).resolves.toBe(key);
  });

  it('counts requests whose address is unknown together', async () => {
    await expect(ipRateLimitKey(from(null), 'sign-in-error')).resolves.toBe(
      'sign-in-error:ip:unknown',
    );
  });

  it('counts what happens outside a request with the unknown addresses', async () => {
    await expect(ipRateLimitKey({}, 'job-tick-miss')).resolves.toBe('job-tick-miss:ip:unknown');
  });
});

describe('waitMinutes', () => {
  it.each([
    [0, 1],
    [30, 1],
    [60, 1],
    [61, 2],
    [15 * 60, 15],
  ])('after %i seconds says %i minutes', (seconds, minutes) => {
    expect(waitMinutes(seconds)).toBe(minutes);
  });
});

describe('tooManyAttemptsError', () => {
  it.each([
    [30, 'Too many attempts. Try again in 1 minute.'],
    [61, 'Too many attempts. Try again in 2 minutes.'],
    [15 * 60, 'Too many attempts. Try again in 15 minutes.'],
  ])('after %i seconds says %j', (seconds, message) => {
    const error = tooManyAttemptsError(seconds);
    expect(error).toMatchObject({ code: 'rate_limited', key: 'errors.tooManyAttempts' });
    expect(serviceErrorMessage(error, 'en-US')).toBe(message);
  });

  it('says how long to wait in Dutch and Spanish', () => {
    expect(serviceErrorMessage(tooManyAttemptsError(61), 'nl-NL')).toBe(
      'Te veel pogingen. Probeer het over 2 minuten opnieuw.',
    );
    expect(serviceErrorMessage(tooManyAttemptsError(30), 'es-ES')).toBe(
      'Demasiados intentos. Vuelve a intentarlo dentro de 1 minuto.',
    );
  });
});
