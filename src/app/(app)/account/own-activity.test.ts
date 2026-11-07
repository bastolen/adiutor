/**
 * @file Tests for describing a user's own activity.
 */
import { describe, expect, it } from 'vitest';

import { OAUTH_PROVIDERS, PROVIDER_LABELS } from '@/lib/sign-in/oauth-providers';

import describeOwnActivity, { type OwnActivityEntry } from './own-activity';

const ME = 'user-1';

/**
 * Builds an event about the user.
 *
 * @param entry - The fields to set.
 * @returns The event.
 */
const event = (entry: Partial<OwnActivityEntry> & Pick<OwnActivityEntry, 'action'>) => ({
  details: {},
  company: null,
  actor: { id: ME, name: 'Jane' },
  ...entry,
});

describe('describeOwnActivity', () => {
  it('names the sign-in method', () => {
    expect(
      describeOwnActivity(event({ action: 'sign_in', details: { method: 'passkey' } }), ME),
    ).toBe('Signed in with a passkey');
    expect(
      describeOwnActivity(event({ action: 'sign_in', details: { method: 'other' } }), ME),
    ).toBe('Signed in');
  });

  it('says a password sign-in asked for a code, without counting it as signed in', () => {
    expect(
      describeOwnActivity(
        event({ action: 'sign_in_code_pending', actor: null, details: { method: 'password' } }),
        ME,
      ),
    ).toBe('Entered your password; the sign-in then asked for your code');
  });

  it('calls a confirmed sign-in MFA verified', () => {
    expect(describeOwnActivity(event({ action: 'mfa_verified' }), ME)).toBe(
      'Verified a sign-in with MFA',
    );
  });

  it('describes failed attempts without anyone to blame', () => {
    expect(describeOwnActivity(event({ action: 'sign_in_failed', actor: null }), ME)).toBe(
      'Failed sign-in attempt with a wrong password',
    );
  });

  it('tells a wrong code from "Confirm with GitHub" with a different account', () => {
    expect(
      describeOwnActivity(event({ action: 'mfa_failed', details: { method: 'email_code' } }), ME),
    ).toBe('Failed MFA confirmation with a wrong code');
    expect(
      describeOwnActivity(
        event({ action: 'mfa_failed', details: { method: 'github', reason: 'different_account' } }),
        ME,
      ),
    ).toBe('Failed MFA confirmation with a different GitHub account');
    // A provider that was since removed.
    expect(
      describeOwnActivity(
        event({ action: 'mfa_failed', details: { method: 'gitlab', reason: 'different_account' } }),
        ME,
      ),
    ).toBe('Failed MFA confirmation with a different account');
  });

  it('tells a wrong code at sign-in from one on the step-up page', () => {
    expect(
      describeOwnActivity(
        event({
          action: 'mfa_failed',
          details: { method: 'authenticator', atSignIn: true },
          actor: null,
        }),
        ME,
      ),
    ).toBe('Wrong two-step verification code entered at sign-in');
    expect(
      describeOwnActivity(
        event({ action: 'mfa_failed', details: { method: 'authenticator' } }),
        ME,
      ),
    ).toBe('Failed MFA confirmation with a wrong code');
  });

  it('calls a confirmed account a second step only when it gave MFA', () => {
    expect(
      describeOwnActivity(
        event({ action: 'provider_confirmed', details: { providerId: 'github', givesMfa: true } }),
        ME,
      ),
    ).toBe('Confirmed GitHub as a second step');
    // GitHub without two-factor authentication, or an event from before `givesMfa` was recorded.
    expect(
      describeOwnActivity(
        event({ action: 'provider_confirmed', details: { providerId: 'github', givesMfa: false } }),
        ME,
      ),
    ).toBe('Confirmed GitHub');
    expect(
      describeOwnActivity(
        event({ action: 'provider_confirmed', details: { providerId: 'github' } }),
        ME,
      ),
    ).toBe('Confirmed GitHub');
    expect(
      describeOwnActivity(
        event({ action: 'provider_confirmed', details: { providerId: 'google', givesMfa: false } }),
        ME,
      ),
    ).toBe('Confirmed Google');
  });

  it.each(OAUTH_PROVIDERS)('names a sign-in with %s', (providerId) => {
    expect(
      describeOwnActivity(event({ action: 'sign_in', details: { method: providerId } }), ME),
    ).toBe(`Signed in with ${PROVIDER_LABELS[providerId]}`);
  });

  it('says who signed the user out', () => {
    expect(
      describeOwnActivity(event({ action: 'sessions_revoked', details: { others: true } }), ME),
    ).toBe('Signed out your other devices');
    expect(
      describeOwnActivity(
        event({ action: 'sessions_revoked', actor: null, details: { commandLine: true } }),
        ME,
      ),
    ).toBe('Signed out everywhere by an administrator');
    expect(
      describeOwnActivity(
        event({ action: 'sessions_revoked', actor: null, details: { mfaRequired: true } }),
        ME,
      ),
    ).toBe(
      'Signed out where you hadn’t confirmed with an authenticator app, a passkey or a provider with two-factor authentication, which your role now requires',
    );
    expect(
      describeOwnActivity(
        event({
          action: 'sessions_revoked',
          actor: null,
          company: { name: 'Adiutor Tests' },
          details: { mfaRequired: true },
        }),
        ME,
      ),
    ).toBe(
      'Signed out where you hadn’t confirmed with an authenticator app, a passkey or a provider with two-factor authentication, which your role in Adiutor Tests now requires',
    );
  });

  it('tells a first password apart from a change, and names providers', () => {
    expect(
      describeOwnActivity(event({ action: 'password_changed', details: { first: true } }), ME),
    ).toBe('Set a password');
    expect(describeOwnActivity(event({ action: 'password_changed' }), ME)).toBe(
      'Changed your password',
    );
    expect(
      describeOwnActivity(
        event({ action: 'provider_connected', details: { providerId: 'github' } }),
        ME,
      ),
    ).toBe('Connected GitHub');
  });

  it('says what a wrong current password was typed for', () => {
    expect(
      describeOwnActivity(
        event({ action: 'password_check_failed', details: { purpose: 'change_password' } }),
        ME,
      ),
    ).toBe('Wrong password entered when changing your password');
    expect(
      describeOwnActivity(
        event({ action: 'password_check_failed', details: { purpose: 'deactivate' } }),
        ME,
      ),
    ).toBe('Wrong password entered when deactivating your account');
    expect(describeOwnActivity(event({ action: 'password_check_failed' }), ME)).toBe(
      'Wrong password entered',
    );
  });

  it('says how the email address was verified', () => {
    expect(
      describeOwnActivity(
        event({ action: 'email_verified', details: { providerId: 'github' } }),
        ME,
      ),
    ).toBe('Verified your email address by signing in with GitHub');
    expect(
      describeOwnActivity(
        event({ action: 'email_verified', details: { providerId: 'google' } }),
        ME,
      ),
    ).toBe('Verified your email address by signing in with Google');
    expect(describeOwnActivity(event({ action: 'email_verified' }), ME)).toBe(
      'Verified your email address',
    );
  });

  it('says who made changes for the user, by name only', () => {
    expect(
      describeOwnActivity(
        event({
          action: 'role_changed',
          company: { name: 'Adiutor Tests' },
          details: { from: 'client', to: 'admin' },
          actor: { id: 'admin-1', name: 'Alex Admin' },
        }),
        ME,
      ),
    ).toBe('Role in Adiutor Tests changed to Admin by Alex Admin');
    expect(
      describeOwnActivity(event({ action: 'mfa_reset', actor: { id: 'admin-1', name: ' ' } }), ME),
    ).toBe('Two-step verification reset by an administrator');
  });

  it('describes staff events without a company', () => {
    expect(
      describeOwnActivity(
        event({
          action: 'role_changed',
          details: { staff: true, from: 'support', to: 'manager' },
          actor: { id: 'admin-1', name: 'Alex Admin' },
        }),
        ME,
      ),
    ).toBe('Staff role changed to Manager by Alex Admin');
    expect(
      describeOwnActivity(event({ action: 'member_joined', details: { staff: true } }), ME),
    ).toBe('Added to staff');
  });

  it('describes accounts and memberships created by staff', () => {
    const admin = { id: 'admin-1', name: 'Alex Admin' };
    expect(describeOwnActivity(event({ action: 'account_created', actor: admin }), ME)).toBe(
      'Account created by Alex Admin',
    );
    expect(
      describeOwnActivity(
        event({
          action: 'member_added',
          company: { name: 'Adiutor Tests Alpha' },
          details: { role: 'client' },
          actor: admin,
        }),
        ME,
      ),
    ).toBe('Added to Adiutor Tests Alpha as Client by Alex Admin');
    expect(
      describeOwnActivity(
        event({ action: 'member_added', details: { staff: true, role: 'manager' }, actor: admin }),
        ME,
      ),
    ).toBe('Added to staff as Manager by Alex Admin');
  });

  it('falls back to the general label', () => {
    expect(describeOwnActivity(event({ action: 'company_updated' }), ME)).toBe(
      'Changed company details',
    );
  });
});
