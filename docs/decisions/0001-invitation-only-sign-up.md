# 0001. Invitation-only sign-up

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

Adiutor is a shared service desk. Staff add companies and invite each company's first Admin. Each
company then manages its own users, and staff Admins manage the staff. So access is something people
with the right role give to others.

## Decision

There's no public sign-up. An account is created in one of three ways:

- by accepting an invitation, sent by email or claimed through a single-use invite link;
- by staff registering someone (Add user);
- by first-run setup, for the first staff Admin (`/setup` or `pnpm setup:platform`).

Better Auth's own sign-up is off for email and password, email links, GitHub and Google
(`disableSignUp` in `src/lib/auth.ts`). A GitHub or Google sign-in only reaches an account that
already exists.

## Consequences

- Every account starts with someone who may add people, or with the first run.
- An invite link doesn't create an account by itself. Whoever opens it first enters an email
  address and gets an email invitation there, which proves they own it.
- Automatic linking relies on this. A GitHub or Google sign-in may mark an unverified Adiutor address
  verified, because nobody else can have set up that account in advance (see
  [0002](0002-trusted-provider-email-addresses.md)).
- Until first-run setup is done, `/setup` is open to anyone who can reach the site. Complete it
  right after deploying.

Details: [Accounts](../companies-and-roles.md#accounts), [First run](../companies-and-roles.md#first-run)
and [Invitations](../companies-and-roles.md#invitations).

## Alternatives considered

- **Public sign-up.** Anyone could create an account for an address they control. Automatic linking
  could then no longer assume that nobody set up an account in advance.
