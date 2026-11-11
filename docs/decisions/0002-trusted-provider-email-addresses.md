# 0002. Trusted provider email addresses

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

Staff register people (Add user) and invite them by email. Many of them already have a GitHub or
Google account with that address. They should be able to sign in with it without setting anything
up first.

## Decision

When you sign in with a GitHub or Google account that isn't connected yet, Adiutor connects it to
the account with the same address, if the provider says it verified that address. An Adiutor
address that wasn't verified yet is then marked verified.

The provider's word is trusted for exactly that: finding the account and marking its address
verified. It's never trusted for anything about an account that's already connected.

## Consequences

"Verified" only means that someone verified the address at the provider once. Neither GitHub nor
Google checks it again. So someone who no longer has the inbox can still sign in: a former employee
with their work address on a personal GitHub account, or a shared address such as
`support@adiutor.dev` that changed hands. For an account without a second step, that's the whole
account. What limits it:

- The owner is told. The next page names the connected account with a link to disconnect it, and a
  security email goes to the address.
- On an account that has a second step, the new connection stays unconfirmed until the owner
  confirms it, so it can't get past that step (`account.confirmed`, set by `beforeAccountCreate` in
  `src/server/auth/auth-events/provider-accounts.ts`).
- An Admin's MFA reset disconnects every GitHub and Google account of the user.
- A deactivated account gets nothing connected.

This depends on [0001](0001-invitation-only-sign-up.md): without public sign-up, nobody else can
have set up the account in advance.

Details: [Automatic linking](../authentication.md#automatic-linking).

## Alternatives considered

- **Connecting providers only from the Security page, while signed in.** That way exists too. On its
  own, it would make every registered or invited person set up another sign-in first.
