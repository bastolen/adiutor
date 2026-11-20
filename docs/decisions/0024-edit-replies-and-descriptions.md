# 0024. Edit replies and descriptions, with earlier versions for the staff

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

[Decision 0019](0019-requests-one-series-plain-text-and-a-history.md) made a request's description
and replies final once sent, so the conversation stayed a faithful record. In practice a typo, a
missing detail or a pasted password then stays there for good. The record still matters: the
staff need to see what a text said before it was changed. [Decision
0023](0023-mentions-as-markers-to-rows.md) stores a text's mentions as rows that belong to the
text, so an edit has to keep those right too.

## Decision

How it works is in [Requests](../requests.md#editing-a-text). The choices behind it:

- **Who edits what:** a reply only by its author; the description by the staff who work on requests
  and by anyone at the company who takes part (not a Watcher); the title stays the staff's. Only
  while the request is open (`mayEditDescription`, `mayEditReply`).
- **Every edit keeps the text it replaced** as a `request_text_version`, which only the staff read.
  Everyone sees that a text was edited, and when. A version keeps its mentions as plain "@Name"
  text, since the mention rows belong to the text as it is.
- **Versions aren't conversation entries.** An edit changes a text that's already in the
  conversation; a line for it would push the conversation around and tell the company more than
  "Edited".
- **No edit overwrites one its editor didn't see:** the editor sends how many times the text was
  edited when they started, and an edit made meanwhile is refused.
- **An edit doesn't move the request's last activity:** it corrects what's there.

## Consequences

- This replaces the "never edited" rule of 0019. The rest of 0019 stands.
- Editing goes only through `editRequestDescription` and `editReply`, like every change through
  `changeRequest`.
- A mention in an edited text is stored afresh, with what the editor may mention: someone they may
  not mention stays as text.
- Removing something from the record for good (a password the company pasted) still needs the
  database: the earlier version keeps it, for the staff.

## Alternatives considered

- **Keep texts final:** safest for the record, but people can't fix their own mistakes.
- **Edits as conversation entries:** visible to the company, and noisy.
- **No earlier versions:** simpler, and good for removing a pasted secret, but the staff would lose
  what a text said, which the record needs.
