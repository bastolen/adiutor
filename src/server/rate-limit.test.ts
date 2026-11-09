/**
 * @file Tests for the rate limit message (the limits themselves are covered
 * by the integration tests).
 */
import { describe, expect, it } from 'vitest';

import { serviceErrorMessage } from './errors';
import { tooManyAttemptsError, waitMinutes } from './rate-limit';

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
