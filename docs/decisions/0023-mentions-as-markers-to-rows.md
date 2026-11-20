# 0023. Mentions: a marker in the text that points at a row, and a list by what the writer may know

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

People want to name each other in a request's description and replies. Markdown has no syntax for
a person ([decision 0021](0021-markdown-for-request-text.md) left that open), and a request shows
people by name only: a person's ID goes to the staff alone, and a Client or Watcher couldn't see
who else is in their company ([decision 0019](0019-requests-one-series-plain-text-and-a-history.md)).
A text is stored once and never edited, while names change and accounts are deleted.

## Decision

How it works is in [Requests](../requests.md#mentions). The choices behind it:

- **A mention is a link whose address names the mention, not a place:** `[@Sam](mention:…)`. It
  needs no new syntax in the parser or the editor, and read by anything that doesn't know mentions
  it's the text "@Sam".
- **The stored text points at a row, and holds no name and no user ID.** Each mention is a row in
  `request_mention`, and the marker holds that row's ID. Who is mentioned, and what they're called
  by now, is looked up when the text is read, like every name in a request. A text only resolves
  its own rows.
- **While a text is written, a person is a key.** The browser gets a keyed hash of the person and
  the company (`mentionKey`), which the server makes again and compares when the text is sent. So
  no user ID reaches someone at a company, and a key means nothing in another company.
- **The list at "@" follows what the writer may know.** The staff can mention everyone at the
  request's company and every staff member who reads requests. Someone at the company can mention
  their colleagues and the staff members the request already shows them.
- **A mention is a highlight.** Nobody is told yet; that comes with emails about requests.

## Consequences

- **This changes decision 0019 on one point:** a Company Admin or Client who writes a text now
  sees the names of everyone in their company in that list. Names only, never an address, and
  nothing about the staff they haven't seen.
- The marker of someone the writer may not mention stays in the text as it was typed, and shows as
  its link's text. Nothing is refused, so a text is never lost over a mention.
- The `mention` scheme is allowed through the allow-list, but the link's element never links to
  it: it shows the person, or the link's text.
- Changing `BETTER_AUTH_SECRET` changes the keys. Stored texts don't hold keys, so only a text
  that's still being written loses its mentions, which then show as text.
- Emails and a "mentions you" filter can read `request_mention` later.

## Alternatives considered

- **The person's user ID in the stored text:** every path that shows a text as it was written (the
  plain-text fallback, a later email, an edit) would then have to hide it from a company user.
- **The person's name in the stored text:** it would outlive a rename, and a deleted account.
- **A syntax of its own (`@[…]`, `<@…>`):** a second parser extension on the server and in the
  editor, to keep in step, for something a link already carries.
- **User IDs in the list for someone at a company:** an ID says when an account was made, and the
  rule that IDs go to the staff alone would have its first exception.
- **Everyone who can read the request in every list:** the most useful list, but it shows a
  company the whole staff.
- **Only people already in the request:** nothing new is shown to anyone, but only the staff could
  bring a colleague in.
