/**
 * @file Tests for what the sign-in error page says per error code.
 */
import { describe, expect, it } from 'vitest';

import { UNSAFE_RETURN_ADDRESS } from '@/lib/sign-in/sign-in-refusals';

import signInErrorMessage, { GENERIC_SIGN_IN_ERROR } from './messages';

describe('signInErrorMessage', () => {
  it('explains a sign-in through a provider that took too long or got mixed up', () => {
    const restart = 'The sign-in took too long, or was started in another tab. Please try again.';
    expect(signInErrorMessage('state_mismatch')).toBe(restart);
    expect(signInErrorMessage('please_restart_the_process')).toBe(restart);
  });

  it('explains cancelled sign-ins and accounts that could not be connected', () => {
    expect(signInErrorMessage('access_denied')).toMatch(/cancelled at the provider/);
    expect(signInErrorMessage('account_already_linked_to_different_user')).toMatch(
      /already connected to another Adiutor account/,
    );
    expect(signInErrorMessage("email_doesn't_match")).toMatch(/doesn't match yours/);
  });

  it("uses the sign-in page's messages for the codes it knows", () => {
    expect(signInErrorMessage('signup_disabled')).toMatch(/no Adiutor account for that email/);
  });

  it('explains a link the auth guards refused for where it would go', () => {
    expect(signInErrorMessage(UNSAFE_RETURN_ADDRESS.code)).toBe(UNSAFE_RETURN_ADDRESS.message);
  });

  it('falls back to a general message for anything else', () => {
    expect(signInErrorMessage('UNKNOWN')).toBe(GENERIC_SIGN_IN_ERROR);
    expect(signInErrorMessage('internal_server_error')).toBe(GENERIC_SIGN_IN_ERROR);
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
      expect(signInErrorMessage(code)).not.toContain(code);
    });
  });
});
