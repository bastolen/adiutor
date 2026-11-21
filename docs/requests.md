# Requests

Back to the [documentation](README.md).

A request is what a company raises with the staff: a problem, a question or something new. Both
sides work it through in one conversation until it's done or no longer needed. This page says how
requests behave and where the code is; why they're built this way is in
[decision 0019](decisions/0019-requests-one-series-plain-text-and-a-history.md), for their
text in [decision 0021](decisions/0021-markdown-for-request-text.md), and for the people on a
request in [decision 0025](decisions/0025-people-on-a-request-one-table-with-roles.md).

Not built yet, each for a later change: emails about requests (to the people on one, its
assignees and subscribers, and to the people a text mentions),
an approval step, internal staff notes, attachments, types the staff manage themselves, and
working on a request while signed in as a user.

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
- **Assignee:** a staff member assigned to a request, one of the people who work on it. A request
  can have several, or none (see [Assigning](#assigning)).
- **Subscriber:** someone who follows a request: anyone on the staff or at its company who can
  read it (see [Subscribing](#subscribing)). The assignees and the subscribers are the people on
  a request, who an email about it will reach.

## Who may do what

Four permissions in the request's company (`src/lib/authz/permissions.ts`):

| Permission               | What it allows                                                                                                  | Who has it                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `requests:view`          | See the company's requests and their conversations                                                              | Everyone in an active company; every staff role    |
| `requests:contribute`    | Raise requests, reply, mark a request done, cancel it and reopen it, edit the description and their own replies | Company Admin and Client; staff who work on them   |
| `requests:manage`        | Work on requests as the staff: any status, the title, the type, the priority, who's assigned                    | Staff Admin, Manager and Support                   |
| `requests:view-internal` | See what only the staff see: today the priority                                                                 | Every staff role (Finance reads, but doesn't work) |

- Everyone in a company sees all of the company's requests. A **Watcher** only reads.
- **Finance** reads every company's requests, with the priority, and changes nothing. A staff
  member who can't work on requests but is a Client of a company takes part there as the company.
- **Subscribing** takes no more than reading: everyone who sees a request subscribes and
  unsubscribes themselves. Other people's subscriptions are for the staff who work on requests
  (`requests:manage`: anyone's) and for a company's Admins (`members:manage`: their colleagues');
  see [Subscribing](#subscribing).
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
  change is a line in the conversation. The description and replies are edited by their own
  rules (see [Editing a text](#editing-a-text)).
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

## Assigning

- **Who can be assigned:** the staff who work on requests: Admins, Managers and Support
  (`mayBeAssigned` in `src/lib/requests/rules.ts`, which takes their staff permissions in
  companies). Finance reads requests but works on none, and a company's own people take part as
  the company, so neither can be assigned. A request can have several assignees, or none; they're
  the rows of `request_participant` with the role `assignee`.
- **Who assigns:** any staff member who works on requests assigns a request to any of them,
  themselves included, and removes any of them. On a request's page, the Details have an
  **Assigned to** row with every assignee, one per line with their avatar, and under it two buttons: **Assign to me**
  (while the viewer isn't one of them) and **Change assignees**, a dialog with a checkbox for each
  staff member who can be assigned, the viewer first and the current assignees ticked.
- **Everyone on the request sees who's assigned,** the company too: by name, without the staff
  label the staff's replies have, since only staff are assigned. A name links to the user's page for the staff only (see
  [Cleaning, limits and names](#cleaning-limits-and-names)).
- **Each person is a change of their own** (`changeAssignees` in
  `src/server/requests/assignees.ts`): someone already on the request isn't added again, someone
  already off it isn't removed again, and what a colleague did meanwhile about anyone else stays.
  The dialog sends who's ticked and who was assigned when it opened, and the action adds and
  removes only what its editor changed, so nothing is refused because the request changed.
- **Whoever is added is checked as they are by then:** their user row is locked with the actor's
  (`FOR SHARE`, in one statement, in ID order) and must be an active account whose staff role works
  on requests, or the change is refused (`errors.requests.notAssignable`). So a role change, a
  deactivation or a deletion takes turns with being assigned (see
  [Lock order](security-measures.md#lock-order)).
- **The history:** every person assigned or removed is an entry (`request_entry.kind` `assignee`):
  "Assigned Sam Support to this request.", "Assigned themselves to this request.", "Removed Sam
  Support from this request.", "Removed themselves from this request." Whether they were assigned or
  removed is the entry's new value (`ASSIGNMENT_CHANGES`); who it's about is `subject_user_id`,
  which is cleared when their account is deleted, so the history then says "a staff member" and
  keeps no ID of a deleted account. The company sees these entries, so they count as the request's
  last activity. Assigning never changes the status.
- **Someone who stops working on requests is taken off theirs** (`unassignFrom`): a staff role
  without request work or none (`setStaffRole`), a deactivation (`deactivate`, which both kinds of
  deactivation use) or a deletion (`deleteUser`, before the account goes). Each request gets an
  entry by nobody in particular, shown as the staff. Reactivating the account doesn't put them back.
- **Finding your own:** the staff's request lists have an **Assignee** filter (Me for those who can
  be assigned, Not assigned, or one staff member: `assignee=me`, `none` or a user ID) and an
  **Assigned to** column with an avatar per person (`PeopleAvatars`), each showing the name on
  hover; the avatars sit in a copy of the row's link that the keyboard and screen readers skip,
  so a click opens the request and screen readers read the names as text, and the staff who can be assigned get an **Assigned to you** tile on the
  dashboard with how many active requests are assigned to them (`countAssignedRequests`).

## Subscribing

Someone subscribed to a request follows it. Nothing is sent yet: a request's assignees and
subscribers are who emails about it will reach. Why it's built this way is in
[decision 0025](decisions/0025-people-on-a-request-one-table-with-roles.md).

- **One table for the people on a request:** `request_participant` has a row per person and role
  (`REQUEST_PARTICIPANT_ROLES`: `assignee` or `subscriber`). Someone can be both. An assignee gets
  updates as an assignee, so a request lists them once, as that.
- **Who can be subscribed:** an active account that can read the request: a staff member (Finance
  too, who read requests without working on them) or someone at the request's company (Watchers
  too, who follow without taking part).
- **Who changes it** (`subscriberScope` in `src/lib/requests/rules.ts`): everyone subscribes and
  unsubscribes themselves (`subscribe` and `unsubscribe` in `src/server/requests/subscribers.ts`).
  The staff who work on requests do so for anyone who can be subscribed, and a company's Admins
  for their colleagues (`changeSubscribers`, each person a change of their own, like assigning). A
  company's Admin can't subscribe a staff member, and a staff member they ask to take off is left
  alone without a word, so they learn nothing about which staff members follow a request.
  `listSubscribable` lists who the actor can subscribe, each by name and by their key in the
  request's company (`mentionKey`, the key a mention uses), and `changeSubscribers` takes those
  keys: no user ID reaches a company's browser. It leaves out the people the request is assigned
  to, who follow it as that.
- **On a request's page,** the Details have a **Subscribers** row under Assigned to, kept small:
  the avatars of the subscribers the reader may see, at most four, then a block that says how
  many more there are ("+3"). Each avatar shows its name on hover, and the row is one button that
  opens everyone's names in a small panel (`Popover`), by name only: nothing labels who is on the
  staff. Under it is **Subscribe** or **Unsubscribe**: one button that stays where it is, so the
  keyboard keeps its place when its text changes. Someone the request is assigned to gets no such
  button. Whoever changes other people's subscriptions also gets **Change subscribers**, a dialog
  with a checkbox per person, the subscribers ticked: the people at the company in one group and,
  for the staff, the staff in another. Like the assignees' dialog it saves only what its editor
  changed. A deactivated company's request has neither button.
- **Automatically** (`subscribeAutomatically`, in the transaction of the change): whoever raises a
  request, replies to it or is mentioned in it is subscribed. Someone who unsubscribes stays
  unsubscribed until they reply or are mentioned again. Editing a text subscribes the people it
  mentions newly, not the ones it mentioned already.
- **Who sees the subscribers** (`getRequest`): the staff see everyone, each on their side. Someone
  at the company sees the subscribers from their own company, by name and without an ID, and
  never which staff members follow along; someone on the staff who is also in the company is a
  colleague to them. Every reader is told whether they're subscribed themselves.
- **Not work on the request:** subscribing leaves no entry in the history and doesn't count as the
  request's last activity. It's still a change like the others: refused while a staff member is
  signed in as the user and in a deactivated company, and counted against the limit on changes
  to requests.
- **Losing access ends it** (`unsubscribeFrom`, in the transaction of the change, after it): being
  removed from the company (`changeMembership`), a change of staff role or leaving the staff
  (`setStaffRole`), and a deactivation (`deactivate`) take the person off the requests they can no
  longer read; a staff role that still reads requests keeps them, and so does a company they're
  in. A deleted account takes its rows with it. A company's deactivation ends nothing: nothing
  happens in its requests meanwhile, and its members get their access back with it.
- **Only who can read the request counts** (`loadSubscribers`): a subscriber is someone who can
  read the request by now. A row left behind when someone loses access at the very moment they're
  subscribed is never shown, and whatever tells subscribers something later must take them from
  there too.
- **The requests there were** got their subscribers from migration `0015_request_participants`:
  whoever raised them, replied to them or was mentioned in them, as far as they still read them.

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
- **Copying code:** a block of code has a "Copy code" button next to its language (`CopyButton`),
  before the code in the tab order. It copies the code as it was written, without the line break at
  its end, so a pasted command doesn't run by itself. Above the code it puts a note of where the
  code is from, so it can be traced once it sits in a file: the request's address, then who wrote
  the text and on which day (`TextSource`, in the reader's language, with the name the page shows
  next to the text). The note is a comment in the block's language (`withCodeNote` in
  `code-note.ts`: `#`, `//`, `--`, `;`, `'`, `;;`, `/* */` or `<!-- -->`, also for a language
  written by an alias). A note must never break what's pasted, so the code is copied alone where
  a comment can't go or could end up shown: JSON, plain text, a block without a language or in one
  we don't highlight, Markdown, a diff, an HTTP message, PHP, and a shell or Python session. Lines
  that have to stay first (a `#!` line, an XML declaration, a doctype, a Dockerfile's directives)
  keep their place, with the note below them. A new language in `CODE_LANGUAGES` gets its choice in
  `COMMENT_SIGNS`. Selecting code by hand copies it without a note, and a block has no button while
  it's written.
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
- **A large view:** the toolbar's last button ("Large view", a toggle that says whether it's on)
  opens the editor in a dialog over the page, named by the field's label: up to 60rem wide and
  nearly as tall as the window, the whole screen on a phone (`Modal`'s `large` size). It's the same
  editor, shown there instead of in the field, so the text, the cursor and what can be undone stay
  as they were, both ways. The button again, Escape, the close button or a click outside brings it
  back, and the text has the focus when the view opens and when it closes, as after the toolbar's
  menus. The field keeps its place and height on the page meanwhile, so nothing moves, and what
  the field says about a text that's too long shows in the view too. It's only for writing: the
  form is sent from the page. The dialog is taken away in the same step as the field takes the
  text back; closed by itself it would let go of the text a step too late.
- **The keyboard:** the toolbar is one stop before the text (arrow keys move between its buttons),
  and Tab and Shift+Tab always leave the text, also in a list or a table, so nobody gets stuck in
  it. A list item nests and lifts with Ctrl or Cmd and `]` or `[`.
- **Mentions:** typing "@" opens a list of the people the text can mention; see
  [Mentions](#mentions).
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

### Editing a text

Why it works this way is in [decision 0024](decisions/0024-edit-replies-and-descriptions.md).

- **Who edits what:** a reply only by the person who wrote it; the description by the staff who
  work on requests and by anyone at the company who takes part (an Admin or Client, not a
  Watcher). The title stays the staff's (Edit details). Only while the request is open: a done or
  cancelled request's texts stay as they are (`mayEditDescription`, `mayEditReply` in
  `src/lib/requests/rules.ts`).
- **On the page:** a pencil button next to a text its reader may edit ("Edit description", "Edit
  reply") swaps the text for the Markdown field holding it (`EditableText`), with Save and Cancel.
  Both put the text back and focus on the button again; a refused save keeps the field open with
  what was typed. The field starts from the text with its mentions as ones that are being written
  (`editableText` in `src/server/requests/edits.ts`), so they're kept, and stored afresh on save.
- **"Edited":** an edited text says so after its time, with when on hover
  (`request.description_edited_at`, `request_entry.edited_at`). For the staff it's a button that
  opens **Earlier versions**: every text the edits replaced, newest first, with who changed it and
  when (`request_text_version`, given to readers with `requests:view-internal` only; their
  mentions are plain "@Name" text). Nobody at the company sees them.
- **No edit is lost:** the editor sends how many times the text was edited when they started; an
  edit made meanwhile is refused (`errors.requests.textChanged`) and the page shows the text as it
  is. An unchanged text saves nothing.
- **Not activity:** an edit doesn't move the request's last activity, and it adds nothing to the
  conversation.
- **In the code:** `editRequestDescription` and `editReply`, through `changeRequest` like every
  change: refused while signed in as a user, for a deactivated company, past the rate limit of
  request changes, and for a closed request (`errors.requests.closedNoEdit`).

### Mentions

A description or a reply can mention people. Why it's built this way is in
[decision 0023](decisions/0023-mentions-as-markers-to-rows.md).

- **A mention is a marker that looks like a link** (`src/lib/requests/mentions.ts`). While a text
  is written it's `[@Sam](mention:KEY)`: the person's name, and a key of 22 characters that
  stands for them. Once the text is stored it's `[@](mention:ID)`, where the ID is the mention's
  row in `request_mention` (the request, the reply or `null` for the description, the person, and
  the side they were on). The stored text holds no name and no user ID.
- **The key** (`mentionKey`) is a keyed hash of the person and the company, made from
  `BETTER_AUTH_SECRET` through a secret of its own. It's the same every time, means nothing in
  another company, and can't be turned back into a person: when a text is sent, the server makes
  the keys of the people who may be mentioned again and compares. So no user ID reaches someone
  at a company.
- **Who may be mentioned** (`listMentionable`, for whoever may write there:
  `requests:contribute`): the staff can mention everyone at the request's company and every staff
  member who reads requests; someone at the company can mention their colleagues, and the staff
  members whose names the request already shows them (who raised it, replied, changed it, is or
  was assigned; not who only changed the priority, which they don't see). For a request that isn't
  raised yet, someone at the company gets their colleagues only. Never the writer themselves, a
  deactivated account, or someone without a name to show; someone on the staff who is also in the
  company is listed once. The list gives a key, a name and whether they're staff, by name.
- **Storing** (`storeMentions`, in the transaction of `raiseRequest` and `replyToRequest`, right
  after the text's row): the markers of people the writer may mention there become rows, one per
  person however often the text names them, and the text's markers are pointed at them. At most
  20 people per text (`MAX_MENTIONS_PER_TEXT`). Every other marker stays as it was typed (another
  company's key, a key nobody has, a marker typed with a row's ID): nothing is refused.
- **Reading** (`getRequest`): each text comes with the people it mentions, by the ID its markers
  name, as the reader may see them (`requestPerson`: a name, their side, whether it's the reader,
  and an ID for the staff only). A text gets its own mentions only, so a marker with another
  text's row names nobody. Someone whose account is gone stays mentioned, by their side.
- **Showing** (`RequestText`, which hands `MarkdownText` its `mentions`): a mention is the
  person's name after an "@", as the page names them (their own name, or their side's), with a
  line around it and in a heavier weight, so it's set apart by more than a colour, also in
  forced-colours mode. A mention of the reader has the line and the name in the colour of
  highlights. For the staff the name links to the user's page; a side's name never does. The
  marker reaches the link's element through the allow-list's `mention` scheme, and that element
  shows the person, or, for a marker that isn't one of the text's, the link's text: it never
  links to such an address. A text shown as it was written, because formatting it would cost too
  much, names the people too (`nameStoredMentions`).
- **Writing** (`MarkdownField`'s `mentions`, a function that gives the people; the request forms
  pass one that calls `mentionChoicesAction`, a server action that only reads): typing "@" at the
  start of a line or after a space opens a list of people at the cursor, so an email address
  opens nothing, and neither does an "@" in code. The people are asked for the first time the list
  opens, and again only when the form's company changes. What's typed after the "@" narrows the
  list, without regard for case or accents and with spaces, to at most eight people: names that
  start with it first. Once what's typed has a space and is nobody's name, the list closes by
  itself ("meet @ 5 pm"); one word that's nobody's name says "Nobody by that name". The arrow
  keys move through the list, around at the ends, Enter or a click mentions the person, and
  Escape or a click elsewhere closes it and leaves what was typed as text. Tab leaves the text, as
  always, and the list closes.
- **The list never has the focus** (`editor-mentions.tsx`): it stays in the text, which says it
  has a list (`aria-haspopup`) and points at the option the keys are on
  (`aria-activedescendant`). The list is a Radix popover placed at the cursor, without a dialog's
  role, and a layer of its own: in the editor's large view, Escape closes the list first and the
  view second.
- **In the text being written** a mention is one piece (`WrittenMention` in
  `editor-extensions.ts`): the name after an "@", looking as it will where the text is read,
  deleted as a whole. Its Markdown is the marker with the person's key, so a text the page kept
  still shows its mentions, and a marker of any other shape is the text of its link, as where a
  text is read. A staff member is listed with the staff's name as their label.

### Cleaning, limits and names

- Text is cleaned before it's stored (`cleanMultilineText`): line endings become `\n`, and hidden
  and control characters are dropped rather than refused. A title has at most 150 characters, a
  description or reply 10,000 (`src/lib/input-rules.ts`).
- People appear **by name only**, never by email address: Clients and Watchers can't see who else
  is in their company, beyond the names in its requests and, for whoever may write, in the list
  of who can be mentioned (see [Mentions](#mentions)). Company users see a staff member's own name with a label that carries the
  name users know the staff by. Someone without a name (or with an old one that has nothing to
  see in it, `visibleName`), or whose account is gone, is shown as their side.
- **Avatars show people's pictures:** a person's avatar shows the picture they chose from a connected
  GitHub or Google account, or their initials (`RequestPerson.picture`, loaded for the whole page with
  `loadPictures`; see [decision 0022](decisions/0022-profile-pictures-from-providers.md)). Everyone
  who reads their name gets it; the picture's address says nothing more about who they are.
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
  [Design and accessibility](design.md#design-and-accessibility)). The staff also filter by
  assignee and see who each request is assigned to (see [Assigning](#assigning)).
  A list without requests says why: nothing matches (a search, a filter menu, or the Waiting or
  Closed link), nothing is active, or, under All, which leaves nothing out, there are no requests
  yet. The last two offer "New request" to whoever may raise one.
- **`/companies/<URL name>`**: the same list for one company, the company's first page.
- **`/requests/new`**: the company (only when there's more than one to choose from), a title, a
  type with what each is for, and a description. The staff also choose a priority, or leave it to
  the type. It opens the new request. A company that wasn't chosen is asked for like any other
  field (`requestCompanySchema`); "not found" is for a company the reader may not see.
- **`/requests/<number>`**: what was asked (Description), the Conversation with every reply and
  change, oldest first, and a Details bar: status, who it's assigned to, who is subscribed, type,
  priority (staff),
  company, who raised it and when, the staff's first response and the last activity, with the
  controls. The bar is on
  the right on wide screens, and between the description and the conversation on narrower ones.
  On a screen wider than 1280px the page grows past the width other pages have, up to 1280px of
  content (`WidePage`), so the conversation and the reply's editor get the room.
  The conversation loads its latest 50 entries, with a link for earlier ones (`?earlier=`).
- The **menu** has Requests for everyone, and the **dashboard** a Requests tile, and an Assigned
  to you tile for the staff who can be assigned; see
  [Navigation and dashboard](companies-and-roles.md#navigation-and-dashboard).

## In the code

- `src/lib/requests/` (a folder module, free of zod and server code, so the database schema,
  the services and client components all import it): the values, the rules above, the number
  and the text. Not to be confused with `src/lib/request/`, which is about HTTP requests.
- `src/db/schema/requests.ts`: `request`, `request_participant` (who's assigned and who's
  subscribed), `request_entry`
  (the conversation and the history in one table, ordered by ID), `request_mention` (who a text
  mentions) and `request_counter`.
- `src/server/requests/` (a folder module): `listRequestCompanies`, `listRequests`, `findRequest`,
  `findRequestNumber`, `getRequest`, `raiseRequest`, `replyToRequest`, `changeRequestStatus`,
  `updateRequestDetails`, `changeAssignees`, `listAssignableStaff`, `countAssignedRequests`,
  `listMentionable`, `subscribe`, `unsubscribe`, `changeSubscribers`, `listSubscribable`, and
  `unassignFrom` and `unsubscribeFrom` for the services that end someone's request work or their
  access.
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
  highlighted code (`languages.ts`), the note above copied code (`code-note.ts`) and the class
  names (`styles.ts`). And what writes one: the
  field (`markdown-field.tsx`), the toolbar (`formatting-toolbar.tsx`), and the editor's own files
  (`editor*.ts(x)`), which only `import()` reaches.
- Example requests for development and the end-to-end tests come from
  `tests/database/store-requests.ts` (see [Testing](testing.md)). One of them is written in
  Markdown with every kind of formatting (`tests/database/formatted-request.ts`).
