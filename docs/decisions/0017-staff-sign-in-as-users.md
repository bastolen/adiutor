# 0017. Staff can sign in as users

- **Status:** Accepted; request work while signed in as a user is designed in [0028](0028-request-work-while-signed-in-as-a-user.md)
- **Date:** 2026-11-11

## Context

To find out why something isn't working for someone, staff need to see Adiutor the way that user
sees it. Using someone else's account is the most access the app gives anyone. So it has to be
short, visible and recorded, and it must not leave a way into the account behind.

## Decision

- **Who, as whom:**
  - staff Admins → anyone except staff Admins;
  - Managers → company users;
  - Support → company users who aren't an Admin in any company, so they gain no rights to manage
    members;
  - Finance and company Admins can't sign in as anyone (`mayImpersonate` in
    `src/lib/authz/impersonation.ts`);
  - users can turn it off for their own account.
- **Starting:** needs strong MFA on the staff member's own account, and a confirmation with it from
  the last 15 minutes, whatever their role (`hasStrongMfa`, `strongMfaConfirmedUntil`; see
  [0004](0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md)).
- **How:** the staff member keeps their own session. For 30 minutes, the app marks it as signed in
  as the user and loads that user as the actor. Better Auth never creates a session for the user.
- **What's allowed:** only the user's own work, which means requests once they exist. Every
  service and Better Auth endpoint refuses changes to sign-in methods, devices, the account, roles,
  memberships, invitations, the profile, companies and staff settings. The user's account pages are
  read-only. Their devices and IP addresses show only to the roles that see them on the user's page.
- **Seen and recorded:**
  - a banner on every page;
  - the start and end in the audit log and in the user's activity;
  - a security email to the user;
  - an optional reason, for staff only;
  - work done this way records the staff member, which only staff with `audit:view` and the user
    see.

## Consequences

- Every service that changes something refuses an actor who is signed in as someone else, unless
  the change is the user's own work. Such work records the staff member.
- Both people's rights are checked again on every request, so a demotion, a deactivation or the
  user turning it off ends it straight away.
- New request features decide whether they're the user's work, and if so record who acted.

Details: [Signing in as a user](../authentication.md#signing-in-as-a-user).

## Alternatives considered

- **Better Auth's admin plugin.** It adds roles, ban fields and endpoints of its own (against
  [0008](0008-roles-and-companies-are-the-apps-own-data.md)). It also records a real sign-in for the
  user, and gives them a session that would face their own step-up page.
- **A real session for the user.** Better Auth's endpoints would then act on the user's account,
  and the session would show among their devices.
- **Full access in the user's name.** The staff member could add ways in, and act without the
  user's second step.
