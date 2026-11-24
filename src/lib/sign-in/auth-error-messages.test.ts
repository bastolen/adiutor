/**
 * @file Tests for sign-in error messages, in the reader's language.
 */
import { describe, expect, it } from 'vitest';

import { messagesFor } from '@/lib/i18n/messages';
import translator from '@/lib/i18n/translator';

import {
  authCodeText,
  authErrorText,
  isAuthErrorCode,
  knownAuthErrorText,
  reverifyErrorText,
  signInChangeRefusalText,
  signInErrorText,
  signInNoticeText,
} from './auth-error-messages';
import {
  ACCOUNT_DEACTIVATED,
  EMAIL_CODE_SENT_RECENTLY,
  INVALID_PASSKEY_NAME,
  isServerWorded,
  PASSWORD_SIGN_IN_PAUSED,
  RESET_ENDS_PROVIDER_MFA,
  REVERIFY_WRONG_ACCOUNT,
  SERVER_WORDED_CODES,
  TOO_MANY_ATTEMPTS,
  TWO_FACTOR_ALREADY_OFF,
  UNSAFE_RETURN_ADDRESS,
} from './sign-in-refusals';

/** The `auth` messages in English (US). */
const en = translator('en-US', 'auth');

/** The `auth` messages in Dutch. */
const nl = translator('nl-NL', 'auth');

/** The `auth` messages in Spanish. */
const es = translator('es-ES', 'auth');

/** What the step-up page says when "Confirm with GitHub" signed in with another account. */
const GITHUB_WRONG_ACCOUNT =
  "GitHub couldn't confirm it's you: you signed in with a different GitHub account than the one you set up as a second step. Nothing was changed. Sign in to GitHub with that account and try again, or use another second step.";

/** The same, when the page doesn't know which provider it was. */
const NEUTRAL_WRONG_ACCOUNT =
  "The sign-in provider couldn't confirm it's you: you signed in with a different account than the one you set up as a second step. Nothing was changed. Sign in with that account and try again, or use another second step.";

/** The general failure. */
const FALLBACK = 'Signing in failed. Please try again.';

describe('knownAuthErrorText', () => {
  it('gives the message of a known code, and nothing for others', () => {
    expect(knownAuthErrorText(en, 'INVALID_TOKEN')).toBe(signInErrorText(en, 'INVALID_TOKEN'));
    expect(knownAuthErrorText(en, 'state_mismatch')).toBeNull();
    expect(knownAuthErrorText(en, 'toString')).toBeNull();
    expect(knownAuthErrorText(en, 'constructor')).toBeNull();
    expect(isAuthErrorCode('hasOwnProperty')).toBe(false);
  });

  it('has a message for every code in the catalogue, the same as the refusal it belongs to', () => {
    const codes = Object.keys(messagesFor('en-US').auth.codes.errors);
    expect(codes.length).toBeGreaterThan(30);
    codes.forEach((code) => {
      expect(isAuthErrorCode(code)).toBe(true);
      expect(knownAuthErrorText(en, code)).toBeTruthy();
    });
    // The refusals have no text of their own, except the two Better Auth throws itself.
    [ACCOUNT_DEACTIVATED, REVERIFY_WRONG_ACCOUNT].forEach(({ code, message }) =>
      expect(knownAuthErrorText(en, code)).toBe(message),
    );
    [
      EMAIL_CODE_SENT_RECENTLY,
      INVALID_PASSKEY_NAME,
      RESET_ENDS_PROVIDER_MFA,
      TOO_MANY_ATTEMPTS,
      TWO_FACTOR_ALREADY_OFF,
      UNSAFE_RETURN_ADDRESS,
    ].forEach(({ code }) => expect(isAuthErrorCode(code)).toBe(true));
  });
});

