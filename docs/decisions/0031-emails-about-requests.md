# 0031. Emails about requests: one per person and request, with the whole reply

- **Status:** Accepted; internal notes are emailed to the staff since [0032](0032-internal-notes-email-the-staff.md); its links sign the recipient in since [0035](0035-sign-in-links-in-request-emails.md)
- **Date:** 2026-11-21

## Context

A request has people on it: its assignees and its subscribers
([decision 0025](0025-people-on-a-request-one-table-with-roles.md)). Nothing told them when
something happened. The background jobs were built with this in mind: queued jobs with one batch
key run together ([decision 0018](0018-background-jobs-in-postgres-with-one-tick.md)). A request's
text is something a person wrote, shown under strict rules
([decision 0021](0021-markdown-for-request-text.md)), and a company must never learn what's meant
for the staff, or who a person is beyond their name
([decision 0019](0019-requests-one-series-plain-text-and-a-history.md)).

## Decision

How it works is in [Requests](../requests.md#emails). The choices behind it:

- **The people on a request are told, never whoever did it,** and one place decides who
  (`tellPeopleOnRequest`).
- **A reply and a status change are news for everyone on the request; being put on it is news
  for the one it's about:** assigned, mentioned, or subscribed by someone else. A new request
  emails nobody, and neither does a changed title, type or priority.
- **One email per person and request per tick,** from a job per person and piece of news with a
  shared batch key: the batches' first use.
- **Queued with the change, read when sent.** The job holds IDs. Who still gets the email, the
  names and the text are read at that moment, so someone who left the request or lost access in
  between gets nothing.
- **The whole reply, formatted,** from the tree the page renders and under the same allow-list
  (`EmailMarkdown`).
- **The subject is the request's number and title,** the same every time, so mail apps keep the
  emails about a request together.
- **Off per request, or for all of them:** Unsubscribe on the request, or one account setting,
  "Emails about requests", which also silences the requests assigned to someone. A link in the
  email that unsubscribes without signing in isn't built: it would act for whoever has the email.

## Consequences

- A request's text leaves Adiutor by email, to the people who can read it on its page. An email
  can't be taken back when someone loses access later.
- An email can arrive up to 5 minutes after the change, and twice when a job's work succeeded but
  couldn't be noted (as for every queued email).
- A new kind of event that should email is queued in `tellPeopleOnRequest`, and one only the staff
  may see must be left out for everyone else where the email is read (`readRequestUpdate`).
- The email's elements must stay in step with the page's when the rules for what someone wrote
  change.
- A page's title keeps to the request's number, as before: a browser's history is read by other
  people than a mailbox.

## Alternatives considered

- **An email per event:** three replies in a minute would be three emails.
- **Deciding who is told when the email is sent:** someone subscribed after a reply would be told
  about it, and the writer's own reply would need tracking to leave them out.
- **A shortened, plain-text reply, or none:** safer to build, but the reader has to open Adiutor
  for what the email could have said.
- **Emailing the staff about every new request:** every staff member's inbox for each company's
  request; the list and the dashboard show them.
- **Replying by email:** incoming mail needs an address per request, a mail server that receives,
  and a way to know who wrote.
