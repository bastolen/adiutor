/**
 * @file Tests for sign-in error messages.
 */
import { describe, expect, it } from 'vitest';

import getAuthErrorMessage, {
  authErrorMessage,
  codeStepErrorMessage,
  knownAuthErrorMessage,
  reverifyErrorMessage,
  signInChangeRefusalMessage,
} from './auth-error-messages';
import {
  INVALID_PASSKEY_NAME,
  RESET_ENDS_PROVIDER_MFA,
  resetEndsProviderMfaMessage,
  REVERIFY_WRONG_ACCOUNT,
  TWO_FACTOR_ALREADY_OFF,
  UNSAFE_RETURN_ADDRESS,
} from './sign-in-refusals';

/** What the step-up page says when "Confirm with GitHub" signed in with another account. */
const GITHUB_WRONG_ACCOUNT =
  "GitHub couldn't confirm it's you: you signed in with a different GitHub account than the one you set up as a second step. Nothing was changed. Sign in to GitHub with that account and try again, or use another second step.";

/** The same, when the page doesn't know which provider it was. */
const NEUTRAL_WRONG_ACCOUNT =
  "The sign-in provider couldn't confirm it's you: you signed in with a different account than the one you set up as a second step. Nothing was changed. Sign in with that account and try again, or use another second step.";

describe('knownAuthErrorMessage', () => {
  it('gives the message of a known code, and nothing for others', () => {
    expect(knownAuthErrorMessage('INVALID_TOKEN')).toBe(getAuthErrorMessage('INVALID_TOKEN'));
    expect(knownAuthErrorMessage('state_mismatch')).toBeNull();
    expect(knownAuthErrorMessage('toString')).toBeNull();
  });
});

describe('getAuthErrorMessage', () => {
  it('returns nothing when there is no error', () => {
    expect(getAuthErrorMessage(null)).toBeNull();
    expect(getAuthErrorMessage('')).toBeNull();
  });

  it('explains that sign-up is disabled for unknown emails', () => {
    expect(getAuthErrorMessage('signup_disabled')).toContain('no Adiutor account');
    expect(getAuthErrorMessage('new_user_signup_disabled')).toContain('no Adiutor account');
  });

  it('explains invalid and expired links', () => {
    expect(getAuthErrorMessage('INVALID_TOKEN')).toContain('invalid');
    expect(getAuthErrorMessage('expired_token')).toContain('expired');
  });

  it('explains a return address that is not a page of the app', () => {
    expect(getAuthErrorMessage(UNSAFE_RETURN_ADDRESS.code)).toBe(UNSAFE_RETURN_ADDRESS.message);
  });

  it('explains a refused passkey name, with its longest length', () => {
    expect(getAuthErrorMessage(INVALID_PASSKEY_NAME.code)).toBe(
      'Use a passkey name of 1 to 64 characters, without line breaks or invisible characters.',
    );
  });

  it('explains a reset link that would end provider MFA, without naming the provider', () => {
    expect(getAuthErrorMessage(RESET_ENDS_PROVIDER_MFA.code)).toBe(
      "This account signs in with a provider account as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with that account, then set a password on the Security page.",
    );
    expect(knownAuthErrorMessage(RESET_ENDS_PROVIDER_MFA.code)).toBe(
      RESET_ENDS_PROVIDER_MFA.message,
    );
  });

  it('says that two-step verification is already off, and that nothing changed', () => {
    expect(getAuthErrorMessage(TWO_FACTOR_ALREADY_OFF.code)).toBe(
      'Two-step verification is already off. Nothing was changed.',
    );
    expect(authErrorMessage({ code: TWO_FACTOR_ALREADY_OFF.code })).toBe(
      TWO_FACTOR_ALREADY_OFF.message,
    );
  });

  it('falls back to a generic message for unknown codes', () => {
    expect(getAuthErrorMessage('something_else')).toBe('Signing in failed. Please try again.');
    expect(getAuthErrorMessage('toString')).toBe('Signing in failed. Please try again.');
  });
});

describe('resetEndsProviderMfaMessage', () => {
  it('names the provider and points to the Security page', () => {
    expect(resetEndsProviderMfaMessage(['github'], false)).toBe(
      "This account signs in with GitHub as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with GitHub, then set a password on the Security page.",
    );
  });

  it('asks roles that require MFA to add a passkey or an authenticator app first', () => {
    expect(resetEndsProviderMfaMessage(['github'], true)).toBe(
      "This account signs in with GitHub as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with GitHub, add a passkey or an authenticator app on the Security page, then set a password there.",
    );
  });

  it('joins several providers, and names none without one', () => {
    expect(resetEndsProviderMfaMessage(['github', 'google'], false)).toContain(
      'signs in with GitHub or Google as its second step',
    );
    expect(resetEndsProviderMfaMessage([], true)).toBe(
      "This account signs in with a provider account as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with that account, add a passkey or an authenticator app on the Security page, then set a password there.",
    );
  });
});

