# 0008. Roles and companies are the app's own data

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

Adiutor uses Better Auth for signing in. Its model of who may do what is specific to Adiutor: staff
roles (Admin, Manager, Finance, Support) on the account, a company role (Admin, Client, Watcher) in
each company, staff who act on every company without being members, and invitations and invite links
for both.

## Decision

Better Auth handles identity only: accounts, sessions, sign-in (password, email links, GitHub,
Google, passkeys) and the second step (authenticator app, email codes, backup codes). Companies,
roles and invitations are the app's own, with the rules in `src/lib/authz` and the services in
`src/server` (see the file comment of `src/lib/auth.ts`).

- The staff role is an extra field on Better Auth's user, `user.platform_role`, which users can't
  set themselves (`additionalFields` in `src/lib/auth.ts`).
- Companies, memberships, invitations and invite links are the app's own tables
  (`src/db/schema/companies.ts`), and the name users see is the single `staff_settings` row.

## Consequences

- Better Auth's tables are generated from its config (`pnpm auth:schema`) and never edited by hand
  (`src/db/schema/auth.ts`). The app's tables are edited in `src/db/schema/` like any other code.
- Joining is the app's own code: invitations by email and invite link, reminders, limits, and the
  re-check of rights inside each change's transaction.
- Where the two meet, the app hooks into Better Auth. Its hooks call `src/server/auth/auth-events/`
  and `src/server/auth/auth-guards/`, and a change that makes a role require MFA ends the user's
  weaker sessions (`withMfaPromotion`).
- Accounts only come from the app's own flows ([0001](0001-invitation-only-sign-up.md)).

Details: [Companies, users and roles](../companies-and-roles.md) and
[Where the code lives](../project-structure.md).

## Alternatives considered

- **Better Auth's organization plugin**, which has organizations, members, roles and invitations of
  its own. It isn't used. These docs record no comparison with it.
