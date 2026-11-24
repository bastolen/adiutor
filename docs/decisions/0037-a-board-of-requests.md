# 0037. A board of requests, with a Move menu on every card

- **Status:** Accepted. One choice is superseded by
  [0043](0043-wider-pages-for-lists-of-requests-and-people.md): a company's board, and its other
  pages, are as wide as the board across companies.
- **Date:** 2026-11-21

## Context

People asked to see requests as a board: a lane per status, with cards that move from one lane to
another. The list ([decision 0019](0019-requests-one-series-plain-text-and-a-history.md)) already
filters, searches and sorts them, and everyone who reads requests should get the board, with the
moves their role allows. Dragging is what a board suggests, but WCAG 2.5.7 (AA) asks for a way to
do the same with a single pointer and no drag, and the keyboard and screen readers need one too.

## Decision

How it works is in [The board](../requests.md#the-board). The choices behind it:

- **Its own route,** `/requests/board`, with a List | Board toggle on both pages that keeps the
  search, the filters and the sort, and one for each company on its page
  (`/companies/<URL name>/board`, next to the company's list, with the same toggle). It shares the
  list's filters and query (`requestListCondition`), so the two never disagree on what someone may
  see.
- **A Move menu on every card is the way to move it** (a Radix menu: keyboard, touch, screen
  readers, and the single-pointer path 2.5.7 asks for). A card without moves has no menu.
- **Dragging is an extra on top of the menu,** for the pointer from tablet width: Pragmatic drag
  and drop (native drag and drop, no React or styles of its own, about 20 KB), loaded with
  `import()` once the page is there, with a grip on each card, lanes that say "Can't move here",
  and our own announcements in three languages. A drop takes the menu's path; a refused one sends
  nothing and says why. It never replaces the menu.
- **Five columns, two with halves:** Open, To do and In progress each have a column; Waiting holds
  Waiting for the company above Waiting for approval, and Closed holds Done above Cancelled. The
  halves stay lanes of their own (a count, cards, "See all", a drop target each), so the service,
  the moves and the counts stay per status, and the board fits a wide screen without hiding a
  status. A drop on a half takes that status; Waiting for approval's half never takes one.
- **No order of their own:** cards sit in each lane in the list's sort. A manual order would need a
  rank column, a migration and a choice between one order for everyone and one per person.
- **Lanes aren't tables,** so they have no pages: an open lane shows the first 25, 50 or 100 cards
  (one size for every lane), Done and Cancelled their latest 5 each by last activity, and a lane that
  holds more links to the list of all of them (`?only=`). Each lane says its true count.
- **A move names where it started** (`from`): a board stays open for long, so a move from one that's
  out of date is refused rather than overwriting a colleague's change, and the board shows the
  card where it is.
- **Done and Cancelled ask first,** since a move emails everyone on the request.
- **As wide as a request's page:** the lanes sit side by side, so on a wide screen the board gets the
  room a request's page gets (`WidePage`) and more lanes show before their row scrolls sideways.
  The rule that a page with a table of records stays at the content's usual width still holds:
  the board's lanes aren't a table. A company's board is the exception: it keeps the width of the
  company's pages, under their header and tabs, so its lanes always scroll from tablet width, with
  the row of buttons that jumps to a lane.

## Consequences

- Moves count against the 300 changes an hour each person may make to requests, which a board makes
  easier to reach in a long triage.
- The tables rule in `CLAUDE.md` has the board as its one exception: no pagination footer, but the
  list's sort.
- Each card carries its `moves`, so the browser never gets permissions; the server checks every
  move again.

## Alternatives considered

- **`?view=board` on `/requests`:** one page, but the status links, pagination and empty states
  would each need a board case, and the page couldn't have its own title.
- **Keyboard dragging from a library** (`@dnd-kit/react`, before 1.0): keyboard equivalence alone
  doesn't meet 2.5.7, so the menu would still be needed, with a second keyboard model to explain
  and test, and its English announcements to replace.
- **Dragging on phones:** a long press to drag fights scrolling the page; the stacked lanes and the
  menu are simpler there.
- **Paging each lane (Show more):** more state in the address for little gain over the list.
