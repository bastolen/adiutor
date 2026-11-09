/**
 * @file Tests for the wording of the guards' refusals: in the language of
 * the request they refuse, with the wait or the providers where each
 * language puts them.
 */
import { describe, expect, it } from 'vitest';

import { LOCALE_COOKIE, type Locale } from '@/lib/i18n/locales';

import {
  passwordSignInPausedBody,
  refusalBody,
  resetEndsProviderMfaBody,
  tooManyAttemptsBody,
  twoFactorMethodNotAllowedBody,
} from './refusal-messages';

/**
 * A request from a browser that chose a language.
 *
 * @param locale - The language cookie's value.
 * @returns The request's part the wording reads.
 */
function requestIn(locale: Locale) {
  return { headers: new Headers({ cookie: `other=1; ${LOCALE_COOKIE}=${locale}` }) };
}

/** A request without headers: worded in English (US). */
const noHeaders = {};

describe('tooManyAttemptsBody', () => {
  it('says how long to wait, in English (US) without a language', () => {
    expect(tooManyAttemptsBody(noHeaders, 60)).toEqual({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many attempts. Try again in 1 minute.',
    });
    expect(tooManyAttemptsBody({ headers: null }, 12 * 60).message).toBe(
      'Too many attempts. Try again in 12 minutes.',
    );
  });

  it("puts the wait where Dutch and Spanish put it, from the request's language cookie", () => {
    expect(tooManyAttemptsBody(requestIn('nl-NL'), 12 * 60).message).toBe(
      'Te veel pogingen. Probeer het over 12 minuten opnieuw.',
    );
    expect(tooManyAttemptsBody(requestIn('nl-NL'), 30).message).toBe(
      'Te veel pogingen. Probeer het over 1 minuut opnieuw.',
    );
    expect(tooManyAttemptsBody(requestIn('es-ES'), 12 * 60).message).toBe(
      'Demasiados intentos. Vuelve a intentarlo dentro de 12 minutos.',
    );
  });
});

describe('passwordSignInPausedBody', () => {
  it('says for how long, and the ways in that still work', () => {
    expect(passwordSignInPausedBody(noHeaders, 15 * 60)).toEqual({
      code: 'PASSWORD_SIGN_IN_PAUSED',
      message:
        'Password sign-in for this address is paused for 15 minutes after too many wrong passwords. Sign in with an email link or a passkey, or reset your password to lift the pause.',
    });
    expect(passwordSignInPausedBody(requestIn('nl-NL'), 60).message).toBe(
      'Inloggen met een wachtwoord is voor dit adres 1 minuut gepauzeerd na te veel verkeerde wachtwoorden. Log in met een e-maillink of een passkey, of stel je wachtwoord opnieuw in om de pauze op te heffen.',
    );
    expect(passwordSignInPausedBody(requestIn('es-ES'), 15 * 60).message).toMatch(
      /^El inicio de sesión con contraseña para esta dirección está en pausa durante 15 minutos /,
    );
  });
});

describe('resetEndsProviderMfaBody', () => {
  it('names the provider and points to the Security page', () => {
    expect(resetEndsProviderMfaBody(noHeaders, ['github'], false)).toEqual({
      code: 'RESET_ENDS_PROVIDER_MFA',
      message:
        "This account signs in with GitHub as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with GitHub, then set a password on the Security page.",
    });
  });

  it('asks roles that require MFA to add a passkey or an authenticator app first', () => {
    expect(resetEndsProviderMfaBody(noHeaders, ['github'], true).message).toBe(
      "This account signs in with GitHub as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with GitHub, add a passkey or an authenticator app on the Security page, then set a password there.",
    );
  });

  it('joins several providers in the reader’s language, and names none without one', () => {
    expect(resetEndsProviderMfaBody(noHeaders, ['github', 'google'], false).message).toContain(
      'signs in with GitHub or Google as its second step',
    );
    expect(resetEndsProviderMfaBody(requestIn('nl-NL'), ['github', 'google'], false).message).toBe(
      'Dit account gebruikt GitHub of Google als tweede stap, dus met een resetlink kun je geen wachtwoord instellen. Er is niets gewijzigd. Log in met GitHub of Google en stel daarna een wachtwoord in op de pagina Beveiliging.',
    );
    expect(resetEndsProviderMfaBody(requestIn('es-ES'), ['github'], true).message).toContain(
      'Esta cuenta usa GitHub como segundo paso',
    );
    expect(resetEndsProviderMfaBody(noHeaders, [], true).message).toBe(
      "This account signs in with a provider account as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with that account, add a passkey or an authenticator app on the Security page, then set a password there.",
    );
  });
});

describe('refusalBody', () => {
  it("gives the code and its message in the request's language", () => {
    expect(refusalBody(noHeaders, 'TWO_FACTOR_ALREADY_OFF')).toEqual({
      code: 'TWO_FACTOR_ALREADY_OFF',
      message: 'Two-step verification is already off. Nothing was changed.',
    });
    expect(refusalBody(requestIn('es-ES'), 'TWO_FACTOR_ALREADY_OFF').message).toBe(
      'La verificación en dos pasos ya está desactivada. No se ha cambiado nada.',
    );
  });

  it('ignores a language cookie Adiutor doesn’t speak', () => {
    const request = { headers: new Headers({ cookie: `${LOCALE_COOKIE}=fr-FR` }) };
    expect(twoFactorMethodNotAllowedBody(request)).toEqual({
      code: 'TWO_FACTOR_METHOD_NOT_ALLOWED',
      message: 'Turn on email codes with a code sent to you.',
    });
  });
});
