# 0042. Wider pages for the lists of requests and people

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

The app's content stops growing at 1280px of screen (944px of content). Only a request and the
board across companies grew further (`WidePage`, up to 1200px), and no page with a table of
records could: tables picked columns that fit 942px and put the rest under the name. A company's
board kept the company's width to line up with its header and tabs
([decision 0037](0037-a-board-of-requests.md)). On screens of 1440 to 1920px that meant lists of
requests that wrapped their titles, statuses and headings, a list of users that stacked companies
and MFA under every name, and a company's board that hid a lane the same board across companies
showed.

## Decision

How it looks is in [Tables](../design.md#tables) ("Widths") and
[Layout and error pages](../design.md#layout-and-error-pages) ("Layout").

- **Wide where the room shows more:** a request, the boards and the lists of requests, and the
  list of users.
- **Sections widen as a whole:** a company's pages (list, board, Members, Settings) and Settings
  (General, Staff, Requests) are wide on every tab, through their layout, so the header and tabs
  never move when the tab changes.
- **Other pages keep the usual width:** the companies list, the logs, a user's pages, the account
  pages, the dashboard and the forms would only gain empty space.
- **More columns from 1536px (`2xl`),** where a wide page always has its full 1200px (1198px for a
  table): what sits under the name may get a column of its own, like a user's companies and MFA,
  or a request's company across companies. Below that, a wide page has the columns every page has.
  Staff and members keep theirs, since their rows are already as tall as the role select.

## Consequences

- A `2xl:` column belongs only in a table on a `WidePage`; on a page of the usual width it would
  overflow. `e2e/tables.spec.ts` checks every table from 640 to 1920px.
- Members' and Settings' forms are wider on a wide screen.

## Alternatives considered

- **Only the Requests tab wide:** the header and tabs would move by up to 128px each time someone
  switched to Members or Settings.
- **A container query per table:** robust to other layouts, but a second way to place columns next
  to the breakpoints every table uses, for no layout that needs it.
- **Every page wide:** short tables, details and forms would only spread out.
- **Keeping a company's board narrow** (0037): its lanes would keep scrolling while the same board
  across companies fits.
