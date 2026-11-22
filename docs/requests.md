# Requests

Back to the [documentation](README.md).

A request is what a company raises with the staff: a problem, a question or something new. Both
sides work it through in one conversation until it's done or no longer needed. This page says how
requests behave and where the code is; why they're built this way is in
[decision 0019](decisions/0019-requests-one-series-plain-text-and-a-history.md), for their
text in [decision 0021](decisions/0021-markdown-for-request-text.md), and for the people on a
request in [decision 0025](decisions/0025-people-on-a-request-one-table-with-roles.md), for
the emails about it in [decision 0031](decisions/0031-emails-about-requests.md), and for the
board in [decision 0037](decisions/0037-a-board-of-requests.md).

Not built yet, each for a later change: an approval step, and attachments.

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

| Permission               | What it allows                                                                                                                              | Who has it                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `requests:view`          | See the company's requests and their conversations                                                                                          | Everyone in an active company; every staff role    |
| `requests:contribute`    | Raise requests, reply, mark a request done, cancel it and reopen it, approve or deny a solution, edit the description and their own replies | Company Admin and Client; staff who work on them   |
| `requests:manage`        | Work on requests as the staff: any status, a solution, the title, the type, the priority, who's assigned, internal notes                    | Staff Admin, Manager and Support                   |
| `requests:view-internal` | See what only the staff see: the priority and internal notes                                                                                | Every staff role (Finance reads, but doesn't work) |

- Everyone in a company sees all of the company's requests. A **Watcher** only reads.
- **Finance** reads every company's requests, with the priority and the internal notes, and
  changes nothing. A staff
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
- While a staff member is **signed in as a user**, they can do that user's request work, which
  records them (see [Signed in as a user](#signed-in-as-a-user)); managing request types stays
  off.
- The services check all of this themselves (`src/server/requests/`), and every operation has a
  row in `src/server/authorization-matrix.int.test.ts`.

## Statuses

Open → To do → In progress → Waiting for the company → Waiting for approval → Done, and Cancelled
for a request that isn't needed anymore (`REQUEST_STATUSES` in `src/lib/requests/values.ts`). Done
and Cancelled are the closed statuses.

- **The staff** who work on requests set any status on any request, with the status select on the
  request's page, except Waiting for approval (see [Solutions](#solutions)). It saves when a status
  is picked, never while moving through the list. On the board, moving a card to another lane
  changes its status the same way, for everyone who may (see [The board](#the-board)).
- **Company Admins and Clients** have three buttons instead: **Mark as done**, **Cancel request**
  (from any status but Done; it asks first) and **Reopen** (a done or cancelled request). They
  can't set the other statuses (`mayChangeStatus`). While a solution waits for them, they approve
  or deny it instead of marking the request as done.
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
  sees the request as it is, rather than overwriting it (`errors.requests.statusChanged`). The
  status select, the buttons and the board's Move menus send the status they showed (`from`), so
  the change is refused when the request has another status by now, also for the staff, who may
  make any move; the action then refreshes the page. A change without `from` is refused only when
  the move is no longer allowed.

### Solutions

The staff can say a request is fixed without closing it, for the company to confirm
([decision 0033](decisions/0033-solutions-the-company-approves.md)).

- **Sending one:** the reply form has a third button for the staff who work on requests, **Send
  as solution** (`mayProposeSolution`: a request that's still worked on and doesn't wait for an
  approval already). It sends the reply and sets **Waiting for approval** (`proposed`) in one
  change and one email (`replyToRequest` with `status: 'proposed'`). The status select never
  offers it, and `changeRequestStatus` refuses it, so a proposal always has its text.
- **Its words:** "Waiting for approval" (the staff), "Waiting for your approval" (Admins and
  Clients), "Waiting for your company's approval" (a Watcher). It shows under the Waiting tab, and
  its badge is the warning tone, like waiting.
- **Answering:** while a solution waits, the company's Admins and Clients (`mayAnswerSolution`,
  never a Watcher or the staff) see a notice above the reply form with **Approve**, which closes
  the request (Done), and **Deny**, which opens a dialog with an optional "What's still wrong?"
  field and puts the request back In progress (`answerSolution`, `statusAfterAnswer`). A reason
  is stored as their reply right before the change. A plain reply leaves the solution waiting:
  only the buttons answer it.
- **From the email:** the email that tells an Admin or Client of the solution has **Approve** and
  **Deny** buttons instead of "Open request". Each opens a link of their own
  (`/answer/<token>/approve` or `/deny`, a public path) that answers without signing in, once,
  only for them and that proposal, for 14 days (`createAnswerLink`, made by the email's job;
  `answerByLink`, with the same rules as the page). A person's click answers straight away
  (`Sec-Fetch-User: ?1`, `isPersonsClick`); any other visit, such as a mail scanner checking the
  link, ends on the link's page (`/answer/<token>`), which asks for a button press first. Safari,
  and every browser on an iPhone or iPad, never says a person clicked, so there the page always
  asks: unlike the sign-in link, it never goes on by itself, since it changes the request
  ([decision 0038](decisions/0038-request-links-continue-by-themselves.md)). The page
  then says what happened, and a link that can't answer any more says why: used, expired,
  overtaken (answered in the app, withdrawn, closed) or its person no longer able to answer.
  Only the email that tells of the proposal has the buttons; a later email while it still waits
  doesn't.
- **In the history:** "Proposed a solution.", "Approved the solution.", "Didn't approve the
  solution." (`statusChangeKind`, which the emails use too).

## Types and priorities

- **Types** are the staff's own (`request_type`, decision
  [0027](decisions/0027-request-types-the-staff-manage.md)). A fresh install has the four that were
  built in: Hotfix, Bug, Support and New feature, named in the language it's set up in. Each type
  has a name and what it's for (one text for every language, like the staff name), the priority a
  new request of it starts with, and a place in the order every list shows.
- **Keys:** a request, its history and the list's `?type=` filter hold a type's key
  (`request.type` points at `request_type.key`). A new type gets its key from its name
  (`requestTypeKeyFromName`: "Printers" becomes `printers`, then `printers_2`); a rename keeps
  it, and no key is reused, since types are never deleted.
- **Managing them** (Settings, Requests tab, Request types; staff Admins, `staff:manage`): add a type, edit its
  name, what it's for and its starting priority, move it up or down, archive or restore it
  (`addRequestType`, `updateRequestType`, `moveRequestType`, `archiveRequestType`,
  `restoreRequestType` in `src/server/requests/types.ts`). Each change but a move is in the audit
  log (`request_type_added`, `_changed`, `_archived`, `_restored`).
- **Archived types** aren't offered when a request is raised or its details are edited
  (`errors.requestTypes.unavailable`), but the requests that have one keep it, Edit details still
  shows it for them, and the list's filter and the history still name it. The last type that
  isn't archived can't be (`errors.requestTypes.lastActive`).
- **Names everywhere:** the services give each request's type name, and the names in a type
  change, as they're called now (`listRequests`, `getRequest`); every reader gets the types
  (`listRequestTypes`), the starting priorities only the staff.
- **Priorities:** Low, Normal and High. A request starts with its type's starting priority. Only
  the staff set one, when they raise a request for a company or later; a type's new starting
  priority is for requests raised from then on.
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

Someone subscribed to a request follows it: a request's assignees and subscribers are who the
[emails about it](#emails) reach. Why it's built this way is in
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
  request's last activity. It's still a change like the others: refused in a deactivated company,
  and counted against the limit on changes to requests. A staff member signed in as the user may
  change their subscriptions as the user could (see [Signed in as a user](#signed-in-as-a-user)).
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
- **The requests there were** got their subscribers from migration `0018_request_participants`:
  whoever raised them, replied to them or was mentioned in them, as far as they still read them.

## Emails

The people on a request, its assignees and subscribers, are told by email what happens to it. Why
it's built this way is in [decision 0031](decisions/0031-emails-about-requests.md); how emails are
written and sent is in [Email](email.md), and the jobs that send them in
[Background jobs](jobs.md#queued-jobs).

- **What is told:** a reply, an internal note (to the staff only), a change of status (also the
  one a reply brings, and done, cancelled and reopened), and being put on the request: assigned to it, mentioned in one of its texts, or
  subscribed by someone else. A new request emails nobody but the people its description
  mentions: it shows in the list and on the dashboard. A changed title, type or priority, an
  edited text (unless the edit adds a mention) and being taken off a request email nobody.
- **Who is told** (`src/server/requests/updates.ts`, the one place that decides it): a reply and
  a status change go to everyone on the request, its assignees and its subscribers
  (`tellPeopleOnRequest`, from `loadPeopleOn`), except whoever did it. Being put on a request goes
  to the one it's about, unless they did it themselves: a staff member a colleague assigned
  (`tellAssigned`), someone a description or a reply mentions, also when an edit adds the mention
  (`tellMentioned`; a new reply that mentions someone is told to them once, as the mention), and
  someone another person subscribed (`tellSubscribed`). An internal note goes to the staff on the
  request (its assignees and its subscribers who read notes) and the staff it mentions, also
  when an edit adds the mention, never to whoever wrote it and never to anyone at the company
  (`tellStaffOnRequest`, `staffWhoReadNotes`;
  [decision 0032](decisions/0032-internal-notes-email-the-staff.md)). A job per person and piece
  of news (`request-update`) is queued in the
  transaction of the change, so the news exists exactly when the change was saved. Its payload
  holds IDs only.
- **One email per person and request per tick:** the jobs of one person about one request share a
  batch key, so a reply and the status change that came with it, a note beside them, or three
  replies in five minutes, are one email, in the order they happened.
- **What the email shows** is read when it's sent (`readRequestUpdate`): the request's title, its
  number as a link, its company, who did what, and each reply (and a text that mentions the
  reader) in full, formatted as on the page
  (`EmailMarkdown`; see [Text people write](security-measures.md#text-people-write)). People are
  named as the request's page names them, their own name or their side's, never by an address or
  an ID, and the people a reply mentions by name. The statuses are worded for the reader
  ("Waiting for your reply" for someone at the company who takes part, "Waiting for the company"
  for the staff). The subject is the number and the title ("AD-142: The printer is broken"), the
  same for every email about the request, so mail apps keep them together. Its link opens the
  request at the first news it tells of that has a place on the page (`RequestUpdate.anchor`:
  that entry, or the description for a mention in it), so the page scrolls there. The reader's
  sign-in link (below) names the entry too (`…/request-link/sign-in?token=…&entry=<ID>#entry-<ID>`)
  and passes it on to the request (`?entry=<ID>`, `requestPathWithEntry`), also through its
  confirmation page, so the page shows that entry whatever the reader's activity filter; the
  browser keeps the anchor through the link's redirect. Replies to the email
  aren't read, and it says so. An email that tells someone at the company of a solution they may
  answer has Approve and Deny buttons of their own (see [Solutions](#solutions)), made when it's
  sent (`RequestUpdate.answerable`).
- **Its links sign the reader in:** the request's number and the button are the reader's own link,
  made as the email is sent (`createRequestLink`), which signs them in and opens the request for
  14 days, without the step-up page ([decision 0036](decisions/0036-sign-in-links-in-request-emails.md);
  see [Links in emails about requests](authentication.md#links-in-emails-about-requests)). In
  Safari it goes through its confirmation page, which continues by itself when nobody is signed
  in there ([decision 0038](decisions/0038-request-links-continue-by-themselves.md)). The
  email says so, and not to forward it.
- **Only who is still on the request is told:** when the email is sent, someone whose account is
  deactivated, who can no longer read the request, or who is no longer on it (unsubscribed,
  unassigned) gets nothing, and their jobs are skipped. News that's no longer true is left out
  too: an assignment that was taken back, a mention an edit removed.
- **Turning them off:** Unsubscribe on a request's page stops that request's emails. **Emails
  about requests** on the account's Profile page (`user.request_emails`, on by default;
  `setOwnRequestEmails`) stops all of them, also for the requests assigned to someone; it's
  checked when an email is sent, so it also stops what's on its way. The footer says why the
  reader gets the email (the request is assigned to them, or they're subscribed) and links to
  both: Unsubscribe for a subscriber, and the account's card (`/account/preferences#request-emails`).
- **In the reader's language** (`recipientLocale`), like every email.
- **Nothing meant for the staff reaches a company:** replies, status changes and assignments are
  what everyone on a request sees anyway; a change of priority is never queued. An internal note,
  or a mention in one, is queued for the staff only, and `readRequestUpdate` checks again: it
  builds a note item only for a reader with `requests:view-internal`, so a note queued for anyone
  else by mistake is left out, and an email with nothing left isn't sent.

## Numbers

- Requests are numbered in **one series** across Adiutor: 1, 2, 3. The number comes from the
  `requests.last_number` setting (`incrementSetting` in `src/server/settings/`), raised inside the
  transaction that stores the request, so a failed attempt uses no number and two requests raised
  at the same moment get consecutive ones.
- Numbers are shown with a **prefix** the staff Admins choose on the Requests tab of Settings (`AD` by default:
  `AD-142`; one to five letters or digits, starting with a letter, saved in capitals;
  the `requests.prefix` setting).
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
- **No links to the staff's pages in a text the company reads.** For the staff a name is a link
  to the user's page, which a browser copies as a whole address with the user's ID in it. A link
  to one of Adiutor's own pages for the staff (`/admin` and under it, on Adiutor's host, however
  the path is spelled: in capitals, percent-encoded, or on the host with a trailing dot;
  `isStaffPage` in `src/lib/requests/text.ts`) is kept out of a description or reply four times
  over; an internal note, which only the staff read, keeps such links each time:
  - **When it's saved** (`withoutStaffPageLinks` in `src/server/requests/staff-links.ts`, applied
    by `raiseRequest`, `replyToRequest`, `answerSolution` for a denial's reason,
    `editRequestDescription` and `editReply` once the text is cleaned and the rate limit taken,
    and before the request is locked). The text is read as the page reads it (`markdownReader`
    in `tree.ts`), so every link the page would show is found, however it's written (character
    references, a definition in a quotation or a list, brackets in code in its text): a link to
    one becomes its text as it was written, an image of one its description, a link definition
    to one is taken out and a reference to it becomes its text. The text is read again until
    nothing changes, since taking a link out can make a new one of what's around it. Code is
    never touched, and an address written out stays as written. Reading costs time, so a text is
    only read when it may hold such a link (`mayHoldStaffLink`): it names Adiutor's host, or it
    has a link or a link definition (`](` or `]:`) and could name the host another way (a `%`,
    `&` or `\`, a character outside printable ASCII, or a host that's an IP address). It's read
    at most 10 times; a text that would cost too much to read (`MAX_EMPHASIS_RUNS`), that's nested
    too deeply for the reader, or that still changes after the last time keeps only the labels of
    such links by a rule that reads no Markdown (`staffLinksAsLabels` in
    `src/lib/requests/staff-link-labels.ts`, below).
  - **Where it's shown or emailed**, also a text saved before this rule: a link to one shows as
    its text, an image of one as its description, and an address written out isn't a link
    (`textLinkTarget`, used by `MarkdownText` with the app's public URL, by `RequestText` for a
    plain text, and by `EmailMarkdown` with the email's `appUrl`). A text shown as it was written
    (stored as plain text, or too costly to format) shows only the label of a link to one, never
    its address (`staffLinksAsLabels` in `RequestText` and `EmailMarkdown`, on the text as it's
    stored, before the people it mentions are named, so no name can change how its links read).
    `RequestText`, `EditedNote` and `EmailMarkdown` are told when the text is a note
    (`staffOnly`, or no `appUrl`).
  - **In the editor's starting text:** a reader who may not open the staff's pages (without
    `users:view`: everyone at a company, also a staff member signed in as one) gets a
    description or reply to edit without them (`editableText` in `getRequest`, through
    `withoutStaffPageLinksToEdit`), so a link saved before this rule never reaches their
    browser. It's read on every view, so it's read as Markdown twice at most: enough for a text
    with such links to keep its code as it is, while a text still changing the second time (links
    made of links) goes through the rule that reads no Markdown. Saving it unchanged stores it
    without the link; the staff, and anyone editing a note, get the text as it's stored.
  - **While it's written** (see [Writing a text](#writing-a-text)).
- **The rule that reads no Markdown** (`staffLinksAsLabels`) turns `[label](address)` into
  `label` when the address is a staff page, with the address in angle brackets or not and with a
  title or not (`![description](address)` becomes the description), and takes out a link
  definition to one (`[label]: address`, label and all). An address written out stays as it is,
  also in angle brackets (an autolink), and so does one hidden in a character reference, as for
  an address written out: the writer saw it. It matches a link's brackets within its paragraph
  and reads escapes, balanced parentheses and titles as Markdown does, but it can't tell code
  from text: a link in code loses its address too, and so does a staff page's address after a
  `](` whose `[` it can't find (a `]` in code in the label takes it). An address is judged by
  its first 256 characters after the spaces before it (`JUDGED_ADDRESS_LENGTH`), without the tabs
  and line breaks a browser drops; a longer one counts as a staff page when
  it's on Adiutor's host, or its host doesn't end within them. Its time grows in proportion to
  the text's length, whatever the text holds: what it needs is worked out beforehand in a few
  passes, the text is read once, no part is read again more than a few times, and no address
  more than its judged part.
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
  or `_` (`MAX_EMPHASIS_RUNS`; the parser's time grows with their number squared). A link to one
  of the staff's pages in it shows only its label (`staffLinksAsLabels`, see above).

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
- **Pasting with formatting** (copied from the editor, or from a text where it's read) keeps the
  formatting, by the same rules: a pasted link stays one only for a whole `http` or `https`
  address, and nothing pasted loads. Mentions and images stay what they are, because their
  elements carry what the editor reads them back from: a mention its person's key
  (`data-mention-key`, see [Mentions](#mentions)), an image in the editor the Markdown it was
  written as (`data-markdown`, taken only when it reads as one image). A mention's element is
  never a link, also where it links to the person's page, and the styles a browser copies with
  a mention or an image are dropped first (`withoutOwnLooks`), so a mention doesn't come in bold.
- **Links to the staff's pages:** in the field for a description or reply, a link to one of the
  staff's pages is its text however it comes in: pasted with its formatting (an entry's author,
  a row of the list of users) or as Markdown, typed, or pasted over a selection, and the link
  dialog refuses one and says why. An image of one is its description, as when the text is
  saved. The page's own address is the one checked, as a browser copies a link from it. The
  note's field keeps such links (`MarkdownField`'s `staffOnly`).
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
  change: refused for a deactivated company, past the rate limit of request changes, and for a
  closed request (`errors.requests.closedNoEdit`). An edit a staff member makes while signed in
  as the editor says so (see [Signed in as a user](#signed-in-as-a-user)).

### Internal notes

What the staff write for each other on a request: a cause they suspect, a hand-over, a reminder.
Why it's built this way is in [decision 0026](decisions/0026-internal-notes-as-a-kind-of-entry.md).

- **A note is an entry of its own kind** (`note`), in the conversation with the replies. Only
  readers with `requests:view-internal` get it: `getRequest` leaves out every kind in
  `STAFF_ONLY_ENTRY_KINDS` (`src/lib/requests/values.ts`: a change of priority and a note) for
  anyone else, from the entries, from the count of earlier ones, and from the mentions and
  versions it loads. So nobody at the company learns that a note exists.
- **Who writes them:** the staff who work on requests (`mayWriteNote`, `requests:manage`), with
  `addNote` (`src/server/requests/notes.ts`), also on a done or cancelled request. Finance reads
  them. A note counts towards the same limit as replies.
- **Nothing changes for the company:** a note doesn't change the status, isn't the staff's first
  response, and doesn't move the request's last activity, which company users see and the lists
  sort by.
- **Mentions:** a note can mention anyone a reply can. Someone at the company it mentions never
  sees it, isn't emailed about it, and isn't subscribed by it.
- **Emails:** a note is emailed in full to the staff on the request and the staff it mentions,
  marked as an internal note, and never to anyone at the company (see [Emails](#emails)).
- **Editing:** like a reply, by its author while the request is open and while they still work on
  requests (`mayEditNote`), through `editReply`, with its earlier versions kept.
- **Links:** a note may link to the staff's pages (a user's, a company's), written, edited, shown
  and emailed, which a reply keeps as its text (see [Text](#text)).
- **On the page:** for the staff who work on requests, the reply form has two tabs, Reply and
  Internal note (`WriteTabs`, on the `Tabs` component), each with its own form and draft. The
  note's form sits on the amber surface (`warning-soft`) and says only the staff see it. In the
  conversation a note reads like a reply, on the amber surface, with an "Internal note" badge and
  a lock.

### Mentions

A description, a reply or a note can mention people. Why it's built this way is in
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
  was assigned; not who only changed the priority or wrote an internal note, which they don't
  see). For a request that isn't
  raised yet, someone at the company gets their colleagues only. Never the writer themselves, a
  deactivated account, or someone without a name to show; someone on the staff who is also in the
  company is listed once. The list gives a key, a name and whether they're staff, by name.
- **Storing** (`storeMentions`, in the transaction of `raiseRequest`, `replyToRequest` and `addNote`, right
  after the text's row): the markers of people the writer may mention there become rows, one per
  person however often the text names them, and the text's markers are pointed at them. At most
  20 people per text (`MAX_MENTIONS_PER_TEXT`). Every other marker stays as it was typed (another
  company's key, a key nobody has, a marker typed with a row's ID): nothing is refused.
- **Reading** (`getRequest`): each text comes with the people it mentions, by the ID its markers
  name, as the reader may see them (`requestPerson`: a name, their side, whether it's the reader,
  and an ID for the staff only). A reader who may write in the request (`requests:contribute`,
  and not in a deactivated company) also gets each person's key (`MentionedPerson.key`), so a
  mention they copy into a text stays one ([decision 0035](decisions/0035-mention-keys-on-posted-texts.md));
  nobody gets one for someone without an account or a name to show. A text gets its own mentions
  only, so a marker with another text's row names nobody. Someone whose account is gone stays
  mentioned, by their side.
- **Showing** (`RequestText`, which hands `MarkdownText` its `mentions`): a mention is the
  person's name after an "@", as the page names them (their own name, or their side's), with a
  line around it and in a heavier weight, so it's set apart by more than a colour, also in
  forced-colours mode. A mention of the reader has the line and the name in the colour of
  highlights. For the staff the name links to the user's page; a side's name never does. For a
  reader who got the key, the mention's element carries it (`data-mention-key`). The
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
- **Pasted** (copied from the editor, or from a text where it's read by someone who may write), a
  mention stays one: the editor reads it back from its element's key (`data-mention-key`) and the
  name after its "@". Without a key of the right shape it's that text, and never a link, also
  where it linked to the person's page. Whether the writer may mention them is checked when the
  text is sent, as for one picked from the list.

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

## Signed in as a user

A staff member signed in as a user
([decision 0028](decisions/0028-request-work-while-signed-in-as-a-user.md), and
[Signing in as a user](authentication.md#signing-in-as-a-user)) can do the request work that user
may do, with the user's rights: raise, reply, change the status, edit the user's texts, subscribe
and unsubscribe and, signed in as a staff member, write notes, change details and assign. Managing request types is staff
settings, and refused.

- **The record:** the row that names the user as who did it (the request, the entry, the text
  version) also holds a flag and the staff member (`created_signed_in_as` and
  `created_signed_in_as_staff_id` on `request`, `signed_in_as` and `signed_in_as_staff_id` on
  `request_entry` and `request_text_version`), from `signedInAsWork`. The author stays the user.
  The flag outlives the staff member's account; the staff ID doesn't.
- **Who's told:** only the user and the staff who see the audit log (`audit:view`:
  `maySeeSignedInAsWork` in `src/lib/authz/impersonation.ts`). The service gives them a mark
  (`signedInAs` on an entry or a version, `raisedSignedInAs`, `editedSignedInAs` for a text's last
  edit) with the staff member's name, or `null` once the account is gone, and leaves it out for
  everyone else.
- **On the page:** `SignedInAsMark` after the time: "Ann did this while signed in as you" for the
  user, "Ann did this while signed in as Pat" for Admins and Managers, and "A staff member" once
  the account is gone. An edit says "made this edit", after "Edited" and under a version's line.
- **Rate limits** count against the staff member (`actingUserId`), and the change's transaction
  checks again that the sign-in still holds (its row read `FOR SHARE`, code `signed_in_as` with
  `errors.impersonation.ended`).
- **Subscriptions** leave no history, so a change of them made while signed in as the user goes to
  the audit log instead (`request_subscribers_changed`, in the Sign-ins group): by the staff member,
  about the user, with the request and who was subscribed or unsubscribed. Only staff who see the
  audit log read it; the user's own Recent activity leaves it out (`STAFF_ONLY_AUDIT_ACTIONS`).

## Reading the activity

Everyone who reads a request chooses how its conversation reads, with two menus in the
Conversation card's heading (`activity-view.tsx`):

- **Show** has a checkbox for each group the reader is offered, under "Everything", which is where
  it starts: Replies, Internal notes (only the staff are offered it), Status changes, and Other
  changes (who it's assigned to, its title, type and priority). Any mix works, and unticking the
  last group shows everything again. For the staff, Replies includes the internal notes: while
  it's ticked, Internal notes is ticked along with it ("Included in Replies", `aria-disabled` but
  focusable) and pressing it changes nothing; unticking Replies leaves the notes alone. Ticking a
  box keeps the menu open, so several can be changed in a row. The button says what's shown
  ("Show: Replies and Status changes", the list joined the reader's way, `formatList`).
- **Order**: oldest first, or newest first. With the newest first the reply form (and, for the
  staff, the note tab) comes before the activity, set apart by a line, and the link to earlier
  entries comes after the oldest one shown.

The choice is saved with the reader's account (`user.activity_order` and
`user.activity_groups`, empty for oldest first and everything), so it holds on every request and
device; it changes nothing about the emails. The rules are pure functions in
`src/lib/requests/activity.ts`: which groups a reader is offered (`offeredActivityGroups`), how a
choice is tidied the one way it's saved (`normalizeActivityGroups`: the notes left out while
Replies is chosen, nothing or everything saved as everything), how it applies to a reader
(`effectiveActivityGroups`), what the menu does with a tick (`withActivityGroup`) and which kinds
of entry it shows (`activityKinds`; every kind of entry has a group, or it doesn't compile).
`setActivityView` saves it (refused while a staff member is signed in as the reader, whose
menus are off then), and `getRequest` reads it with the request's access and applies it in the
query: the groups narrow what the reader may see and never widen it, so a company reader whose
saved choice holds the notes still gets none (`STAFF_ONLY_ENTRY_KINDS` applies first), and the
count of earlier entries counts only the groups shown. An address that points at an entry
(`?entry=<id>`, as a link from an email does, with `#entry-<id>`) shows that entry whatever groups
the reader chose, within what they may see, and however far back it is (see
[Pages](#pages)); the link to earlier entries keeps it. The menus show a choice at once and save
it in a transition of their own (a spinner on the pressed menu's button, which stays focusable);
there's no toast when it works, since the activity changing says it, and a failed save is shown
above the activity and as a toast. When the groups chosen leave nothing to show, the conversation
says so with a "Show everything" button.

## Pages

- **`/requests`**, for everyone signed in: every request they may see. The status links (Active,
  Waiting, Closed, All) open on Active; next to them a search on title and number, and menus for
  the company (when there's more than one), the type and, for the staff, the priority
  (`FilterMenu`, a sibling of `SortMenu`). It sorts by last activity or the day it was raised,
  and for the staff by priority, and pages like every table (see
  [Design and accessibility](design.md#design-and-accessibility)). The staff also filter by
  assignee and see who each request is assigned to (see [Assigning](#assigning)). From tablet
  width the status, the priority, the assignees and the last activity have columns of their own;
  a long status ("Waiting for the company"), a long row of avatars and the last activity wrap in
  their columns, as on the board, so the table fits a tablet.
  `?only=<status>` shows the requests of one status instead of a link's group (`ONLY_STATUS_PARAM`;
  its own parameter, since `waiting` is both a group and a status): no status link is current
  then, and a line names the status in the reader's words, with a link back to every status.
  A list without requests says why: nothing matches (a search, a filter menu, or the Waiting or
  Closed link), nothing is active, or, under All, which leaves nothing out, there are no requests
  yet. The last two offer "New request" to whoever may raise one.
  A List | Board toggle under the heading switches to the board with the same search, filters
  and sort.
- **`/requests/board`**, for everyone signed in: the same requests in a lane per status, with the
  list's search, filter menus and sort, and a Move menu on each card the reader may move, or from
  tablet width a drag (see [The board](#the-board)).
- **`/companies/<URL name>`**: the same list for one company, the company's first page, with a
  List | Board toggle above it.
- **`/companies/<URL name>/board`**: that company's requests as a board, for everyone who may see
  them (its people and the staff), under the company's header with its Requests tab still current
  (see [The board](#the-board)).
- **`/requests/new`**: the company (only when there's more than one to choose from), a title, a
  type with what each is for, and a description. The staff also choose a priority, or leave it to
  the type. It opens the new request. A company that wasn't chosen is asked for like any other
  field (`requestCompanySchema`); "not found" is for a company the reader may not see.
- **`/requests/<number>`**: what was asked (Description), the Conversation with every reply and
  change (and, for the staff, every internal note), oldest first unless the reader chose otherwise
  (see [Reading the activity](#reading-the-activity)), and a Details bar: status, who
  it's assigned to, who is subscribed, type, priority (staff),
  company, who raised it and when, the staff's first response and the last activity, with the
  controls. The bar is on
  the right on wide screens, and between the description and the conversation on narrower ones.
  On a screen wider than 1280px the page grows past the width other pages have, up to 1280px of
  content (`WidePage`), so the conversation and the reply's editor get the room.
  The conversation loads its latest 50 entries of the groups the reader shows (`THREAD_CHUNK`),
  with a link for earlier ones a chunk of 50 at a time (`?earlier=`, up to 19 more,
  `MAX_EARLIER_CHUNKS`): above them with the oldest first, below them with the newest first.
  Each entry has an anchor (`#entry-<entry ID>`, `entryAnchor`) and the description has one
  (`#request-description`), which the emails link to. Arriving with one, the page brings that
  entry into view below the sticky header and focuses it when focus is nowhere in particular
  (`EntryOnArrival`, like `AnchoredSection` for a card), and an outline marks it while the address
  names it. An entry the address names (`?entry=`) that's older than the latest 50 is shown with
  everything newer than it: `getRequest` counts the entries shown that are newer (only for an
  entry the reader is shown, so a note never counts for someone at the company) and loads as many
  chunks as reach it, without a gap, and the link to earlier entries goes on from there
  (`earlierChunks`). Only an entry further back than every chunk a reader can add isn't on the
  page, which then opens as usual, with the chunks asked for. Both anchors are section IDs, so
  signing in on the way keeps them.
- The **menu** has Requests for everyone, and the **dashboard** a Requests tile, and an Assigned
  to you tile for the staff who can be assigned; see
  [Navigation and dashboard](companies-and-roles.md#navigation-and-dashboard).

### The board

`/requests/board` shows the requests the reader may see across companies in a lane per status
([decision 0037](decisions/0037-a-board-of-requests.md)), next to the list and with its header,
its search and filter menus (`parseRequestFilters`, `RequestFilterBar` without the status links)
and its sort. The List | Board toggle (`RequestViewToggle`) keeps the search, the filter menus,
the sort and the size (`size`), and drops the status link, `?only=` and the page.

A company's page has the same board for that company's requests only, at
`/companies/<URL name>/board` (`RequestBoard` with `company` and the company's `paths`,
`companyViewPaths`), for everyone who may see the company's requests (`requests:view`, the same
check as its list). It sits under the company's header, without a heading of its own, and its
Requests tab stays current there (`CompanyTabs`, since the tab's own segment is the list's). The
toggle above the company's list and board switches between the two, every link on the board (the
filters, the cards per lane, "See all") stays on the company's page, and there's no company menu
and no company on the cards. A deactivated company's board says so above it, and its cards have
no Move menu.

- **Lanes and columns:** a lane per status, in the order a request moves through them
  (`BOARD_LANES`), in five columns (`boardColumns`): Open, To do and In progress each on their
  own, then **Waiting**, with Waiting for the company in its upper half and Waiting for approval in
  its lower half, and **Closed**, with Done above Cancelled (`GROUPED_LANES`). A grouped column's
  heading says its total; each half is a lane of its own, with its heading, count, cards, "See all"
  and empty text. Each lane is named in the words of the reader's strongest part (`laneAudience`:
  "Waiting for your reply" for someone who takes part in any company) with its true count. A card
  whose company addresses its reader otherwise (a Client of one company and a Watcher of another)
  says its status in its own words. An empty lane says so. To screen readers, the columns and
  their halves are groups named by their headings (`role="group"`, not sections, which would make
  about nine landmarks); the headings stay for moving through the board by heading.
- **How many cards:** lanes aren't tables, so they have no pages. An open lane shows the first
  25, 50 or 100 cards in the list's sort ("Cards per lane", one size for every lane, as links like
  the list's rows per page: `PageSizeLinks`), each half of Waiting too; Done and Cancelled show
  their latest 5 each by last activity (`CLOSED_LANE_LIMIT`), whatever the sort. A lane that holds more ends in "See all 132",
  the list with `?only=<status>` and the board's filters and sort, and its list of cards says so
  in its name ("First 25 of 80", "Latest 5 of 132"), so a screen reader doesn't hear a count of
  132 followed by a list of 5 without a word. Across companies, the open
  lanes leave out a deactivated company's requests, as the Active list does, and the closed lanes
  keep them.
- **Cards:** the number, the type, the title (a link stretched over the card), the priority (the
  staff only), the company when the reader sees several, Reopened, who it's assigned to and the
  last activity.
- **Moving cards:** each card the reader may move has a Move menu ("Move AD-142" to screen readers)
  with the lanes it may go to: `moves`, which `listBoard` gives each card (`statusChoices` with the
  reader's permissions in its company, none in a deactivated company), so the browser never gets
  permissions. The staff who work on requests move a card to any lane but Waiting for approval; a
  company's Admins and Clients move one that's still worked on to Done (not while it waits for
  their approval, which they give on the request) or Cancelled, and a closed one back to Open.
  Watchers, Finance and anyone in a deactivated company only read, and get no menu. Done and
  Cancelled ask first, in the words of the request page's Cancel. `moveRequestAction` calls
  `changeRequestStatus` with `from` (the lane the board showed), then refreshes the board; a move
  from a board that's out of date is refused and the board shows the card where it is. Each move
  is one of the 300 changes an hour a person may make to requests, and is request work, so it's
  allowed while signed in as a user.
- **While a card moves** it's already at the top of its new lane, with both counts changed
  (`useOptimistic` with `placeMovedCard`), and its Move button alone is busy (a spinner, still
  "Move" and named "Move AD-142", still focusable, `aria-busy`). The board's live region, which is always on the page, says "Moving
  AD-142 to In progress…" (a status added to the card already filled in would often go unread). A toast says
  where it went ("AD-142 moved to In progress."); a refusal shows above the lanes and as a toast,
  and the card goes back; the live region is emptied first, so nothing is said twice. Focus follows the card to its Move button in
  the new lane (found by `data-request` once the move is on screen), or to the lane's heading
  when the card isn't on the board anymore (`restoreFocusIfLost`).
- **Dragging** (from tablet width): once the page is there, the board loads its drag and drop
  (Pragmatic drag and drop, through `import()` in `board-drag.ts`, the one file that imports it;
  `src/client-imports.test.ts` checks this, and phones never load it), and each card the reader
  may move gets a grip in its corner (decorative, `aria-hidden`), which drags it; the title link
  isn't draggable itself (`draggable={false}`), so the card moves, never its address. It's an extra
  for the pointer: the Move menu stays the way for the keyboard, screen readers and a single tap
  (WCAG 2.5.7). Each lane takes cards on its own, each half of Waiting and Closed too. While a
  card is dragged, a lane it may go to has a border in the highlight colour, and a ring and what
  letting go does under the pointer ("Let go to move it here"; on Closed's halves "Let go to mark
  it as done" and "Let go to cancel it"); a lane it can't go to has a dashed border, the
  not-allowed cursor and says "Can't move here", and doesn't take it. Waiting for approval's half
  never takes a card: a request waits for approval only after a reply sent as its solution, so a
  drop there says so. A live region
  says what happens, in the reader's language: picked up, which lane the pointer is over and
  whether the card may go there, and then where it goes ("Moving AD-142 to In progress…", as for
  the Move menu), or, for a drop on Done or Cancelled, where it was let go while their question
  is open. A drop on a lane it may go to takes the
  Move menu's path (moved at once, the same action, Done and Cancelled ask first, focus on its
  Move button); a drop on a lane it can't go to sends nothing and says why, above the lanes and
  as a toast (`moveRefusal`: the reader only reads, Waiting for approval comes with a solution, a
  solution is approved on the request, only the staff set that status, or not from here); a drop
  on its own lane, between lanes, or a drag given up leaves it where it was. The lanes' row scrolls
  sideways by itself while a card is dragged near its edges (auto-scroll).
- **Layout:** from tablet width the columns sit side by side, at least 14rem each, in a row that
  scrolls sideways inside its own box ("Lanes", reachable and scrolled with the keyboard while it
  overflows); the page itself never does. While it overflows, a row of buttons above it ("Jump to
  a lane", `BoardLaneJump`) has one per column with its name and count (both halves together for
  Waiting and Closed, counted as the board shows them, so a move under way counts at once); a
  press scrolls the row to that column (smoothly, unless the reader asked for less motion) and
  moves the focus to its heading. The row shows by CSS, not by measuring: the board is a
  container, and the row is hidden once the board is 73rem wide (five columns of 14rem and their
  gaps), so it's in the page from the first paint and the lanes don't move down once the page
  runs. If it hides while it has focus (a wider window), focus moves to the main content. On a
  wide screen `/requests/board` gets the room a request's page gets (`WidePage`), so from about
  1500px of screen all five columns fit side by side, the row doesn't scroll and the buttons
  aren't there. A company's board isn't widened: it stays as wide as the company's other pages
  (about 944px of content), under the company's header and tabs, so from tablet width its row
  always scrolls and the buttons are always there. Below tablet width
  the columns are stacked, each folding away from its heading with its count (a grouped column
  with both its halves).
- **In the code:** the rules in `src/lib/requests/board.ts` (lanes, closed lanes, the columns
  and their halves, the lanes' words, why a drop is refused, placing a moved card); `listBoard` in
  `src/server/requests/board.ts`, which picks and counts each status's cards in one windowed query
  for the open lanes and one for the closed ones, then loads the cards' rows as the list does
  (`loadRequestListItems`); the pages in `src/app/(app)/requests/board/` and
  `src/app/(app)/companies/[companyId]/board/`, and in
  `src/app/(app)/_requests/` the server part (`request-board.tsx`, which renders each card's
  content), the browser part (`board.tsx`, `board-lane.tsx`, `board-lane-jump.tsx`,
  `board-card.tsx`, `move-menu.tsx`),
  the drag and drop (`board-drag.ts`) and the action (`board-actions.ts`).

## In the code

- `src/lib/requests/` (a folder module, free of zod and server code, so the database schema,
  the services and client components all import it): the values, the rules above, how the
  activity is read, the number and the text. Not to be confused with `src/lib/request/`, which is about HTTP requests.
- `src/db/schema/requests.ts`: `request`, `request_participant` (who's assigned and who's
  subscribed), `request_entry`
  (the conversation, its internal notes and the history in one table, ordered by ID) and
  `request_mention` (who a text mentions). The counter is the `requests.last_number` setting.
- `src/server/requests/` (a folder module): `listRequestCompanies`, `listRequests` (built from
  `requestListCondition`, the WHERE every view of the requests shares, `requestListOrder`, its
  sort, and `loadRequestListItems`, which turns selected `requestListColumns` rows into
  `RequestListItem`s), `listBoard` (the board's lanes, see [The board](#the-board)), `findRequest`,
  `findRequestNumber`, `getRequest`, `setActivityView` (how the reader reads the activity),
  `raiseRequest`, `replyToRequest`, `addNote`, `changeRequestStatus`,
  `updateRequestDetails`, `changeAssignees`, `listAssignableStaff`, `countAssignedRequests`,
  `listMentionable`, `subscribe`, `unsubscribe`, `changeSubscribers`, `listSubscribable`,
  `readRequestUpdate` (what one person's email about a request may show), and
  `unassignFrom` and `unsubscribeFrom` for the services that end someone's request work or their
  access.
  Every change checks the permission and that the company is active, validates, takes a rate
  limit keyed on who is acting (`actingUserId`; see
  [Rate limits](security-measures.md#rate-limits)), then runs in a transaction that starts with
  `assertStillMayChange` (`assertStillManages`, then the company, then a sign-in as the actor
  still holding) and locks the request's row (see
  [Lock order](security-measures.md#lock-order)). That transaction refuses again when the company
  was deactivated meanwhile, which the staff's rights don't depend on; the company's row isn't
  locked (company rows come first in the lock order), so this narrows the moment in which a change
  can land just after a deactivation, without closing it.
- Times come from the database's clock at the moment something is written (`clock_timestamp()`,
  `CHANGE_MOMENT`), not from the start of its transaction: a reply that waited for another change
  to the same request is timed after it, as the conversation shows it. A new request's two times
  (raised, last activity) are one reading, taken with its number.
- Request work writes **no audit events**: the request's own conversation is the record, and
  nothing in it is a change of sign-in, role or account. The one exception is a change of
  subscriptions while signed in as a user, which the conversation doesn't show (see
  [Signed in as a user](#signed-in-as-a-user)).
- `src/app/(app)/_requests/`: what the request pages share (the list, its filters
  (`parseRequestFilters` and `RequestFilterBar` in `request-filters.tsx`), the header and its
  toggle between the list and the board, the board, the badges, the text, the people).
  `src/app/(app)/requests/`: the pages themselves.
- `src/components/ui/markdown/`: what shows a Markdown text: the pipeline with its limits
  (`tree.ts`), the allow-list (`sanitize.ts`), the elements (`elements.tsx`), the languages of
  highlighted code (`languages.ts`), the note above copied code (`code-note.ts`) and the class
  names (`styles.ts`). And what writes one: the
  field (`markdown-field.tsx`), the toolbar (`formatting-toolbar.tsx`), and the editor's own files
  (`editor*.ts(x)`), which only `import()` reaches.
- Example requests for development and the end-to-end tests come from
  `tests/database/store-requests.ts` (see [Testing](testing.md)). One of them is written in
  Markdown with every kind of formatting (`tests/database/formatted-request.ts`).
