# 0025. The people on a request: one table with roles, and subscribing as a preference

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Emails about requests need to know who to tell. A request had assignees, the staff members who
work on it, and nobody else: the people at the company who raised it or follow it, and the staff
who read along, were on no list. A request shows people by name only, and someone at a company
learns nothing about the staff beyond the names the request shows them
([decision 0019](0019-requests-one-series-plain-text-and-a-history.md),
[decision 0023](0023-mentions-as-markers-to-rows.md)).

## Decision

How it works is in [Requests](../requests.md#subscribing). The choices behind it:

- **One table, `request_participant`, with a role per row:** `assignee` or `subscriber`. Who to
  tell is everyone in it for the request, so a later role is a new value, not a new table.
  Assigning works as before, on the rows with its role.
- **Assigned is for the staff who work on requests; subscribed is for anyone who can read the
  request,** on the staff or at its company. Someone can be both, and is then shown as assigned.
- **Subscribing is a preference, not work on the request.** It leaves no entry in the history and
  doesn't count as activity; assigning keeps both.
- **Raising, replying and being mentioned subscribe.** Unsubscribing holds until the next reply
  or mention.
- **Everyone changes their own subscription,** the staff who work on requests anyone's, and a
  company's Admins, who manage its members, their colleagues' (`subscriberScope`).
- **Someone at a company sees the subscribers from their company,** never which staff members
  follow along.
- **A subscription ends with the access,** and only counts while its person can read the request
  (`loadSubscribers`).

## Consequences

- Every query on the table names the role; the unique index is per request, person and role.
- **This changes decision 0019 on one more point:** everyone at a company, Watchers too, sees the
  names of the colleagues subscribed to a request, also of one who never wrote in it. Names only,
  never an ID or an address.
- Whatever tells the people on a request something takes the subscribers from `loadSubscribers`,
  so someone who lost access is never told.
- The history doesn't say who subscribed whom, or when.

## Alternatives considered

- **A second table for subscribers:** two lists to bring together for every "who to tell", and a
  third with the next role.
- **One row per person with a flag for each role:** unassigning a subscriber or unsubscribing an
  assignee would need rules for which flags keep the row.
- **Only the automatic subscribers, with nothing to change:** a Watcher, who never writes, could
  never follow a request, and nobody could stop following one.
- **A history entry per subscription:** a line for every first reply and every mention would bury
  the conversation.
- **Showing the company which staff members follow:** it would show a company staff members the
  request never showed them, which decision 0023 keeps out of the list at "@" too.