describe('signInErrorText', () => {
  it('returns nothing when there is no error', () => {
    expect(signInErrorText(en, null)).toBeNull();
    expect(signInErrorText(en, '')).toBeNull();
  });

  it('explains that sign-up is disabled for unknown emails', () => {
    expect(signInErrorText(en, 'signup_disabled')).toContain('no Adiutor account');
    expect(signInErrorText(en, 'new_user_signup_disabled')).toContain('no Adiutor account');
  });

  it('explains invalid and expired links', () => {
    expect(signInErrorText(en, 'INVALID_TOKEN')).toContain('invalid');
    expect(signInErrorText(en, 'expired_token')).toContain('expired');
  });

  it('explains a refused passkey name, with its longest length', () => {
    expect(authCodeText(en, INVALID_PASSKEY_NAME.code)).toBe(
      'Use a passkey name of 1 to 64 characters, without line breaks or invisible characters.',
    );
    expect(authCodeText(nl, INVALID_PASSKEY_NAME.code)).toBe(
      'Gebruik een passkeynaam van 1 tot 64 tekens, zonder regeleinden of onzichtbare tekens.',
    );
  });

  it('explains a reset link that would end provider MFA, without naming the provider', () => {
    expect(signInErrorText(en, RESET_ENDS_PROVIDER_MFA.code)).toBe(
      "This account signs in with a provider account as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with that account, then set a password on the Security page.",
    );
  });

  it('says that two-step verification is already off, and that nothing changed', () => {
    expect(signInErrorText(en, TWO_FACTOR_ALREADY_OFF.code)).toBe(
      'Two-step verification is already off. Nothing was changed.',
    );
  });

  it('falls back to a generic message for unknown codes', () => {
    expect(signInErrorText(en, 'something_else')).toBe(FALLBACK);
    expect(signInErrorText(en, 'toString')).toBe(FALLBACK);
  });
});

describe('signInNoticeText', () => {
  it('gives the note for a known notice, and nothing for others', () => {
    expect(signInNoticeText(en, 'joined-mfa-required')).toBe(
      'You’ve joined. Your new role requires MFA, so sign in again and then set up a passkey or an authenticator app.',
    );
    expect(signInNoticeText(en, 'toString')).toBeNull();
    expect(signInNoticeText(en, null)).toBeNull();
  });
});

describe('signInChangeRefusalText', () => {
  it('gives the message of a refused sign-in change, and nothing for other codes', () => {
    expect(signInChangeRefusalText(en, 'SIGN_IN_CHANGE_IN_PROGRESS')).toBe(
      'Another change to how you sign in is still in progress. Try again in a moment.',
    );
    expect(signInChangeRefusalText(en, 'MFA_REQUIRED_FOR_ROLE')).toBe(
      signInErrorText(en, 'MFA_REQUIRED_FOR_ROLE'),
    );
    expect(signInChangeRefusalText(en, 'INVALID_PASSWORD')).toBeNull();
    expect(signInChangeRefusalText(en, undefined)).toBeNull();
  });
});

describe('reverifyErrorText', () => {
  it('says "Confirm with GitHub" signed in with a different account, naming the provider', () => {
    expect(reverifyErrorText(en, REVERIFY_WRONG_ACCOUNT.code, 'github')).toBe(GITHUB_WRONG_ACCOUNT);
  });

  it('says the same for an address without an Adiutor account, or one Better Auth wouldn’t connect', () => {
    // Otherwise the page would tell whether an address has an Adiutor account.
    expect(reverifyErrorText(en, 'signup_disabled', 'github')).toBe(GITHUB_WRONG_ACCOUNT);
    expect(reverifyErrorText(en, 'account_not_linked', 'github')).toBe(GITHUB_WRONG_ACCOUNT);
  });

  it('names no provider without one that can prove MFA, since the browser can change it', () => {
    [undefined, null, '', 'google', 'gitlab', 'toString'].forEach((provider) =>
      expect(reverifyErrorText(en, REVERIFY_WRONG_ACCOUNT.code, provider)).toBe(
        NEUTRAL_WRONG_ACCOUNT,
      ),
    );
    expect(signInErrorText(en, REVERIFY_WRONG_ACCOUNT.code)).toBe(NEUTRAL_WRONG_ACCOUNT);
  });

  it('gives other codes their usual message, and nothing without one', () => {
    expect(reverifyErrorText(en, 'ACCOUNT_DEACTIVATED', 'github')).toBe(
      signInErrorText(en, 'ACCOUNT_DEACTIVATED'),
    );
    expect(reverifyErrorText(en, 'access_denied', 'github')).toBe(FALLBACK);
    expect(reverifyErrorText(en, undefined, 'github')).toBeNull();
    expect(reverifyErrorText(en, '', undefined)).toBeNull();
  });

  it('names the provider where Dutch and Spanish put it', () => {
    expect(reverifyErrorText(nl, REVERIFY_WRONG_ACCOUNT.code, 'github')).toBe(
      'GitHub kon niet bevestigen dat jij het bent: je logde in met een ander GitHub-account dan het account dat je als tweede stap hebt ingesteld. Er is niets gewijzigd. Log met dat account in bij GitHub en probeer het opnieuw, of gebruik een andere tweede stap.',
    );
    expect(reverifyErrorText(es, REVERIFY_WRONG_ACCOUNT.code, 'github')).toBe(
      'GitHub no ha podido confirmar que eres tú: has iniciado sesión con una cuenta de GitHub distinta de la que configuraste como segundo paso. No se ha cambiado nada. Inicia sesión en GitHub con esa cuenta y vuelve a intentarlo, o usa otro segundo paso.',
    );
    expect(authCodeText(es, EMAIL_CODE_SENT_RECENTLY.code)).toBe(
      'Te hemos enviado un código hace un momento. Usa ese o pide uno nuevo dentro de unos minutos.',
    );
  });
});

