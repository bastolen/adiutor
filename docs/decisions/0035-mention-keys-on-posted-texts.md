# 0035. A posted mention carries its key for the readers who may write

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

While a text is written, a mention names a person by a key, and only the list at "@" gave keys
([decision 0023](0023-mentions-as-markers-to-rows.md)). So a reply copied from the conversation or
the editor and pasted into a new one lost its mentions: the editor read "@Sam" as text. For the
staff it was worse: a mention links to the person's page, the browser copies that link as a whole
address, and the paste became a link with a user ID in it, in a text the company reads.

## Decision

How it works is in [Requests](../requests.md#mentions). The choices behind it:

- **A mention's element carries the key** (`data-mention-key`), where a text is read and in the
  editor, and the editor reads a pasted mention back from it.
- **Only for readers who may write in the request** (`requests:contribute`, the readers the list
  is for), never in a deactivated company, and never for someone without an account or a name to
  show (`MentionedPerson.key` from `getRequest`).
- **The server still decides:** a pasted key is checked when the text is sent, like a typed one.
- **A mention's element never becomes a link in the editor**, also when it links to a user's page.

## Consequences

- This changes decision 0023 on one point: a key reaches every writer who reads a text that
  mentions someone, not only the people the list offers them. It still says nothing about who
  someone is, means nothing in another company, and a key the writer may not use stays text.
- A mention pasted into another company's request looks like one while it's written, and is text
  once it's sent.

## Alternatives considered

- **Look up a pasted "@Name" in the list at "@":** nothing new reaches the page, but a namesake
  could be mentioned, and emailed, instead.
- **Keep only the editor's own copies:** the smallest change, but copying a posted reply is the
  common case.
