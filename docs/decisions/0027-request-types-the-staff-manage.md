# 0027. Request types the staff manage

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Request types were a fixed list in code, translated in the catalogues
([decision 0019](0019-requests-one-series-plain-text-and-a-history.md)). The staff couldn't add a
type that fits their work, rename one or retire one. 0019 stored types as plain keys, so that a
later list could take them over without touching existing requests.

## Decision

How it works is in [Requests](../requests.md#types-and-priorities). The choices behind it:

- **Types are rows** (`request_type`) that staff Admins manage on the Staff page: a name, what it's
  for, a starting priority and an order.
- **One text for every language,** like the staff name. The staff write in the language they work
  in. Setup names the four built-in types in its own language.
- **A key that never changes:** requests, their history and links to the list hold it, and
  `request.type` points at it with a foreign key. Existing requests keep theirs.
- **Archived, never deleted:** an archived type isn't offered any more, but its requests, history
  and filter keep it. The last active type can't be archived.
- **In the audit log:** types are a setting every company sees, like the staff name. Reordering
  isn't recorded: it changes no request.

## Consequences

- This replaces 0019's built-in types. The rest of 0019 stands.
- Pages take types and their names from the services, never from a list in code.
- A type's starting priority is data now: a change applies to requests raised from then on.
- Company users read a type's name in the staff's language.

## Alternatives considered

- **A name per language:** forms with three of each field, and a rule for missing ones.
- **Deleting unused types:** a key could come back with another meaning in old links.
- **Moving a type's requests when it's removed:** a history entry on every request, for a change
  nobody asked for.
