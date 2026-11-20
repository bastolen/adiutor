# Requests

Back to the [documentation](README.md).

A request is what a company raises with the staff: a problem, a question or something new. Both
sides work it through in one conversation until it's done or no longer needed. This page says how
requests behave and where the code is; why they're built this way is in
[decision 0019](decisions/0019-requests-one-series-plain-text-and-a-history.md), and for their
text in [decision 0021](decisions/0021-markdown-for-request-text.md).

Not built yet, each for a later change: emails about requests, assigning a request to a staff
member, an approval step, internal staff notes, attachments, types the staff manage themselves,
and working on a request while signed in as a user.

## Words

- **Request:** one thing a company asks. It has a number, a title, a description, a type, a
  priority and a status, and belongs to one company.
- **Reply:** a message in the request's conversation, from either side ("comment" in the database:
  `request_entry.kind`).
- **The staff's side and the company's side:** whoever works on requests as staff acts as the
  staff, everyone else as the company (`requestSide` in `src/lib/requests/rules.ts`). Each reply
  and change remembers its side, so the conversation still says who wrote what after an account
  is deleted.
- **Raise:** to create a request ("raise a request", never "ticket" or "issue" in the screens).

## Who may do what

Four permissions in the request's company (`src/lib/authz/permissions.ts`):