describe('authErrorMessage', () => {
  it("uses the error's code, or the general message without one", () => {
    expect(authErrorMessage({ code: 'INVALID_CODE', message: 'Invalid code' })).toBe(
      getAuthErrorMessage('INVALID_CODE'),
    );
    expect(authErrorMessage({ code: 'something_else' })).toBe(
      'Signing in failed. Please try again.',
    );
    expect(authErrorMessage({ message: 'Failed' })).toBe('Signing in failed. Please try again.');
    expect(authErrorMessage({ code: undefined })).toBe('Signing in failed. Please try again.');
  });
});

describe('codeStepErrorMessage', () => {
  it('gives rate limits without their own message a general one', () => {
    expect(codeStepErrorMessage({ status: 429 })).toBe(
      'Too many requests. Wait a few seconds and try again.',
    );
    expect(codeStepErrorMessage({ status: 429, code: 'TOO_MANY_REQUESTS' })).toBe(
      'Too many requests. Wait a few seconds and try again.',
    );
  });

  it('keeps the messages of the app’s own limits and other errors', () => {
    expect(codeStepErrorMessage({ status: 429, code: 'ACCOUNT_TEMPORARILY_LOCKED' })).toBe(
      getAuthErrorMessage('ACCOUNT_TEMPORARILY_LOCKED'),
    );
    expect(codeStepErrorMessage({ status: 429, code: 'TOO_MANY_ATTEMPTS' })).toBe(
      getAuthErrorMessage('TOO_MANY_ATTEMPTS'),
    );
    expect(codeStepErrorMessage({ status: 401, code: 'INVALID_CODE' })).toBe(
      getAuthErrorMessage('INVALID_CODE'),
    );
  });
});

describe('signInChangeRefusalMessage', () => {
  it('gives the message of a refused sign-in change, and nothing for other codes', () => {
    expect(signInChangeRefusalMessage('SIGN_IN_CHANGE_IN_PROGRESS')).toBe(
      getAuthErrorMessage('SIGN_IN_CHANGE_IN_PROGRESS'),
    );
    expect(signInChangeRefusalMessage('MFA_REQUIRED_FOR_ROLE')).toBe(
      getAuthErrorMessage('MFA_REQUIRED_FOR_ROLE'),
    );
    expect(signInChangeRefusalMessage('INVALID_PASSWORD')).toBeNull();
    expect(signInChangeRefusalMessage(undefined)).toBeNull();
  });
});

describe('reverifyErrorMessage', () => {
  it('says "Confirm with GitHub" signed in with a different account, naming the provider', () => {
    expect(reverifyErrorMessage(REVERIFY_WRONG_ACCOUNT.code, 'github')).toBe(GITHUB_WRONG_ACCOUNT);
  });

  it('says the same for an address without an Adiutor account, or one Better Auth wouldn’t connect', () => {
    // Otherwise the page would tell whether an address has an Adiutor account.
    expect(reverifyErrorMessage('signup_disabled', 'github')).toBe(GITHUB_WRONG_ACCOUNT);
    expect(reverifyErrorMessage('account_not_linked', 'github')).toBe(GITHUB_WRONG_ACCOUNT);
  });

  it('names no provider without one that can prove MFA, since the browser can change it', () => {
    [undefined, null, '', 'google', 'gitlab', 'toString'].forEach((provider) =>
      expect(reverifyErrorMessage(REVERIFY_WRONG_ACCOUNT.code, provider)).toBe(
        NEUTRAL_WRONG_ACCOUNT,
      ),
    );
    expect(getAuthErrorMessage(REVERIFY_WRONG_ACCOUNT.code)).toBe(NEUTRAL_WRONG_ACCOUNT);
    expect(knownAuthErrorMessage(REVERIFY_WRONG_ACCOUNT.code)).toBe(NEUTRAL_WRONG_ACCOUNT);
  });

  it('gives other codes their usual message, and nothing without one', () => {
    expect(reverifyErrorMessage('ACCOUNT_DEACTIVATED', 'github')).toBe(
      getAuthErrorMessage('ACCOUNT_DEACTIVATED'),
    );
    expect(reverifyErrorMessage('access_denied', 'github')).toBe(
      'Signing in failed. Please try again.',
    );
    expect(reverifyErrorMessage(undefined, 'github')).toBeNull();
    expect(reverifyErrorMessage('', undefined)).toBeNull();
  });
});
