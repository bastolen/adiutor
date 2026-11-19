/**
 * @file Tests for describing a user's own activity.
 */
import { describe, expect, it } from 'vitest';

import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { OAUTH_PROVIDERS, PROVIDER_LABELS } from '@/lib/sign-in/oauth-providers';

import describeOwnActivity, { type OwnActivityEntry } from './own-activity';

/** The user whose account it is. */
const ME = 'user-1';

/**
 * The translations a description needs, in a language.
 *
 * @param locale - The language.
 * @returns The translators.
 */
const translatorsIn = (locale: Locale) => ({
  account: translator(locale, 'account'),
  audit: translator(locale, 'audit'),
  roles: translator(locale, 'roles'),
});

/**
 * Describes an event in English (US).
 *
 * @param entry - The event.
 * @param userId - The user whose account it is.
 * @returns The description.
 */
const describeInEnglish = (entry: OwnActivityEntry, userId: string) =>
  describeOwnActivity(entry, userId, translatorsIn('en-US'));

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
      describeInEnglish(event({ action: 'sign_in', details: { method: 'passkey' } }), ME),
    ).toBe('Signed in with a passkey');
    expect(describeInEnglish(event({ action: 'sign_in', details: { method: 'other' } }), ME)).toBe(
      'Signed in',
    );
  });

  it('says a password sign-in asked for a code, without counting it as signed in', () => {
    expect(
      describeInEnglish(
        event({ action: 'sign_in_code_pending', actor: null, details: { method: 'password' } }),
        ME,
      ),
    ).toBe('Entered your password; the sign-in then asked for your code');
  });

  it('calls a confirmed sign-in MFA verified', () => {
    expect(describeInEnglish(event({ action: 'mfa_verified' }), ME)).toBe(
      'Verified a sign-in with MFA',
    );
  });

  it('describes failed attempts without anyone to blame', () => {
    expect(describeInEnglish(event({ action: 'sign_in_failed', actor: null }), ME)).toBe(
      'Failed sign-in attempt with a wrong password',
    );
  });

  it('tells a wrong code from "Confirm with GitHub" with a different account', () => {
    expect(
      describeInEnglish(event({ action: 'mfa_failed', details: { method: 'email_code' } }), ME),
    ).toBe('Failed MFA confirmation with a wrong code');
    expect(
      describeInEnglish(
        event({ action: 'mfa_failed', details: { method: 'github', reason: 'different_account' } }),
        ME,
      ),
    ).toBe('Failed MFA confirmation with a different GitHub account');
    // A provider that was since removed.
    expect(
      describeInEnglish(
        event({ action: 'mfa_failed', details: { method: 'gitlab', reason: 'different_account' } }),
        ME,
      ),
    ).toBe('Failed MFA confirmation with a different account');
  });

  it('tells a wrong code at sign-in from one on the step-up page', () => {
    expect(
      describeInEnglish(
        event({
          action: 'mfa_failed',
          details: { method: 'authenticator', atSignIn: true },
          actor: null,
        }),
        ME,
      ),
    ).toBe('Wrong two-step verification code entered at sign-in');
    expect(
      describeInEnglish(event({ action: 'mfa_failed', details: { method: 'authenticator' } }), ME),
    ).toBe('Failed MFA confirmation with a wrong code');
  });

  it('calls a confirmed account a second step only when it gave MFA', () => {
    expect(
      describeInEnglish(
        event({ action: 'provider_confirmed', details: { providerId: 'github', givesMfa: true } }),
        ME,
      ),
    ).toBe('Confirmed GitHub as a second step');
    // GitHub without two-factor authentication, or an event from before `givesMfa` was recorded.
    expect(
      describeInEnglish(
        event({ action: 'provider_confirmed', details: { providerId: 'github', givesMfa: false } }),
        ME,
      ),
    ).toBe('Confirmed GitHub');
    expect(
      describeInEnglish(
        event({ action: 'provider_confirmed', details: { providerId: 'github' } }),
        ME,
      ),
    ).toBe('Confirmed GitHub');
    expect(
      describeInEnglish(
        event({ action: 'provider_confirmed', details: { providerId: 'google', givesMfa: false } }),
        ME,
      ),
    ).toBe('Confirmed Google');
  });

  it.each(OAUTH_PROVIDERS)('names a sign-in with %s', (providerId) => {
    expect(
      describeInEnglish(event({ action: 'sign_in', details: { method: providerId } }), ME),
    ).toBe(`Signed in with ${PROVIDER_LABELS[providerId]}`);
  });

  it('says who signed the user out', () => {
    expect(
      describeInEnglish(event({ action: 'sessions_revoked', details: { others: true } }), ME),
    ).toBe('Signed out your other devices');
    expect(
      describeInEnglish(
        event({ action: 'sessions_revoked', actor: null, details: { commandLine: true } }),
        ME,
      ),
    ).toBe('Signed out everywhere by an administrator');
    expect(
      describeInEnglish(
        event({ action: 'sessions_revoked', actor: null, details: { mfaRequired: true } }),
        ME,
      ),
    ).toBe(
      'Signed out where you hadn’t confirmed with an authenticator app, a passkey or a provider with two-factor authentication, which your role now requires',
    );
    expect(
      describeInEnglish(
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
      describeInEnglish(event({ action: 'password_changed', details: { first: true } }), ME),
    ).toBe('Set a password');
    expect(describeInEnglish(event({ action: 'password_changed' }), ME)).toBe(
      'Changed your password',
    );
    expect(
      describeInEnglish(
        event({ action: 'provider_connected', details: { providerId: 'github' } }),
        ME,
      ),
    ).toBe('Connected GitHub');
  });

  it('says what a wrong current password was typed for', () => {
    expect(
      describeInEnglish(
        event({ action: 'password_check_failed', details: { purpose: 'change_password' } }),
        ME,
      ),
    ).toBe('Wrong password entered when changing your password');
    expect(
      describeInEnglish(
        event({ action: 'password_check_failed', details: { purpose: 'deactivate' } }),
        ME,
      ),
    ).toBe('Wrong password entered when deactivating your account');
    expect(describeInEnglish(event({ action: 'password_check_failed' }), ME)).toBe(
      'Wrong password entered',
    );
  });

  it('says how the email address was verified', () => {
    expect(
      describeInEnglish(event({ action: 'email_verified', details: { providerId: 'github' } }), ME),
    ).toBe('Verified your email address by signing in with GitHub');
    expect(
      describeInEnglish(event({ action: 'email_verified', details: { providerId: 'google' } }), ME),
    ).toBe('Verified your email address by signing in with Google');
    expect(describeInEnglish(event({ action: 'email_verified' }), ME)).toBe(
      'Verified your email address',
    );
  });

  it('says who made changes for the user, by name only', () => {
    expect(
      describeInEnglish(
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
      describeInEnglish(event({ action: 'mfa_reset', actor: { id: 'admin-1', name: ' ' } }), ME),
    ).toBe('Two-step verification reset by an administrator');
    // An old name of only a zero-width space shows nothing either.
    expect(
      describeInEnglish(
        event({ action: 'mfa_reset', actor: { id: 'admin-1', name: '\u{200B}' } }),
        ME,
      ),
    ).toBe('Two-step verification reset by an administrator');
  });

  it('describes staff events without a company', () => {
    expect(
      describeInEnglish(
        event({
          action: 'role_changed',
          details: { staff: true, from: 'support', to: 'manager' },
          actor: { id: 'admin-1', name: 'Alex Admin' },
        }),
        ME,
      ),
    ).toBe('Staff role changed to Manager by Alex Admin');
    expect(
      describeInEnglish(event({ action: 'member_joined', details: { staff: true } }), ME),
    ).toBe('Added to staff');
  });

  it('says that an invitation used while already in gave nothing: the role was kept', () => {
    expect(
      describeInEnglish(
        event({
          action: 'member_joined',
          company: { name: 'Adiutor Tests' },
          details: { role: 'client', kept: true, invited: 'admin', via: 'invite_link' },
        }),
        ME,
      ),
    ).toBe('Used an invitation to Adiutor Tests and kept the role you had');
    expect(
      describeInEnglish(
        event({
          action: 'member_joined',
          details: { staff: true, role: 'support', kept: true, invited: 'platform_admin' },
        }),
        ME,
      ),
    ).toBe('Used an invitation to the staff and kept the role you had');
    // A company that's gone since: the audit log's words, which don't say "joined" either.
    expect(
      describeInEnglish(
        event({ action: 'member_joined', details: { role: 'client', kept: true } }),
        ME,
      ),
    ).toBe('Used an invitation and kept the role they had');
    // Joining for real reads as before.
    expect(
      describeInEnglish(
        event({
          action: 'member_joined',
          company: { name: 'Adiutor Tests' },
          details: { role: 'client' },
        }),
        ME,
      ),
    ).toBe('Joined Adiutor Tests');
  });

  it('describes accounts and memberships created by staff', () => {
    const admin = { id: 'admin-1', name: 'Alex Admin' };
    expect(describeInEnglish(event({ action: 'account_created', actor: admin }), ME)).toBe(
      'Account created by Alex Admin',
    );
    expect(
      describeInEnglish(
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
      describeInEnglish(
        event({ action: 'member_added', details: { staff: true, role: 'manager' }, actor: admin }),
        ME,
      ),
    ).toBe('Added to staff as Manager by Alex Admin');
  });

  it('names the staff member who signed in as the user', () => {
    const staff = { id: 'staff-1', name: 'Sam Lee' };
    expect(describeInEnglish(event({ action: 'impersonation_started', actor: staff }), ME)).toBe(
      'Sam Lee, a staff member, signed in as you',
    );
    expect(
      describeInEnglish(
        event({ action: 'impersonation_ended', actor: staff, details: { reason: 'expired' } }),
        ME,
      ),
    ).toBe('Sam Lee is no longer signed in as you');
    // A staff member whose account is gone, or has no name.
    expect(describeInEnglish(event({ action: 'impersonation_started', actor: null }), ME)).toBe(
      'A staff member signed in as you',
    );
    expect(
      describeInEnglish(
        event({ action: 'impersonation_started', actor: { id: 'staff-1', name: ' ' } }),
        ME,
      ),
    ).toBe('A staff member signed in as you');
  });

  it('falls back to the general label', () => {
    expect(describeInEnglish(event({ action: 'company_updated' }), ME)).toBe(
      'Changed company details',
    );
  });

  it.each([
    [
      'nl-NL',
      'Alex Admin heeft je rol bij Adiutor Tests gewijzigd in Beheerder',
      'Een beheerder heeft je verificatie in twee stappen gereset',
      'Ingelogd met GitHub',
    ],
    [
      'es-ES',
      'Alex Admin cambió tu rol en Adiutor Tests a Administrador',
      'Un administrador restableció tu verificación en dos pasos',
      'Sesión iniciada con GitHub',
    ],
  ] as const)(
    'says in %s who made a change where the language puts it',
    (locale, roleChanged, mfaReset, signedIn) => {
      const translators = translatorsIn(locale);
      expect(
        describeOwnActivity(
          event({
            action: 'role_changed',
            details: { to: 'admin' },
            company: { name: 'Adiutor Tests' },
            actor: { id: 'admin-1', name: 'Alex Admin' },
          }),
          ME,
          translators,
        ),
      ).toBe(roleChanged);
      expect(
        describeOwnActivity(
          event({ action: 'mfa_reset', actor: { id: 'admin-1', name: ' ' } }),
          ME,
          translators,
        ),
      ).toBe(mfaReset);
      expect(
        describeOwnActivity(
          event({ action: 'sign_in', details: { method: 'github' } }),
          ME,
          translators,
        ),
      ).toBe(signedIn);
    },
  );

  it('falls back on the audit log’s words for a role or a company it can’t name', () => {
    expect(
      describeInEnglish(event({ action: 'member_added', details: { role: 'emperor' } }), ME),
    ).toBe('Added a member');
    expect(
      describeInEnglish(event({ action: 'role_changed', details: { staff: true, to: 'x' } }), ME),
    ).toBe('Changed a role');
  });
});
