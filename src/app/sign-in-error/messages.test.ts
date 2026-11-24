/**
 * @file Tests for what the sign-in error page says per error code.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';
import { UNSAFE_RETURN_ADDRESS } from '@/lib/sign-in/sign-in-refusals';

import signInErrorMessage from './messages';

/** The page's messages in English (US). */
const t = translator('en-US', 'auth');

/** What the page says for codes without a message of their own. */
const GENERIC_SIGN_IN_ERROR = 'Something went wrong while signing you in. Please try again.';

describe('signInErrorMessage', () => {
  it('explains a sign-in through a provider that took too long or got mixed up', () => {
    const restart = 'The sign-in took too long, or was started in another tab. Please try again.';
    expect(signInErrorMessage(t, 'state_mismatch')).toBe(restart);
    expect(signInErrorMessage(t, 'please_restart_the_process')).toBe(restart);
  });

  it('explains cancelled sign-ins and accounts that could not be connected', () => {
    expect(signInErrorMessage(t, 'access_denied')).toMatch(/cancelled at the provider/);
    expect(signInErrorMessage(t, 'account_already_linked_to_different_user')).toMatch(
      /already connected to another Adiutor account/,
    );
    expect(signInErrorMessage(t, "email_doesn't_match")).toMatch(/doesn't match yours/);
  });

  it("uses the sign-in page's messages for the codes it knows", () => {
    expect(signInErrorMessage(t, 'signup_disabled')).toMatch(/no Adiutor account for that email/);
  });

  it('explains a link the auth guards refused for where it would go', () => {
    expect(signInErrorMessage(t, UNSAFE_RETURN_ADDRESS.code)).toBe(
      t('codes.errors.UNSAFE_RETURN_ADDRESS'),
    );
  });

  it('falls back to a general message for anything else', () => {
    expect(signInErrorMessage(t, 'UNKNOWN')).toBe(GENERIC_SIGN_IN_ERROR);
    expect(signInErrorMessage(t, 'internal_server_error')).toBe(GENERIC_SIGN_IN_ERROR);
    expect(signInErrorMessage(t, 'toString')).toBe(GENERIC_SIGN_IN_ERROR);
  });

  it('never shows the code itself', () => {
    [
      'state_mismatch',
      'access_denied',
      'signup_disabled',
      UNSAFE_RETURN_ADDRESS.code,
      'UNKNOWN',
      'something_new',
    ].forEach((code) => {
      expect(signInErrorMessage(t, code)).not.toContain(code);
    });
  });

  it('speaks Dutch and Spanish', () => {
    expect(signInErrorMessage(translator('nl-NL', 'auth'), 'access_denied')).toBe(
      'Het inloggen is bij de provider geannuleerd. Probeer het opnieuw, of log op een andere manier in.',
    );
    expect(signInErrorMessage(translator('es-ES', 'auth'), 'UNKNOWN')).toBe(
      'Algo ha ido mal al iniciar sesión. Vuelve a intentarlo.',
    );
  });
});
