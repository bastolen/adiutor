# 0003. Who needs MFA, and what counts

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

MFA (multi-factor authentication) means a second sign-in step, such as a code from an authenticator
app. Adiutor offers several, and they aren't equally strong. Email codes go to the
same inbox as email links and password resets. GitHub can tell the app that an account has
two-factor authentication; Google can't.

## Decision

- **Who:** staff Admins and Managers, and the Admin of an active company (`requiresMfa`, from the
  user's MFA role, `mfaRoleOf`; never the staff role alone). They're the roles that can invite and
  manage other people. Everyone else gets a recommendation on the dashboard.
- **What counts for them:** an authenticator app, a passkey, or no password with every connected
  provider account having MFA itself. Only providers that can prove it count (`MFA_PROVIDERS`:
  GitHub). Email codes and trusted devices don't.
- **For everyone:** email codes stop working once an authenticator app is set up, so the inbox
  alone can't get past the app.
- **When:** whether a session counts is decided when it's read, with the user's role at that moment
  (`isSessionMfaVerified`), never from `session.mfa_verified` alone.
- **Where:** only `src/lib/authz/mfa/` decides these rules.

## Consequences

- Until an account meets the requirement, every app page sends the user to the Security page
  (`getActor()`).
- A promotion takes effect in existing sessions, and ends the ones without a strong factor
  (`withMfaPromotion`).
- Changes that would take required MFA away are refused (`wouldRemoveRequiredMfa`).
- Provider MFA only counts while that provider's sign-in is configured on the server (see
  [Before sharing the address](../deploying.md#before-sharing-the-address)).

Details: [Who requires MFA](../mfa.md#who-requires-mfa) and
[Every session counts](../mfa.md#every-session-counts).

## Alternatives considered

- **Email codes for every role.** Whoever controls the inbox would get past the second step.
- **Deciding from the staff role alone.** That misses company Admins, and whether their company is
  active.
- **Trusting what was stored at sign-in.** A promotion or a deactivated company wouldn't reach
  sessions that already exist.
