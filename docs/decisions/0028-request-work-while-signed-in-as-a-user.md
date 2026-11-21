# 0028. Request work while signed in as a user

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Staff can sign in as a user to see what that person sees
([decision 0017](0017-staff-sign-in-as-users.md)). 0017 allowed only the user's own work, "which
means requests once they exist", and left requests read-only until working on them as the user
was designed: such work had to record the staff member, for the user and the staff who see the
audit log to know. Until now every request change was refused while signed in as someone, so a
staff member who found what wasn't working couldn't fix it in the user's request.

## Decision

How it works is in [Requests](../requests.md#signed-in-as-a-user) and
[Signing in as a user](../authentication.md#signing-in-as-a-user). The choices behind it:

- **All the user's request work:** whatever that person may do on requests, decided by their
  rights: raising, replying, changing the status, editing their texts, and, signed in as a staff
  member, notes, details and assigning. Managing request types is staff settings and stays off,
  like everything outside requests.
- **The row records the staff member:** the request, the entry or the text version that names the
  user as who did it gets a flag and the staff member's ID. The author stays the user. The flag
  outlives the staff member's account, so the request still says a staff member did it.
- **Told in the request, to two kinds of readers:** next to the change, the user reads "Ann did
  this while signed in as you" and the staff who see the audit log (`audit:view`) read "Ann did
  this while signed in as Pat". Everyone else reads it as Pat's own work. The service leaves the
  mark out for other readers (`maySeeSignedInAsWork`).
- **Rate limits count against the staff member,** who is really acting, so their work never uses
  up the user's allowance.
- **The sign-in is checked again in the change's transaction:** its row is read `FOR SHARE`, so a
  sign-in that ended meanwhile changes nothing.

## Consequences

- This extends 0017; its rules stand. Both people's rights are still checked on every request.
- Every new kind of request work records the staff member with its row (`signedInAsWork`) and
  keys its rate limit on who is acting (`actingUserId`).
- The authorization matrix expects the request changes to work while signed in as someone, with
  the user's outcome.
- A user who turned off sign-ins by staff isn't affected: nobody can sign in as them.

## Alternatives considered

- **An audit event per change:** the request's history is already the record of request work,
  and the start and end of the sign-in are in the audit log and the user's activity.
- **Showing the mark to everyone who reads the request:** colleagues would learn about the user's
  support case, which 0017 keeps between the user and the staff who see the audit log.
- **Only company users' work:** a staff Admin signed in as a Manager couldn't show them how their
  requests behave.
