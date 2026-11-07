/**
 * @file Tests for account page messages.
 */
import { describe, expect, it } from 'vitest';

import accountMessage, { disconnectFailureMessage, VERIFIED_RETURN_PATH } from './account-messages';

describe('VERIFIED_RETURN_PATH', () => {
  it('comes back to the Email card on the Profile page, saying it worked', () => {
    expect(VERIFIED_RETURN_PATH).toBe('/account?verified=1#email');
  });
});

describe('accountMessage', () => {
  it('confirms verification and connections', () => {
    expect(accountMessage({ verified: '1' })).toEqual({
      tone: 'success',
      text: 'Your email address is verified.',
    });
    expect(accountMessage({ connected: 'github' })?.text).toBe('GitHub is now connected.');
    expect(accountMessage({ connected: 'google' })?.text).toBe('Google is now connected.');
  });

  it('explains verification and connection errors', () => {
    expect(accountMessage({ error: 'TOKEN_EXPIRED' })?.text).toContain('expired');
    expect(accountMessage({ error: 'INVALID_TOKEN' })?.text).toContain('invalid');
    expect(accountMessage({ error: 'account_already_linked_to_different_user' })?.text).toContain(
      'another Adiutor account',
    );
    expect(accountMessage({ error: 'email_not_verified' })?.text).toContain("hasn't verified");
    expect(accountMessage({ error: 'something_else' })?.text).toBe(
      'That didn’t work. Please try again.',
    );
    expect(accountMessage({ error: 'toString' })?.tone).toBe('error');
  });

  it('shows the error when Better Auth appends one to a success URL', () => {
    expect(accountMessage({ verified: '1', error: 'TOKEN_EXPIRED' })?.tone).toBe('error');
    expect(accountMessage({ connected: 'github', error: 'unable_to_link_account' })?.tone).toBe(
      'error',
    );
  });

  it('ignores unknown providers and empty parameters', () => {
    expect(accountMessage({ connected: 'myspace' })).toBeNull();
    expect(accountMessage({})).toBeNull();
  });
});

describe('disconnectFailureMessage', () => {
  it('says why a disconnect was refused, and what to do', () => {
    expect(disconnectFailureMessage('SESSION_NOT_FRESH')).toBe(
      'For your safety, sign out and in again before disconnecting.',
    );
    expect(disconnectFailureMessage('MFA_REQUIRED_FOR_ROLE')).toContain('Add a passkey first');
    expect(disconnectFailureMessage('SIGN_IN_CHANGE_IN_PROGRESS')).toBe(
      'Another change to how you sign in is still in progress. Try again in a moment.',
    );
    expect(disconnectFailureMessage(undefined)).toBe('Disconnecting failed. Please try again.');
  });
});
