# 0007. Permission checks in services, never the proxy

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

The proxy (Next.js's name for what used to be middleware) runs before every page request, so it's
tempting to check access there. But it only sees whether a session cookie exists. That's fast, but
not secure on its own.

## Decision

- Every permission rule is a pure function in `src/lib/authz`. Permissions come from roles only
  (`src/lib/authz/permissions.ts`). Nobody compares roles inline in pages or components.
- Services in `src/server` check permissions themselves. Each takes an explicit context
  (`ServiceContext`), so it can be tested against a real database.
- Pages and server actions check the session and permissions on the server through
  `src/server/authz.ts` (`getActor()`, `requireCompanyAccess()`).
- For access, the proxy (`src/proxy.ts`) only sends signed-out visitors to the sign-in page. It's
  never the security check.

## Consequences

- Pages are protected by default: only the paths in `PUBLIC_PATHS` are reachable signed out. That's
  a convenience, not the guarantee.
- `src/server/authorization-matrix.int.test.ts` checks every role against every service behind a
  server action, and the page loaders that check roles. New permission-relevant services get a row
  there.
- Changes to people check the actor's rights again inside their transaction (`assertStillManages`
  in `src/server/access.ts`), so someone demoted while their request was under way is refused.
- Someone without the permission gets the 404 page, so a page they may not see isn't named.

Details: [Roles and permissions](../companies-and-roles.md#roles-and-permissions), "Rights checked
when the change is made" under [Staff screens](../companies-and-roles.md#staff-screens), and
[Where the code lives](../project-structure.md).

## Alternatives considered

- **Checking access in the proxy.** It only knows that a session cookie exists: enough to send
  signed-out visitors to sign in, not to decide what anyone may do.
- **Checking only in pages and server actions.** The services couldn't then be tested on their own
  against a real database, as the authorization matrix does.
