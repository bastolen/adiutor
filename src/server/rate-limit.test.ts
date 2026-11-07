/**
 * @file Tests for the rate limit message (the limits themselves are covered
 * by the integration tests).
 */
import { describe, expect, it } from 'vitest';

import { tooManyAttemptsMessage } from './rate-limit';

describe('tooManyAttemptsMessage', () => {
  it.each([
    [0, 'Too many attempts. Try again in 1 minute.'],
    [30, 'Too many attempts. Try again in 1 minute.'],
    [60, 'Too many attempts. Try again in 1 minute.'],
    [61, 'Too many attempts. Try again in 2 minutes.'],
    [15 * 60, 'Too many attempts. Try again in 15 minutes.'],
  ])('after %i seconds says %j', (seconds, message) => {
    expect(tooManyAttemptsMessage(seconds)).toBe(message);
  });
});
