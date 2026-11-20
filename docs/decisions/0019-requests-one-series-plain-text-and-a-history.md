# 0019. Requests: one number series, plain text and a history in one table

- **Status:** Accepted; its rule that texts are final is replaced by [0024](0024-edit-replies-and-descriptions.md)
- **Date:** 2026-11-13

## Context

Requests are what Adiutor is for: a company raises one, and both sides work it through. The first
version had to be small enough to finish, and shaped so that what comes next (emails, assigning,
approval, internal notes, attachments, Markdown, managed types) adds to it instead of rebuilding
it. Company users must never see what's meant for the staff, and Clients and Watchers can't see
who else is in their company.

## Decision

How requests work is in [Requests](../requests.md). The choices behind it:

- **One number series, with a display prefix.** A counter row gives the number inside the
  transaction that stores the request. The prefix (`AD-142`) is a staff setting and display only:
  addresses and searches use the number.
- **Built-in types that set the priority**, which only the staff change and only the staff see:
  the services leave it out for anyone without `requests:view-internal`.
- **Plain text with a format marker**, shown by one component.
- **The conversation and the history are one table** (`request_entry`), in order, each entry
  with who did it and on which side.
- **Four permissions**, so taking part, working on a request as staff and seeing staff-only
  things can be given apart.
- **Names, never addresses.** No audit events: the request's history is the record. Every change
  is refused while signed in as a user ([decision 0017](0017-staff-sign-in-as-users.md)).

## Consequences

- Every new request takes the counter row's lock, briefly and last (see
  [Lock order](../security-measures.md#lock-order)).
- A new kind of event is a new kind of entry. What only the staff may see is filtered in the
  service, like the priority.
- Markdown later is a second format with its renderer; managed types are a table for the keys
  requests already hold. Stored requests stay as they are.
- A new prefix renames every number at once; old numbers still find their request.

## Alternatives considered

- **A sequence, or a series per company:** the schema allows no sequences, and a failed insert
  would skip a number; per company, "request 12" is ambiguous for staff who work across companies.
- **Priority chosen by the company:** every request becomes urgent.
- **Markdown from the start:** a sanitising renderer and an editor before anyone had replied.
- **Separate tables for replies and changes:** two lists to merge for every page, and no order
  between entries made in the same moment.
- **Audit events for request work:** it would drown the log of access and accounts.
