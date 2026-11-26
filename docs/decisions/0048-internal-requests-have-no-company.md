# 0048. Internal requests have no company

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Every request belonged to a company, and the staff aren't one: "the staff" is a name in the
`staff.name` setting. So the staff had nowhere to raise work of their own that no company should
see, and a staff Admin who was also the Admin of the only company couldn't raise one at all: the
form picked that company without asking. A company the staff register for themselves works, but
it's still a company: anyone added to it reads every request in it.

## Decision

How it works is in [Requests](../requests.md#internal-requests). The choices behind it:

- **A request without a company is the staff's.** `request.company_id` is null for an internal
  request. Only the staff's role counts for it (`getInternalRequestPermissions`), never a
  membership, so no invitation, invite link or added member reaches one, and a company user's
  lists, which filter on their companies, can't hold one.
- **For the staff, like a company's request.** Admins, Managers and Support raise and work on
  internal requests; Finance reads them. The same number series and prefix, types, priorities,
  statuses (Waiting for the company and its words too), assignees, subscribers, internal notes and
  emails. Only the staff read its texts, so links to the staff's pages are kept, as in a note.
- **No solutions.** Waiting for approval needs someone at a company to answer, so an internal
  request never gets one.
- **"Internal" where a company would be:** the lists, the board, the request's page, the Company
  filter, the new-request form (offered to the staff even when there's one company) and emails.

## Consequences

- Every query that joins a request with its company is a left join, and every reader of a
  request's company handles none: a missing company counts as active.
- A request's company never changes, so an internal request stays internal.
- Internal requests take numbers from the one series, so the numbers a company sees have gaps
  where internal requests were raised, as they have where other companies' requests were. With
  one company, its people can tell roughly how many internal requests there are, never what
  they're about.
- An internal request's mention keys are made in a scope of their own (`mentionKey` with no
  company), so a key made in a company stands for nobody there.
- Raising a request for someone ([0047](0047-staff-raise-a-request-for-someone.md)) needs a
  company, so it isn't offered for an internal request.

## Alternatives considered

- **A hidden company that stands for the staff:** few changes to requests, but about twenty
  paths (invitations, invite links, adding members, renaming, deactivating, every list of
  companies) need a guard, and one missed shows a company user every internal request.
- **An internal flag beside an optional company:** internal requests about a company, hidden from
  it. More work now; the flag can still come later.
- **A company the staff register themselves:** no code, but its solutions wait for an approval
  nobody can give, and anyone added to it reads everything.
- **A number series of their own:** decision 0019's one series keeps "request 142" unambiguous.
