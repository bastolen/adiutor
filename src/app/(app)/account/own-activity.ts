/**
 * @file Describes audit events about a user's own account from their point
 * of view ("Signed in with a passkey", "Staff role changed to Manager
 * by Alex"), for the Recent activity card on their account page, in the
 * reader's language (`account.ownActivity`). Every description is one whole
 * message: the way someone signed in, and who made a change, are choices
 * within it (`select`), never pieces glued on.
 */
import type { useTranslations } from 'next-intl';

import type { AuditAction } from '@/lib/audit-actions';
import type { SignInMethod } from '@/lib/authz/mfa';
import { isRole } from '@/lib/authz/roles';
import { visibleName } from '@/lib/display-name';
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
 * The translations a description needs, from `useTranslations` or
 * `getTranslations` for each namespace.
 */
export interface OwnActivityTranslators {
  /** The `account` namespace, for the descriptions. */
  account: ReturnType<typeof useTranslations<'account'>>;
  /** The `audit` namespace, for actions described the same way everywhere. */
  audit: ReturnType<typeof useTranslations<'audit'>>;
  /** The `roles` namespace, for role names. */
  roles: ReturnType<typeof useTranslations<'roles'>>;
}

/**
 * Who made a change, as the descriptions' `by` choice: the user themself
 * (or no one: a failed sign-in), another account with a name (`other`, with
 * `name`), or one without a name (`admin`: "by an administrator").
 */
interface ByValues {
  /** The choice. */
  by: 'self' | 'admin' | 'other';
  /** The other account's name, for `other`. */
  name: string;
}

/**
 * The sign-in methods the audit log records (`SignInMethod` in
 * `src/lib/authz/mfa/`) that `account.ownActivity.signIn` names with a
 * choice of their own, apart from the OAuth providers (`provider`, named by
 * their label) and `other` (nothing more). A new method that isn't listed
 * here is a compile error, and needs its choice in the message.
 */
const SIGN_IN_METHODS = {
  password: true,
  password_and_authenticator: true,
  password_and_email_code: true,
  backup_code: true,
  passkey: true,
  email_link: true,
  request_link: true,
} as const satisfies Record<Exclude<SignInMethod, OAuthProvider | 'other'>, true>;

/**
 * Says how someone signed in, as the `method` and `provider` of
 * `account.ownActivity.signIn`.
 *
 * @param method - The recorded `method` detail.
 * @returns The values: a provider's label, a known method, or `other` for an
 *   unknown or `other` method.
 */
function signInMethodValues(method: unknown): { method: string; provider: string } {
  if (isOAuthProvider(method)) {
    return { method: 'provider', provider: PROVIDER_LABELS[method] };
  }
  const known = typeof method === 'string' && Object.hasOwn(SIGN_IN_METHODS, method);
  return { method: known ? method : 'other', provider: '' };
}

/**
 * Names a provider for the descriptions' `provider` choice.
 *
 * @param providerId - The recorded provider ID.
 * @returns Its label, or `unknown` (the messages then say "a sign-in provider").
 */
function providerValue(providerId: unknown): string {
  return isOAuthProvider(providerId) ? PROVIDER_LABELS[providerId] : 'unknown';
}

/**
 * Describes the events about memberships (being added, joining, using an
 * invitation while already in and keeping the role they had, being removed,
 * a new role), and the rest with the audit log's own words (e.g. "Added a
 * passkey"). Events about a company that's gone, or with a role that isn't
 * one any more, fall back on those words too.
 *
 * @param entry - The event.
 * @param entry.action - What happened.
 * @param entry.details - Extra facts.
 * @param entry.company - The company it was about.
 * @param by - Who made the change.
 * @param t - Translates the `account` namespace.
 * @param translators - The translations of roles and the audit log's words.
 * @returns The description.
 */
function describeMembership(
  { action, details, company }: Omit<OwnActivityEntry, 'actor'>,
  by: ByValues,
  t: ReturnType<typeof useTranslations<'account'>>,
  translators: OwnActivityTranslators,
): string {
  const onStaff = details.staff === true;
  // Used an invitation or invite link while already in: nothing was given, they kept their role.
  const kept = action === 'member_joined' && details.kept === true;
  const general = translators.audit(kept ? 'events.memberJoinedKept' : `actions.${action}`);
  if (!onStaff && !company) {
    return general;
  }
  const companyName = company?.name ?? '';
  switch (action) {
    case 'member_added': {
      if (!isRole(details.role)) {
        return general;
      }
      const role = translators.roles(`${details.role}.label`);
      return onStaff
        ? t('ownActivity.addedToStaff', { ...by, role })
        : t('ownActivity.addedToCompany', { ...by, role, company: companyName });
    }
    case 'member_joined':
      if (kept) {
        return onStaff
          ? t('ownActivity.keptStaffRole')
          : t('ownActivity.keptCompanyRole', { company: companyName });
      }
      return onStaff
        ? t('ownActivity.joinedStaff')
        : t('ownActivity.joinedCompany', { company: companyName });
    case 'member_removed':
      return onStaff
        ? t('ownActivity.removedFromStaff', { ...by })
        : t('ownActivity.removedFromCompany', { ...by, company: companyName });
    case 'role_changed': {
      if (!isRole(details.to)) {
        return general;
      }
      const role = translators.roles(`${details.to}.label`);
      return onStaff
        ? t('ownActivity.staffRoleChanged', { ...by, role })
        : t('ownActivity.companyRoleChanged', { ...by, role, company: companyName });
    }
    default:
      // The general labels already read well for the rest (e.g. "Added a passkey"); these are
      // only ever done by the user themselves.
      return general;
  }
}