describe('authErrorText', () => {
  it('shows the refusals the server words itself as they come', () => {
    expect([...SERVER_WORDED_CODES].sort()).toEqual(
      [TOO_MANY_ATTEMPTS.code, PASSWORD_SIGN_IN_PAUSED.code, RESET_ENDS_PROVIDER_MFA.code].sort(),
    );
    const paused = 'Inloggen met een wachtwoord is voor dit adres 12 minuten gepauzeerd …';
    expect(
      authErrorText(en, { status: 429, code: 'PASSWORD_SIGN_IN_PAUSED', message: paused }),
    ).toBe(paused);
    expect(
      authErrorText(en, {
        status: 429,
        code: TOO_MANY_ATTEMPTS.code,
        message: 'Too many attempts. Try again in 12 minutes.',
      }),
    ).toBe('Too many attempts. Try again in 12 minutes.');
  });

  it("uses its own message when the server's is missing", () => {
    expect(authErrorText(en, { status: 429, code: TOO_MANY_ATTEMPTS.code })).toBe(
      en('codes.errors.TOO_MANY_ATTEMPTS'),
    );
    expect(authErrorText(en, { status: 403, code: RESET_ENDS_PROVIDER_MFA.code })).toBe(
      en('codes.errors.RESET_ENDS_PROVIDER_MFA'),
    );
  });

  it("never shows Better Auth's own message", () => {
    expect(authErrorText(es, { status: 401, code: 'INVALID_CODE', message: 'Invalid code' })).toBe(
      'Ese código no es correcto. Revísalo y vuelve a intentarlo.',
    );
    expect(
      authErrorText(en, { status: 400, code: 'SOMETHING_NEW', message: 'Something new' }),
    ).toBe('Signing in failed. Please try again.');
    expect(authErrorText(en, { status: 400, message: 'Failed' })).toBe(
      'Signing in failed. Please try again.',
    );
  });

  it('gives other rate limits a general message, and other failures the fallback', () => {
    expect(authErrorText(en, { status: 429 })).toBe(
      'Too many requests. Wait a few seconds and try again.',
    );
    expect(authErrorText(nl, { status: 429, code: 'TOO_MANY_REQUESTS' })).toBe(
      'Dat ging te snel achter elkaar. Wacht een paar seconden en probeer het opnieuw.',
    );
    expect(authErrorText(en, { status: 429, code: 'ACCOUNT_TEMPORARILY_LOCKED' })).toBe(
      'Too many wrong codes. For your safety, signing in is paused for 15 minutes.',
    );
    expect(authErrorText(en, { status: 500 }, 'Sending the link failed. Please try again.')).toBe(
      'Sending the link failed. Please try again.',
    );
  });
});

describe('isServerWorded', () => {
  it('tells the refusals the server words itself from the others', () => {
    expect(isServerWorded('PASSWORD_SIGN_IN_PAUSED')).toBe(true);
    expect(isServerWorded(TOO_MANY_ATTEMPTS.code)).toBe(true);
    expect(isServerWorded(EMAIL_CODE_SENT_RECENTLY.code)).toBe(false);
    expect(isServerWorded(undefined)).toBe(false);
  });
});
