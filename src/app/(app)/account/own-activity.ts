/**
 * @file Describes audit events about a user's own account from their point
 * of view ("Signed in with a passkey", "Staff role changed to Manager
 * by Alex"), for the Recent activity card on their account page.
 */
import { AUDIT_ACTION_LABELS, type AuditAction } from '@/lib/audit-actions';
import type { SignInMethod } from '@/lib/authz/mfa';
import { isRole, ROLE_LABELS } from '@/lib/authz/roles';
import {
  isOAuthProvider,
  type OAuthProvider,
  PROVIDER_LABELS,
} from '@/lib/sign-in/oauth-providers';

/** The parts of an audit event the description uses. */
export interface OwnActivityEntry {
  /** What happened. */
  action: AuditAction;
  /** Extra facts, e.g. `{ method: 'passkey' }`. */
  details: Record<string, unknown>;
  /** The company it was about, if any. */
  company: { name: string } | null;
  /** Who did it, if known. */
  actor: { id: string; name: string } | null;
}

/**
 * How each sign-in method the audit log records (`SignInMethod` in
 * `src/lib/authz/mfa/`) is mentioned after "Signed in", apart from the
 * OAuth providers (named by their label) and `other` (nothing more). A new
 * method that isn't listed here is a compile error.
 */
const SIGN_IN_METHODS = {
  password: 'with a password',
  password_and_authenticator: 'with a password and an authenticator code',
  password_and_email_code: 'with a password and an email code',
  backup_code: 'with a backup code',
  passkey: 'with a passkey',
  email_link: 'with an email link',
} as const satisfies Record<Exclude<SignInMethod, OAuthProvider | 'other'>, string>;

/**
 * Words how someone signed in, after "Signed in".
 *
 * @param method - The recorded `method` detail.
 * @returns E.g. "with a passkey" or "with GitHub", or `null` for an unknown or `other` method.
 */
function signInMethodLabel(method: unknown): string | null {
  if (isOAuthProvider(method)) {
    return `with ${PROVIDER_LABELS[method]}`;
  }
  return typeof method === 'string' && Object.hasOwn(SIGN_IN_METHODS, method)
    ? SIGN_IN_METHODS[method as keyof typeof SIGN_IN_METHODS]
    : null;
}

/**
 * Describes an event for the person whose account it is, without who did it.
 *
 * @param entry - The event.
 * @param entry.action - What happened.
 * @param entry.details - Extra facts.
 * @param entry.company - The company it was about.
 * @returns The description.
 */
function describeAction({ action, details, company }: OwnActivityEntry): string {
  // Staff events have no company; they're marked `staff: true` in the details.
  const onStaff = details.staff === true;
  const companyName = company?.name ?? 'a company';
  const provider = isOAuthProvider(details.providerId)
    ? PROVIDER_LABELS[details.providerId]
    : 'a sign-in provider';
  switch (action) {
    case 'sign_in':
      return ['Signed in', signInMethodLabel(details.method)].filter(Boolean).join(' ');
    case 'sign_in_failed':
      return 'Failed sign-in attempt with a wrong password';
    case 'sign_in_code_pending':
      // Recorded without an actor: whoever typed the password may not be the user.
      return 'Entered your password; the sign-in then asked for your code';
    case 'mfa_verified':
      return 'Verified a sign-in with MFA';
    case 'mfa_failed':
      // "Confirm with GitHub" answered with another account than the user's own confirmed one.
      if (details.reason === 'different_account') {
        return isOAuthProvider(details.method)
          ? `Failed MFA confirmation with a different ${PROVIDER_LABELS[details.method]} account`
          : 'Failed MFA confirmation with a different account';
      }
      // At a password sign-in's code step, recorded without an actor: whoever typed it may not be
      // the user.
      if (details.atSignIn === true) {
        return 'Wrong two-step verification code entered at sign-in';
      }
      return 'Failed MFA confirmation with a wrong code';
    case 'password_changed':
      return details.first ? 'Set a password' : 'Changed your password';
    case 'password_reset':
      return 'Reset your password with an email link';
    case 'password_check_failed':
      // Typed in a signed-in session (`checkCurrentPassword`), for what it was asked for.
      if (details.purpose === 'change_password') {
        return 'Wrong password entered when changing your password';
      }
      if (details.purpose === 'deactivate') {
        return 'Wrong password entered when deactivating your account';
      }
      return 'Wrong password entered';
    case 'provider_connected':
      return details.atSignIn
        ? `Connected ${provider} by signing in with it`
        : `Connected ${provider}`;
    case 'provider_confirmed':
      // Only an account that gave MFA when it was confirmed is a second step (see `givesMfa`).
      return details.givesMfa === true
        ? `Confirmed ${provider} as a second step`
        : `Confirmed ${provider}`;
    case 'provider_disconnected':
      return `Disconnected ${provider}`;
    case 'email_verified':
      return details.providerId
        ? `Verified your email address by signing in with ${provider}`
        : 'Verified your email address';
    case 'sessions_revoked':
      if (details.others) {
        return 'Signed out your other devices';
      }
      // The role now requires MFA (`withMfaPromotion`): only sessions without it ended.
      if (details.mfaRequired) {
        return onStaff || !company
          ? 'Signed out where you hadn’t confirmed with an authenticator app, a passkey or a provider with two-factor authentication, which your role now requires'
          : `Signed out where you hadn’t confirmed with an authenticator app, a passkey or a provider with two-factor authentication, which your role in ${companyName} now requires`;
      }
      // From the command line (`pnpm sessions:revoke-all`): there's no account to name.
      return details.commandLine
        ? 'Signed out everywhere by an administrator'
        : 'Signed out everywhere';
    case 'account_deactivated':
      return 'Account deactivated';
    case 'account_reactivated':
      return 'Account reactivated';
    case 'mfa_reset':
      return 'Two-step verification reset';
    case 'account_created':
      return 'Account created';
    case 'member_added': {
      const role = isRole(details.role) ? ROLE_LABELS[details.role] : 'a member';
      return onStaff ? `Added to staff as ${role}` : `Added to ${companyName} as ${role}`;
    }
    case 'member_joined':
      return onStaff ? 'Added to staff' : `Joined ${companyName}`;
    case 'member_removed':
      return onStaff ? 'Removed from staff' : `Removed from ${companyName}`;
    case 'role_changed': {
      const role = isRole(details.to) ? ROLE_LABELS[details.to] : 'a new role';
      return onStaff
        ? `Staff role changed to ${role}`
        : `Role in ${companyName} changed to ${role}`;
    }
    default:
      // The general labels already read well for the rest (e.g. "Added a passkey").
      return AUDIT_ACTION_LABELS[action];
  }
}

/**
 * Describes an event about the user's own account. Changes made by someone
 * else end with who did it ("by Alex Admin"), by name only.
 *
 * @param entry - The event.
 * @param userId - The user whose account it is.
 * @returns The description.
 */
export default function describeOwnActivity(entry: OwnActivityEntry, userId: string): string {
  const text = describeAction(entry);
  if (!entry.actor || entry.actor.id === userId) {
    return text;
  }
  return `${text} by ${entry.actor.name.trim() || 'an administrator'}`;
}