/**
 * Describes an event for the person whose account it is.
 *
 * @param entry - The event.
 * @param entry.action - What happened.
 * @param entry.details - Extra facts.
 * @param entry.company - The company it was about.
 * @param by - Who made the change, for the descriptions that can name them.
 * @param t - Translates the `account` namespace.
 * @param others - The other translations, for the events {@link describeMembership} describes.
 * @returns The description.
 */
function describeAction(
  { action, details, company }: OwnActivityEntry,
  by: ByValues,
  t: ReturnType<typeof useTranslations<'account'>>,
  others: OwnActivityTranslators,
): string {
  // Staff events have no company; they're marked `staff: true` in the details.
  const onStaff = details.staff === true;
  const provider = providerValue(details.providerId);
  switch (action) {
    case 'sign_in':
      return t('ownActivity.signIn', signInMethodValues(details.method));
    case 'sign_in_failed':
      return t('ownActivity.signInFailed');
    case 'sign_in_code_pending':
      // Recorded without an actor: whoever typed the password may not be the user.
      return t('ownActivity.codePending');
    case 'mfa_verified':
      return t('ownActivity.mfaVerified');
    case 'mfa_failed':
      // "Confirm with GitHub" answered with another account than the user's own confirmed one.
      if (details.reason === 'different_account') {
        return t('ownActivity.mfaFailedDifferentAccount', {
          provider: providerValue(details.method),
        });
      }
      // At a password sign-in's code step, recorded without an actor: whoever typed it may not be
      // the user.
      if (details.atSignIn === true) {
        return t('ownActivity.mfaFailedAtSignIn');
      }
      return t('ownActivity.mfaFailedWrongCode');
    case 'password_changed':
      return details.first ? t('ownActivity.passwordSet') : t('ownActivity.passwordChanged');
    case 'password_reset':
      return t('ownActivity.passwordReset');
    case 'password_check_failed':
      // Typed in a signed-in session (`checkCurrentPassword`), for what it was asked for.
      if (details.purpose === 'change_password') {
        return t('ownActivity.passwordCheckChanging');
      }
      if (details.purpose === 'deactivate') {
        return t('ownActivity.passwordCheckDeactivating');
      }
      return t('ownActivity.passwordCheck');
    case 'provider_connected':
      return details.atSignIn
        ? t('ownActivity.providerConnectedAtSignIn', { provider })
        : t('ownActivity.providerConnected', { provider });
    case 'provider_confirmed':
      // Only an account that gave MFA when it was confirmed is a second step (see `givesMfa`).
      return details.givesMfa === true
        ? t('ownActivity.providerConfirmedAsSecondStep', { provider })
        : t('ownActivity.providerConfirmed', { provider });
    case 'provider_disconnected':
      return t('ownActivity.providerDisconnected', { provider });
    case 'email_verified':
      return details.providerId
        ? t('ownActivity.emailVerifiedWithProvider', { provider })
        : t('ownActivity.emailVerified');
    case 'sessions_revoked':
      if (details.others) {
        return t('ownActivity.signedOutOthers');
      }
      // The role now requires MFA (`withMfaPromotion`): only sessions without it ended.
      if (details.mfaRequired) {
        return onStaff || !company
          ? t('ownActivity.signedOutWithoutMfa', { ...by })
          : t('ownActivity.signedOutWithoutMfaInCompany', { ...by, company: company.name });
      }
      // From the command line (`pnpm sessions:revoke-all`): there's no account to name.
      return details.commandLine
        ? t('ownActivity.signedOutByCommandLine')
        : t('ownActivity.signedOutEverywhere', { ...by });
    case 'account_deactivated':
      return t('ownActivity.accountDeactivated', { ...by });
    case 'account_reactivated':
      return t('ownActivity.accountReactivated', { ...by });
    case 'mfa_reset':
      return t('ownActivity.mfaReset', { ...by });
    case 'account_created':
      return t('ownActivity.accountCreated', { ...by });
    // Recorded by the staff member, so `by` names them (or says "a staff member" once they're gone).
    case 'impersonation_started':
      return t('ownActivity.impersonationStarted', { ...by });
    case 'impersonation_ended':
      return t('ownActivity.impersonationEnded', { ...by });
    default:
      return describeMembership({ action, details, company }, by, t, others);
  }
}

/**
 * Describes an event about the user's own account. Changes made by someone
 * else say who did it ("by Alex Admin"), by name only, or "by an
 * administrator" for an account without a name, or with one that has
 * nothing to see in it (`visibleName`).
 *
 * @param entry - The event.
 * @param userId - The user whose account it is.
 * @param translators - The translations, in the reader's language.
 * @returns The description.
 */
export default function describeOwnActivity(
  entry: OwnActivityEntry,
  userId: string,
  translators: OwnActivityTranslators,
): string {
  let by: ByValues = { by: 'self', name: '' };
  if (entry.actor && entry.actor.id !== userId) {
    const name = visibleName(entry.actor.name);
    by = name ? { by: 'other', name } : { by: 'admin', name: '' };
  }
  return describeAction(entry, by, translators.account, translators);
}
