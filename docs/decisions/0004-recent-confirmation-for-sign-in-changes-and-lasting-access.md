# 0004. Recent confirmation for sign-in changes and lasting access

- **Status:** Accepted; a session from a link in an email about a request never counts as confirmed or fresh ([0036](0036-sign-in-links-in-request-emails.md))
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

A session lasts up to 7 days ([0005](0005-fixed-seven-day-sessions.md)). Someone who steals one
must not be able to leave a way in that outlasts it. A new passkey, a connected GitHub account or a
new Admin account would survive signing the victim out, changing their password and resetting their
MFA.

## Decision

Two kinds of change need a confirmation with your second step from the last 15 minutes
(`mfaConfirmedUntil`), made on the step-up page (`/auth/verify`):

- **A new way in to your own account:** adding or removing passkeys, provider accounts, two-step
  verification, backup codes or a first password.
- **A lasting way in for someone else:** any staff role (or a higher one) and a company's Admin
  role, by invitation, invite link, role change, adding a member or registering a company
  (`grantNeedsConfirmation` in `src/lib/authz/guards.ts`).

This applies once your account has a second step that can confirm sessions (`canConfirmSessions`).
Without one, the same changes need a sign-in from the last hour (`needsFreshSignIn`). A trusted
device doesn't count, and neither does GitHub next to a passkey or an authenticator app: GitHub only
says the account has two-factor authentication, not that this sign-in used it.

## Consequences

- It's enforced at Better Auth's endpoints (`src/server/auth/auth-guards/`), in the services
  (`assertConfirmedForGrant`, `needsRecentConfirmation`) and in the forms, which send you to the
  step-up page before you type anything and back to the card you started from.
- Stepping down, removing someone, and the Client and Watcher roles need nothing.
- Every new staff Admin is emailed to the other staff Admins, so an unexpected one gets noticed.

Details: [Changing sign-in methods needs a recent confirmation](../mfa.md#changing-sign-in-methods-needs-a-recent-confirmation)
and [Invitations](../companies-and-roles.md#invitations).

## Alternatives considered

- **Better Auth's own `freshAge` check.** It's off: a step-up with a code doesn't renew it.
- **Confirming only changes to your own sign-in methods.** An account a stolen session creates for
  itself would still outlast signing the victim out.
