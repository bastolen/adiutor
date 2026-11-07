# 0005. Fixed seven-day sessions

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

Better Auth can extend a session while it's used, at most once a day, whenever the session is read.
Adiutor's pages read the session while Server Components render, and Server Components can't set
cookies. So the session's database row would be extended while the browser's cookie still expired 7
days after the sign-in. The user would be signed out, and the row would stay behind as another
signed-in device on the Security page.

## Decision

A session lasts a fixed 7 days from the sign-in and isn't extended while it's used
(`disableSessionRefresh` and `SESSION_LIFETIME_SECONDS` in `src/lib/auth.ts`).

When Better Auth replaces a session for the same sign-in (for example when you change your password
and sign out your other devices), the new session keeps the old one's sign-in time and end
(`beforeSessionCreate` in `src/server/auth/auth-events/session-hooks.ts`). So a replacement never
renews a session, or makes it pass for a recent sign-in.

## Consequences

- Everyone signs in again 7 days after their last sign-in, however active they are.
- A stolen session works for 7 days at most. The recent-confirmation rule builds on that
  ([0004](0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md)).
- Don't turn session refresh back on without also refreshing the cookie where cookies can be set:
  a Route Handler, a server action or the proxy. Otherwise the row outlives the cookie again.

Details: [Sessions](../authentication.md#sessions).

## Alternatives considered

- **Better Auth's sliding sessions.** Rejected for the reason above: the row and the cookie would
  drift apart.
- **Refreshing the cookie in a Route Handler, server action or the proxy.** That's the condition for
  turning refresh back on, but it isn't built.
