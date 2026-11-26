# 0047. Staff raise a request for someone at a company

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

People at a company often ask by phone or by email, and a staff member then raises the request.
Until now that request said the staff member raised it: the person who asked wasn't on it, didn't
follow it, wasn't told, and the request counted as the staff's own, without a first response. A
staff member could sign in as the person and raise it there
([decision 0028](0028-request-work-while-signed-in-as-a-user.md)), but that's a sign-in to do this
one task, and its mark is hidden from the person's colleagues.

## Decision

How it works is in [Requests](../requests.md#raising-a-request-for-someone). The choices behind
it:

- **The person who asked raised it.** The request names them as who raised it, on the company's
  side (`created_by`, `created_by_side`), as if they had raised it themselves. It counts as the
  company's request, with a first response timed from when it was raised.
- **The staff member is kept, and shown to everyone.** A flag and the staff member's ID
  (`created_on_behalf`, `created_on_behalf_by`) record who raised it for them. The flag outlives
  the account. Everyone who reads the request reads "Ann raised this for Pat": unlike the mark of
  0028, there's nothing to keep from the person's colleagues.
- **Only someone who could raise it themselves.** The staff who work on requests (`requests:manage`)
  pick an active Admin or Client of the company, by name. A Watcher can't raise a request, and
  someone whose own request would be the staff's isn't the company's. The form names people by
  their key (`mentionKey`), never a user ID, and the service checks them again in the raising
  transaction, with their account and their membership locked.
- **Both follow it, and the person is told.** The person and the staff member are subscribed. The
  person gets an email that the request was raised for them, with its description: this extends
  [decision 0031](0031-emails-about-requests.md), where a new request emails nobody but the people
  it mentions.

## Consequences

- Who raised a request is no longer always who pressed the button: the person who did the work is
  `created_on_behalf_by` when it's set, `created_by` otherwise. A sign-in mark on raising
  (decision 0028) names that person.
- Rate limits count against the staff member, who is acting (`actingUserId`).
- The request's description is credited to the person who asked, with the note saying who wrote
  it for them.

## Alternatives considered

- **The staff member raises it, with the person as a second field:** the person couldn't follow it
  as theirs, lists and emails would need a second "who asked", and the request would stay the
  staff's, without a first response.
- **Signing in as the person (decision 0028):** a sign-in for each phone call, with a mark only the
  person and the staff who see the audit log read.
- **Watchers too:** they follow requests without raising them, so a request "raised" by one would
  give them a request they couldn't reply to.