| Permission               | What it allows                                                               | Who has it                                         |
| ------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `requests:view`          | See the company's requests and their conversations                           | Everyone in an active company; every staff role    |
| `requests:contribute`    | Raise requests, reply, mark a request done, cancel it and reopen it          | Company Admin and Client; staff who work on them   |
| `requests:manage`        | Work on requests as the staff: any status, the title, the type, the priority | Staff Admin, Manager and Support                   |
| `requests:view-internal` | See what only the staff see: today the priority                              | Every staff role (Finance reads, but doesn't work) |

- Everyone in a company sees all of the company's requests. A **Watcher** only reads.
- **Finance** reads every company's requests, with the priority, and changes nothing. A staff
  member who can't work on requests but is a Client of a company takes part there as the company.
- A request someone may not see is "not found" to them, like a company they may not see.
- A **deactivated company's** requests can only be read, and only by the staff: its members lose
  access, so its requests are "not found" to them (see
  [Companies and roles](companies-and-roles.md)). For the staff they stay on the company's own
  page and under All, and leave the Active and Waiting lists that cover several companies.
- While a staff member is **signed in as a user**, request pages can be read and every change is
  refused (`assertNotSignedInAs`, see [Signing in as a user](authentication.md#signing-in-as-a-user)).
- The services check all of this themselves (`src/server/requests/`), and every operation has a
  row in `src/server/authorization-matrix.int.test.ts`.

## Statuses

Open → To do → In progress → Waiting for the company → Done, and Cancelled for a request that
isn't needed anymore (`REQUEST_STATUSES` in `src/lib/requests/values.ts`). Done and Cancelled are
the closed statuses.

- **The staff** who work on requests set any status on any request, with the status select on the
  request's page. It saves when a status is picked, never while moving through the list.
- **Company Admins and Clients** have three buttons instead: **Mark as done**, **Cancel request**
  (from any status but Done; it asks first) and **Reopen** (a done or cancelled request). They
  can't set the other statuses (`mayChangeStatus`).
- **A reply from the company** to a request that waits for it puts the request back in progress
  (`statusAfterReply`). No other reply changes the status: a reply to a closed request doesn't
  reopen it.
- **Reopening** from the company's side returns the request to Open. A reopened request shows a
  **Reopened** label, on the list and on its page, until it's done or cancelled again
  (`request.reopened_at`), and the conversation says who reopened it and when.
- The waiting status is worded for its reader, as one message: "Waiting for the company" (the
  staff), "Waiting for your reply" (those at the company who can reply), "Waiting for your
  company" (a Watcher). `requestAudience` decides which, from the reader's permissions in the
  request's company: the services give it with a request's page and with every row of a list
  (`requestAudienceIn` in `src/server/requests/access.ts`), so someone who is a Client of one
  company and a Watcher of another reads each request the same way in both places.
- When two people change a status at the same moment, the second is told the request changed and
  sees the new status, rather than overwriting it (`errors.requests.statusChanged`).

## Types and priorities

- **Types:** Hotfix, Bug, Support and New feature (`REQUEST_TYPES`). They're built in and
  translated, and stored as plain keys, so a later change can turn them into a list the staff
  manage without touching existing requests.
- **Priorities:** Low, Normal and High. A request starts with its type's priority (Hotfix: High;
  Bug and Support: Normal; New feature: Low; `startingPriority`). Only the staff set one, when
  they raise a request for a company or later.
- **Company users never see a priority:** no label, filter, sort or line in the conversation. The
  services leave it out of what they return to anyone without `requests:view-internal`, so no page
  can show it by accident, and a change of priority doesn't count as the request's last activity.
- **Details:** the staff can change a request's title, type and priority (Edit details). Each
  change is a line in the conversation. Descriptions and replies are never edited.
- **Only what its editor changed is saved.** The dialog sends the three details and the values it
  opened with (`was_title`, `was_type`, `was_priority`); `updateRequestDetails` takes a detail as
  changed only when the two differ. A detail the editor left alone keeps what a colleague gave it
  meanwhile (someone who fixes a typo in the title doesn't put back the priority their page still
  showed), and isn't checked against the rules either. A detail the editor did change is saved
  while it's still what they saw. If a colleague changed it to something else, nothing is saved:
  the editor is told the details changed (`errors.requests.detailsChanged`) and the page is
  refreshed, so the dialog starts from the request as it is when it's opened again. If the
  colleague made the same change, there's nothing left to do. The priority a newly picked type
  brings counts as the editor's choice.

## Numbers

- Requests are numbered in **one series** across Adiutor: 1, 2, 3. The number comes from a single
  counter row (`request_counter`), raised inside the transaction that stores the request, so a
  failed attempt uses no number and two requests raised at the same moment get consecutive ones.
- Numbers are shown with a **prefix** the staff Admins choose on the Staff page (`AD` by default:
  `AD-142`; one to five letters or digits, starting with a letter, saved in capitals;
  `staff_settings.request_prefix`).
- A request's address is `/requests/142`, without the prefix, so it doesn't change with it. The
  number as people see it, `/requests/AD-142`, redirects there, and so do the short links
  `/r/142` and `/r/AD-142`. Only the current prefix counts, in any case (`ad-142`): another prefix,
  or anything that isn't a request number, gives the 404 page (`parseRequestReference`,
  `findRequestNumber`). A redirect goes to the number whether or not the request exists or the
  reader may see it, so it reveals nothing: the request's page decides that.
- Searching by number ignores the prefix: "AD-142", "ad-142", an older prefix and "142" all find
  request 142. A number finds every request whose number starts with the digits typed ("AD-1"
  finds 1, 10 to 19, 100 and up), so it narrows the list as it's typed, like a title does
  (`requestNumberStartInSearch` in `src/lib/requests/number.ts`). The list keeps its own order.
- Page titles carry the number, never the request's title ("Request AD-142 · Adiutor"): titles end
  up in the browser's history.

## Text

- Descriptions and replies are **Markdown**: CommonMark with GitHub Flavored Markdown's additions
  (tables, strikethrough, lists of things to do, addresses that link themselves, footnotes), and
  a line break stays a line break. Titles are plain text; they may hold an address, but are never
  linked.
- **Every new text is Markdown, and nobody chooses.** Each text is stored with a format marker
  (`description_format`, `body_format`): `markdown` for every text written since Markdown
  (`WRITTEN_TEXT_FORMAT`, which the services write and the columns default to), `plain` for the
  texts stored before it. A text is never read as a format it wasn't written in.
- **A plain text is shown as it was written:** line breaks are kept, and web addresses (`http://`
  and `https://`) become links. A link ends before the punctuation of the sentence around it
  (`splitLinks` in `src/lib/requests/text.ts`): full stops, commas, question and exclamation
  marks, the ellipsis, the full-width marks of Chinese and Japanese, closing quotation marks (”,
  ’, », ›), and a closing bracket the address didn't open itself. Brackets are counted, so
  `(see https://adiutor.dev/wiki/Printer_(office))` links up to `(office)`.
- Every text is shown through one component (`RequestText` in `src/app/(app)/_requests/`), which
  picks the renderer by the marker. The Markdown one is `MarkdownText` in
  `src/components/ui/markdown/`. It runs on the server only: the browser gets the finished
  elements, never the parser or the highlighter (`src/client-imports.test.ts`).
- **What the writer typed is shown, never run** (see
  [Text people write](security-measures.md#text-people-write)): HTML stays the text it was typed
  as; only whole `http` and `https` addresses become links (`linkTarget`), which open in a new
  tab; and an image is a link to it, named by its description, and is never loaded.
- **Headings** in a text start right below the heading of the card they're in: a text's highest
  heading is an `h3` on a request's page (where cards are `h2`), whether it was written with one
  `#` or three, and the ones below it follow in order. So a text can't break the page's outline or
  skip a level at its start (`highestHeading`).
- **Code:** a block that names its language (three backticks and `ts`, say) is highlighted, under
  the language's name. The languages are highlight.js's common ones plus Dockerfile, nginx,
  PowerShell, Apache, HTTP and properties (`CODE_LANGUAGES`); a language is never guessed, and a
  block in any other language is shown without colours. The colours are the `code-*` tokens (see
  [Design and accessibility](design.md#design-and-accessibility)). A block of code and a table
  scroll sideways when they're wider than the text, can be reached and scrolled with the
  keyboard, and say what they hold.
- **A text that would cost too much to format is shown as plain text** (`markdownTree`): one
  nested more than 100 levels deep (`MAX_NESTING`; React renders a level per call, and the
  parser's own walk overflows the stack at a few thousand), or with more than 2,500 runs of `*`
  or `_` (`MAX_EMPHASIS_RUNS`; the parser's time grows with their number squared).

### Writing a text

A description and a reply are written in a **Markdown field** (`MarkdownField` in
`src/components/ui/markdown/`), which gives the form Markdown under the field's name.

- **It starts as a plain text field,** under the formatting toolbar with its buttons switched off,
  so it works at once and without JavaScript. The page then loads the editor by itself
  (`import()`, about 165 kB gzipped, never with the page's own scripts; an end-to-end test checks
  that), and the editor takes the field's place: what was typed so far is read as Markdown, and
  the cursor stays in the field. If the editor can't load, the plain field stays.
- **The editor shows the text as it will be read,** and Markdown turns into formatting by itself:
  typed (`**bold**`, `# `, `- `, `1. `, `> `, `[ ] `, three backticks and a language), and pasted.
  Text that's inserted in one go without being a paste (dictation) stays as it is.
- **The toolbar** does the same for people who don't type Markdown: bold, italic, strikethrough,
  code, a link (its dialog takes only a whole `http` or `https` address), a heading menu, the
  three kinds of list, nesting and lifting a list item, a quotation and a block of code. A button
  that switches something says whether it's on. After a menu or the dialog, the text has the focus
  again.
- **A block of code** is coloured while it's written, under its language's name, as where it's
  read. The languages are a download of their own (about 40 kB gzipped), fetched the first time a
  text has a block of code. While the cursor is in a block, a menu at the end of the toolbar picks its language; a
  block without one is never coloured.
- **The keyboard:** the toolbar is one stop before the text (arrow keys move between its buttons),
  and Tab and Shift+Tab always leave the text, also in a list or a table, so nobody gets stuck in
  it. A list item nests and lifts with Ctrl or Cmd and `]` or `[`.
- **The editor follows the server's rules** (`editor-extensions.ts`): HTML is text, only whole
  `http` and `https` addresses are links, and an image is kept as it was written and shown by its
  description. It's still never trusted: the server cleans, limits and renders what it sends like
  any other text.
- **What the editor doesn't have:** footnotes (one typed in it is sent as plain text) and a way to
  build a table from scratch (a pasted Markdown table stays a table, with cells to edit).
- **Its size:** a reply's field starts eight lines high and a description's fourteen. It grows
  with its text, and its bottom edge can be dragged to make it taller, as a plain text field's
  can.
- **A text that isn't sent yet stays** while its page is kept alive: the field keeps the Markdown
  and the editor starts from it again. The field is empty after a text was sent, and keeps the
  text after a refused submit. Filling the editor is never a step to undo.

### Cleaning, limits and names

- Text is cleaned before it's stored (`cleanMultilineText`): line endings become `\n`, and hidden
  and control characters are dropped rather than refused. A title has at most 150 characters, a
  description or reply 10,000 (`src/lib/input-rules.ts`).
- People appear **by name only**, never by email address: Clients and Watchers can't see who else
  is in their company. Company users see a staff member's own name with a label that carries the
  name users know the staff by. Someone without a name (or with an old one that has nothing to
  see in it, `visibleName`), or whose account is gone, is shown as their side.
- **For the staff, a name links to the user's page.** The services give a person's ID only to
  readers who may open that page (`users:view`, which every staff role has; `RequestPerson.userId`
  from `requestPerson`), so it never reaches a company user's browser. A side's name is never a
  link.

## Pages

- **`/requests`**, for everyone signed in: every request they may see. The status links (Active,
  Waiting, Closed, All) open on Active; next to them a search on title and number, and menus for
  the company (when there's more than one), the type and, for the staff, the priority
  (`FilterMenu`, a sibling of `SortMenu`). It sorts by last activity or the day it was raised,
  and for the staff by priority, and pages like every table (see
  [Design and accessibility](design.md#design-and-accessibility)).
  A list without requests says why: nothing matches (a search, a filter menu, or the Waiting or
  Closed link), nothing is active, or, under All, which leaves nothing out, there are no requests
  yet. The last two offer "New request" to whoever may raise one.
- **`/companies/<URL name>`**: the same list for one company, the company's first page.
- **`/requests/new`**: the company (only when there's more than one to choose from), a title, a
  type with what each is for, and a description. The staff also choose a priority, or leave it to
  the type. It opens the new request. A company that wasn't chosen is asked for like any other
  field (`requestCompanySchema`); "not found" is for a company the reader may not see.
- **`/requests/<number>`**: what was asked (Description), the Conversation with every reply and
  change, oldest first, and a Details bar: status, type, priority (staff), company, who raised
  it and when, the staff's first response and the last activity, with the controls. The bar is on
  the right on wide screens, and between the description and the conversation on narrower ones.
  On a screen wider than 1280px the page grows past the width other pages have, up to 1280px of
  content (`WidePage`), so the conversation and the reply's editor get the room.
  The conversation loads its latest 50 entries, with a link for earlier ones (`?earlier=`).
- The **menu** has Requests for everyone, and the **dashboard** a Requests tile; see
  [Navigation and dashboard](companies-and-roles.md#navigation-and-dashboard).

## In the code

- `src/lib/requests/` (a folder module, free of zod and server code, so the database schema,
  the services and client components all import it): the values, the rules above, the number
  and the text. Not to be confused with `src/lib/request/`, which is about HTTP requests.
- `src/db/schema/requests.ts`: `request`, `request_entry` (the conversation and the history in one
  table, ordered by ID) and `request_counter`.
- `src/server/requests/` (a folder module): `listRequestCompanies`, `listRequests`, `findRequest`,
  `findRequestNumber`, `getRequest`, `raiseRequest`, `replyToRequest`, `changeRequestStatus`, `updateRequestDetails`.
  Every change refuses someone signed in as a user, checks the permission and that the company is
  active, validates, takes a rate limit (see [Rate limits](security-measures.md#rate-limits)), then
  runs in a transaction that starts with `assertStillMayChange` (`assertStillManages`, then the company) and locks the request's row (see
  [Lock order](security-measures.md#lock-order)). That transaction refuses again when the company
  was deactivated meanwhile, which the staff's rights don't depend on; the company's row isn't
  locked (company rows come first in the lock order), so this narrows the moment in which a change
  can land just after a deactivation, without closing it.
- Times come from the database's clock at the moment something is written (`clock_timestamp()`,
  `CHANGE_MOMENT`), not from the start of its transaction: a reply that waited for another change
  to the same request is timed after it, as the conversation shows it. A new request's two times
  (raised, last activity) are one reading, taken with its number.
- Request work writes **no audit events**: the request's own conversation is the record, and
  nothing in it is a change of sign-in, role or account.
- `src/app/(app)/_requests/`: what the request pages share (the list, the badges, the text, the
  people). `src/app/(app)/requests/`: the pages themselves.
- `src/components/ui/markdown/`: what shows a Markdown text: the pipeline with its limits
  (`tree.ts`), the allow-list (`sanitize.ts`), the elements (`elements.tsx`), the languages of
  highlighted code (`languages.ts`) and the class names (`styles.ts`). And what writes one: the
  field (`markdown-field.tsx`), the toolbar (`formatting-toolbar.tsx`), and the editor's own files
  (`editor*.ts(x)`), which only `import()` reaches.
- Example requests for development and the end-to-end tests come from
  `tests/database/store-requests.ts` (see [Testing](testing.md)). One of them is written in
  Markdown with every kind of formatting (`tests/database/formatted-request.ts`).
