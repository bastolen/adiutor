/**
 * @file Tests for account page messages.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

import accountMessage, { disconnectFailureMessage, VERIFIED_RETURN_PATH } from './account-messages';

/** The account pages' messages in English (US). */
const t = translator('en-US', 'account');

/** The sign-in messages in English (US). */
const tAuth = translator('en-US', 'auth');

describe('VERIFIED_RETURN_PATH', () => {
  it('comes back to the Email card on the Profile page, saying it worked', () => {
    expect(VERIFIED_RETURN_PATH).toBe('/account?verified=1#email');
  });
});

describe('accountMessage', () => {
  it('confirms verification and connections', () => {
    expect(accountMessage(t, { verified: '1' })).toEqual({
      tone: 'success',
      text: 'Your email address is verified.',
    });
    expect(accountMessage(t, { connected: 'github' })?.text).toBe('GitHub is now connected.');
    expect(accountMessage(t, { connected: 'google' })?.text).toBe('Google is now connected.');
  });

  it('explains verification and connection errors', () => {
    expect(accountMessage(t, { error: 'TOKEN_EXPIRED' })?.text).toContain('expired');
    expect(accountMessage(t, { error: 'INVALID_TOKEN' })?.text).toContain('invalid');
    expect(
      accountMessage(t, { error: 'account_already_linked_to_different_user' })?.text,
    ).toContain('another Adiutor account');
    expect(accountMessage(t, { error: 'email_not_verified' })?.text).toContain("hasn't verified");
    expect(accountMessage(t, { error: 'something_else' })?.text).toBe(
      'That didn’t work. Please try again.',
    );
    expect(accountMessage(t, { error: 'toString' })?.tone).toBe('error');
  });

  it('shows the error when Better Auth appends one to a success URL', () => {
    expect(accountMessage(t, { verified: '1', error: 'TOKEN_EXPIRED' })?.tone).toBe('error');
    expect(accountMessage(t, { connected: 'github', error: 'unable_to_link_account' })?.tone).toBe(
      'error',
    );
  });

  it('ignores unknown providers and empty parameters', () => {
    expect(accountMessage(t, { connected: 'myspace' })).toBeNull();
    expect(accountMessage(t, {})).toBeNull();
  });
});

describe('disconnectFailureMessage', () => {
  it('says why a disconnect was refused, and what to do', () => {
    expect(disconnectFailureMessage(t, tAuth, 'SESSION_NOT_FRESH')).toBe(
      'For your safety, sign out and in again before disconnecting.',
    );
    expect(disconnectFailureMessage(t, tAuth, 'MFA_REQUIRED_FOR_ROLE')).toContain(
      'Add a passkey first',
    );
    expect(disconnectFailureMessage(t, tAuth, 'SIGN_IN_CHANGE_IN_PROGRESS')).toBe(
      'Another change to how you sign in is still in progress. Try again in a moment.',
    );
    expect(disconnectFailureMessage(t, tAuth, undefined)).toBe(
      'Disconnecting failed. Please try again.',
    );
  });
});

describe('in Dutch and Spanish', () => {
  it('names the connected provider where the language puts it', () => {
    expect(accountMessage(translator('nl-NL', 'account'), { connected: 'github' })?.text).toBe(
      'GitHub is nu gekoppeld.',
    );
    expect(accountMessage(translator('es-ES', 'account'), { connected: 'google' })?.text).toBe(
      'Google ya está conectado.',
    );
  });
});
