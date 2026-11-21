# 0032. Internal notes email the staff

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

An internal note is what the staff write for each other on a request, which nobody at the company
reads ([decision 0026](0026-internal-notes-as-a-kind-of-entry.md)). Emails about requests tell
the people on a request what happens to it
([decision 0031](0031-emails-about-requests.md)), but a note emailed nobody: a colleague a note
mentioned, or the staff member it was assigned to, only saw it on the request's page.

## Decision

How it works is in [Requests](../requests.md#emails). The choices behind it:

- **The staff on the request, and the staff a note mentions:** a note goes to its assignees, its
  subscribers who read notes (`requests:view-internal`), and the staff it mentions, also when an
  edit adds the mention. Never to whoever wrote it.
- **Never anyone at the company:** a note mentioning someone at the company tells them nothing,
  like it never subscribes them. It's decided twice, so no mistake in one place lets a note
  through: when the news is queued (`tellStaffOnRequest`, `staffWhoReadNotes`), and when the email
  is read (`readRequestUpdate` builds a note item only for a reader with
  `requests:view-internal`).
- **In the same email as the rest:** a note shares the batch key of the request's other news, so
  a note and a reply from the same few minutes are one email per person.
- **The whole note, marked as one:** it's shown in full like a reply, with a line saying only the
  staff see it.

## Consequences

- This extends 0026 and 0031; their rules stand.
- A new kind of staff-only news must be filtered where the email is read, as 0031 asked; notes now
  show how.

## Alternatives considered

- **Telling everyone on the request and filtering only when the email is read:** one check
  instead of two, but a job queued for someone at the company would already hold that a note
  exists.
- **A separate email for notes:** more emails for the same few minutes, which the batching is
  there to avoid.
