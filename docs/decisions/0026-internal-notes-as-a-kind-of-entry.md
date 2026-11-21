# 0026. Internal notes: a kind of entry only the staff read

- **Status:** Accepted; notes are emailed to the staff since [0032](0032-internal-notes-email-the-staff.md)
- **Date:** 2026-11-20

## Context

The staff had nowhere on a request to write what the company shouldn't read. A request's
conversation and history are one table, and what only the staff see is a permission the services
filter on ([decision 0019](0019-requests-one-series-plain-text-and-a-history.md)). Company users
see the request's last activity, and the lists sort by it.

## Decision

How it works is in [Requests](../requests.md#internal-notes). The choices behind it:

- **A note is a kind of entry, `note`,** not a flag on a reply. Queries of replies already name
  their kind, so a note stays out of them unless asked for.
- **One list says what only the staff see** (`STAFF_ONLY_ENTRY_KINDS`: a change of priority and a
  note), and every query of entries for a company reader filters with it. A company user can't
  tell that a note exists.
- **The staff who work on requests write notes; every staff role reads them,** Finance included.
- **A note changes nothing the company sees:** not the status, the first response or the last
  activity.
- **A note can mention anyone,** so the staff can say who it's about, but someone at the company
  is never shown it, subscribed by it or told about it.
- **Edited like a reply** ([decision 0024](0024-edit-replies-and-descriptions.md)), and written on
  a tab of its own with its own draft, so it isn't sent to the company by mistake.

## Consequences

- A new kind of entry only the staff may see goes in `STAFF_ONLY_ENTRY_KINDS`. Anything that tells
  people about a request must leave notes out for company users.
- The staff's lists don't move for a note either: there's one last activity.

## Alternatives considered

- **A flag on replies:** every query of replies would have to remember it, and forgetting it leaks
  the note.
- **A table of its own:** notes would need their own mentions, versions and order next to the
  conversation.
- **A last activity for the staff:** the two sides' lists would sort differently, for a second
  column to keep right.
- **Mentions of the staff only:** safer for later emails, but the staff couldn't say whom at the
  company a note is about.
