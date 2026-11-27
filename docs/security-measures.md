# Security measures

How the app records security events, limits abuse and protects tokens and pages. To report a
vulnerability, see the [security policy](../SECURITY.md). Back to the [documentation](README.md).
The reasons behind the trust and confirmation rules are in the decision records
[0002](decisions/0002-trusted-provider-email-addresses.md) and
[0004](decisions/0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md).

## Audit log

The audit log (`audit_event`, `src/server/audit.ts`) records sign-ins (one per sign-in, with how,
e.g. `request_link` for the link in an email about a request; failed ones; and
right passwords whose sign-in then asked for the code, recorded without an actor), wrong second-step
codes (on the step-up page, and at the code step of a sign-in without an actor; only codes that
were compared and refused, not an expired one or another refusal), MFA changes,
password and provider changes, wrong current passwords typed in a signed-in session
(`password_check_failed`, with what it was typed for: changing the password, deactivating the
account, turning two-step verification on or off, or new backup codes), revoked sessions,
account creation (by an Admin, by accepting an invitation, or at setup), deactivation, reactivation
and deletion,
MFA resets, role changes, removed members, invitations and invite links, company changes, changes
to webhooks (added, changed, a secret renewed, turned off or on, removed; with the webhook's name
and host, never its address or secret, see [Webhooks](webhooks.md#changes-are-security-changes)),
and staff signing in as a user (`impersonation_started`, with the optional reason the staff member gave, and
`impersonation_ended`, with why it ended: going back, its time being up, no longer being allowed, or
the staff member's session ending; and users turning sign-ins by staff off or on,
`staff_sign_in_turned_off` and `staff_sign_in_turned_on`; see `src/server/auth/impersonation.ts` and
[decision 0017](decisions/0017-staff-sign-in-as-users.md)), each
with who, whom, which company, IP address and browser. It's kept for a year. The reasons for
signing in as a user show only under **Logs**; the user sees both events in their own activity,
naming the staff member.

Staff Admins and Managers (`audit:view`) see all of it under **Logs** (`/admin/logs`,
`listAuditLog`), and a user's recent activity on their page; they're the only ones who see the IP
addresses and browsers of other people. Users see their own recent activity on the Security page.
Errors recorded for the references error pages show (`app_error`, `sign_in_error`, kept 7 days)
are only for staff Admins (`errors:view`), under **Logs → Errors** (`src/server/recorded-errors.ts`).

## Rate limits

Better Auth's own limits (per IP address) are stored in the database (`rate_limit`), so they hold
across restarts and instances. On top of those, the app counts hits in `rate_limit_bucket`. Every
limit is a number of hits per window and a key, and answers with "Try again in N minutes". The
numbers below are the ones in the code: `RATE_LIMITS` in `src/server/rate-limit.ts` for the app's
actions and `AUTH_GUARD_LIMITS` in `src/server/auth/auth-guards/attempts.ts` for sign-in; the
code is the source if they ever differ.

| What is limited                                                 | Limit | Window      | Keyed on              |
| --------------------------------------------------------------- | ----- | ----------- | --------------------- |
| Wrong passwords (`failedSignInsPerEmail`)                       | 10    | 15 minutes  | email address         |
| Email links and password resets (`emailsPerAddress`)            | 5     | 1 hour      | email address         |
| Wrong step-up codes (`failedStepUpsPerUser`)                    | 5     | 15 minutes  | user                  |
| Emailed codes sent (`emailCodesPerUser`)                        | 5     | 15 minutes  | user                  |
| An emailed code again (`emailCodeCooldown`)                     | 1     | 2.5 minutes | sign-in or session    |
| Wrong current passwords (`wrongCurrentPasswordsPerUser`)        | 5     | 15 minutes  | user                  |
| Invitations sent (`invitesPerUser`)                             | 30    | 1 hour      | user                  |
| Invitations to one company or the staff (`invitesPerCompany`)   | 60    | 1 hour      | company, or the staff |
| Role changes (`roleChangesPerUser`)                             | 30    | 1 hour      | user                  |
| Invite links claimed (`linkClaimsPerIp`)                        | 10    | 1 hour      | IP address            |
| Verification emails (`verificationEmailsPerUser`)               | 3     | 15 minutes  | user                  |
| Sign-in link pages opened with a link that can't be used        | 20    | 15 minutes  | IP address            |
| (`emailLinkMissesPerIp`)                                        |       |             |                       |
| Request links that aren't links (`requestLinkMissesPerIp`)      | 20    | 15 minutes  | IP address            |
| Sign-ins with one request link (`requestLinkSignInsPerLink`)    | 10    | 1 hour      | link                  |
| Answer links that don't exist (`answerLinkMissesPerIp`)         | 20    | 15 minutes  | IP address            |
| Wrong secrets sent to the jobs' endpoint (`jobTickMissesPerIp`) | 20    | 15 minutes  | IP address            |
| Starting to sign in as a user (`impersonationsPerUser`)         | 10    | 1 hour      | staff member          |
| Requests raised (`requestsPerUser`)                             | 60    | 1 hour      | user                  |
| Replies and internal notes (`requestRepliesPerUser`)            | 200   | 1 hour      | user                  |
| Other changes to requests (`requestChangesPerUser`)             | 300   | 1 hour      | user                  |
| Storages tried in Settings (`storageChecksPerUser`)             | 20    | 1 hour      | user                  |
| Files uploaded to attach (`attachmentUploadsPerUser`)           | 100   | 1 hour      | user                  |
| Changes to webhooks (`webhookChangesPerUser`)                   | 30    | 1 hour      | user                  |
| Webhook tests and deliveries sent again (`webhookSendsPerUser`) | 20    | 1 hour      | user                  |
| Sign-in errors stored (`signInErrorsPerIp`)                     | 20    | 1 hour      | IP address            |
| App errors stored (`appErrorsPerIp`)                            | 20    | 1 hour      | IP address            |

What a limit does beyond refusing, and why:

- **Per email address.** The limits at the top count whether or not the address has an account. Only a
  plausible address is counted (at most 320 characters, and an address by `emailSchema`:
  `plausibleEmail` in `src/lib/validation.ts`): anything else a client sends as one becomes no rate
  limit key, and a failed sign-in with it is recorded without it, so arbitrary text (a password
  typed into the wrong field, kilobytes of anything) stays out of the audit log. Better Auth
  refuses a value that isn't an address before it checks a password or sends an email, and its
  per-IP limits still apply.
- **Take first, give back.** Each password sign-in takes one of the address's attempts before its
  password is checked and gives it back unless the password was wrong, and each step-up code takes
  one of the user's attempts the same way, so requests sent at the same moment can't all get
  through and successful ones don't count.
- **A pause, not a lock.** Since anyone can type wrong passwords for an address, reaching the limit
  only pauses password sign-in: the message (the same for every address) points to email links,
  passkeys and a password reset, and proving the inbox lifts the pause (a completed reset, or
  creating an account from an invitation). The owner gets a security email if the account has a
  password.
- **Emailed codes** also wait for each other: one per sign-in or session every 2.5 minutes, half a
  code's lifetime (`EMAIL_CODE_RESEND_SECONDS`), as Better Auth keeps the code with the sign-in or
  session it was asked for. The wait is checked first, so a refused code doesn't count, and it
  ends once a session's code is used. Setting up email codes waits too, but isn't counted towards
  the 5, so it doesn't eat into the sign-in budget.
- **Wrong current passwords** typed while signed in (changing the password, deactivating the
  account, and turning two-step verification on or off or getting new backup codes, where Better
  Auth checks the password itself: `checkCurrentPassword` in `src/server/auth/current-password.ts`
  and `CURRENT_PASSWORD_PATHS` in the guards) have a bucket of their own. Better Auth's per-IP
  limiter doesn't run for its calls from server actions, and a client can get around it by
  changing its IP address, so a signed-in (possibly stolen) session couldn't otherwise guess the
  password without limit; and since the bucket isn't the address's sign-in one, it can't pause the
  owner's password sign-in either. Each check takes an attempt first and gives it back unless the
  password was wrong, and each wrong one is recorded.
- **Invitations.** A claimed invite link also counts as an invitation its creator sends, against
  their limit and the company's (or the staff's), in the claim's transaction once the link is used
  up (`assertClaimLimits` in `src/server/people/invite-links/claim.ts`): past either, the claim is
  refused with "This invite link can't be used right now. Try again later." and rolls back, so the
  link stays unused and nothing is counted. Invite links therefore can't send more invitation
  emails than the limits allow, however many IP addresses claim them. Added members, registered
  users and companies count as invitations too. Role changes (company and staff roles together;
  removals aren't counted) each email the member, see
  [Changing roles](companies-and-roles.md#changing-roles-and-removing-people).
- **Links that can't be guessed by looking them up.** Past its limit, a sign-in link page offers no
  way to continue and the jobs' endpoint answers 429 (the right secret still works). A request
  link's sign-ins are capped so a forwarded or leaked link can't pile up devices; past it the link
  goes to the sign-in page (see
  [Links in emails about requests](authentication.md#links-in-emails-about-requests)).
- **Work on requests** is far more than anyone does by hand and few enough to stop a flood; work a
  staff member does while signed in as a user counts against the staff member (`actingUserId`).
- **Recorded errors** past the limit are only logged (see [Recorded errors](#recorded-errors)).
- **Per IP address.** The key is built in one place (`ipRateLimitKey`); requests whose address isn't
  known share one bucket per limit.

## Recorded errors

Errors are recorded for admins, who look them up by the reference the error page shows (see
[Looking up an error reference](deploying.md#looking-up-an-error-reference) in Deploying):

- **`sign_in_error`** (`src/server/auth/sign-in-errors.ts`): sign-in errors that end on the
  sign-in error page, with Better Auth's code and description.
- **`app_error`** (`src/server/app-errors.ts`): other unexpected errors, from the server
  (`onRequestError` in `src/instrumentation.ts`), from the browser (reported by the error page
  through `src/app/report-error-action.ts`, whose input is checked and cut to size), and from
  background jobs (source `job`, with the job's name as `route_path`; see
  [Background jobs](jobs.md#failures)).

Each keeps the signed-in user, if any, and is limited to 20 rows per IP address per hour
(`RATE_LIMITS.signInErrorsPerIp` and `RATE_LIMITS.appErrorsPerIp`), so opening an error page over
and over can't fill the table; past the limit an error is only logged. Job errors have no IP
address and no visitor behind them, so they're never limited. Rows are deleted after 7
days (the `retention` job, see [Background jobs](jobs.md)). `app_error` stores no database values (the message, cut
to 500 characters, goes through `redactLogValue`, `src/lib/log-redaction.ts`), no query strings
(they can hold search terms and sign-in tokens) and no secret tokens from paths (`/invite/…`,
`/join/…`, `/answer/…` and Better Auth's `/api/auth/reset-password/…` are stored with
`[token]`). The log line
of each error holds only its reference, where it happened and the digest, always on one line: the
error page's action refuses a path with a control character, and whatever is logged or stored has
its control characters (line breaks among them) turned into spaces, so a request can't add a line
to the log that looks like another error.

Untrusted text is also cleaned before it reaches a query: a search drops control characters
(`containsPattern` in `src/server/search.ts`), and a company's address is looked up only when it
can be an ID or a URL name (`getCompanyAccess`), so a NUL character, which Postgres refuses, gives
no results or "not found" instead of an error.

## Client IP

Better Auth and the app read the client's IP address the same way
(`src/lib/request/request-info.ts`), from `CLIENT_IP_HEADERS` (default `x-forwarded-for`), reading a
forwarded chain from the right past `TRUSTED_PROXIES`. Configure both for your hosting; see
[Client IP address](deploying.md#client-ip-address) in Deploying.

## Auth endpoints

Only the endpoints the browser uses under `/api/auth` are open; the rest answer 404, while
server code can still call them (`disabledPaths`, listed in `src/lib/sign-in/auth-endpoints.ts`, with a
test that fails when Better Auth adds one that's in neither list). The other API routes open
signed out are the health check (`/api/health`, see [Docker](deploying.md#docker)), which answers
only whether the app is up, and the background jobs' tick (`/api/jobs`, see
[Background jobs](jobs.md#the-endpoint)), which runs only with `Authorization: Bearer <CRON_SECRET>`
(compared in constant time) and answers with counts only; without `CRON_SECRET` it's off. When it
continues a tick on itself, it sends the secret only to the app's configured address
(`BETTER_AUTH_URL`), never to a host taken from the request. Staff Admins can pause background jobs,
but not the ones that keep people informed or clean up sign-in data (security notices, new staff
Admins, leftover provider tokens, finished sign-ins as a user), so a stolen staff Admin session can't
silence the emails that would give it away. While a staff member is signed in as a user, the guards refuse every
endpoint, from the browser or from server code, except reading the session and signing out
(`refuseWhileSignedInAs` in `src/server/auth/auth-guards/`); the link in an email about a request,
which a browser opens, goes to its confirmation page instead, which asks them to go back to their
own account first. The session is the staff member's, so
an endpoint would act on their own account (see
[Signing in as a user](authentication.md#signing-in-as-a-user)).

The link in an email about a request (`/request-link/sign-in`, an endpoint of the app's own
plugin) takes no return address: it always opens its own request. It signs in straight away only
on a person's click, and a `POST` never counts as one, so another site's form signs nobody in. How
it tells a click from anything else, and what it does then, is in
[Links in emails about requests](authentication.md#links-in-emails-about-requests).

A sign-in email's link (`/magic-link/verify`) signs in only with its confirmation page's Continue,
a form `POST` taken by the same rule (`isOwnPagePost`), with Better Auth's own handler behind it;
every `GET` of the link, whatever its headers, and any other `POST` go to that page first, unused
([decision 0041](decisions/0041-email-links-continue-by-post.md)). So neither a browser that sends
no Fetch Metadata nor a link to it written in a request's text (a same-origin click on the
request's page) signs anyone in without the page that names the account, and Safari, which never
says a person clicked, can use the Continue (see
[Email links](authentication.md#email-links)).

Return addresses must be pages of the app (`isSafeAppRedirect` in `src/lib/redirect.ts`): a path
that starts with a single `/`, has no control characters, spaces or backslashes, stays on the site
once resolved, and isn't `/api` or below it, in any case, also once its path is decoded (so
`/%61pi/…`, `/x/../api/…` and `/x%2f..%2fapi` are out). Absolute URLs are refused, even to the
site, and so is an anchor that doesn't name a section of the page (`isSectionId`, e.g. a text
fragment `#:~:text=…`; see
[Coming back to where you were](authentication.md#coming-back-to-where-you-were)).
A redirect to an endpoint would call it with the browser's cookies, e.g. a second sign-in
link that signs the browser in to another account. The guards (`src/server/auth/auth-guards/`)
check `callbackURL`, `errorCallbackURL` and `newUserCallbackURL` on `/sign-in/magic-link`,
`/magic-link/verify` (in the form of the confirmation page's Continue) and `/sign-in/social`;
`callbackURL` and `errorCallbackURL` on `/link-social`; `redirectTo` on `/request-password-reset`;
and `callbackURL` on `/reset-password/:token` (the link in a reset email, which Better Auth sends on
to it with the token or an error), `/verify-email` and `/send-verification-email`. A test walks the
endpoints the browser can reach (`BROWSER_AUTH_PATHS`) and fails when one takes a return address
that isn't checked (`request-checks.test.ts`); the ones it lets through, `/sign-in/email` and `/sign-out`,
take a `callbackURL` that Better Auth never sends the browser to here, and the query of
`/magic-link/verify`'s `GET` never reaches Better Auth (the guards send every one to the
confirmation page). Fields that aren't sent are fine. A refused request gets
`UNSAFE_RETURN_ADDRESS` (`src/lib/sign-in/sign-in-refusals.ts`); a refused link the browser opened,
or a refused Continue it posted, goes to the sign-in error page, which explains it. The app's own
pages only send relative paths that pass: the redirect targets they read from the URL go through
`getSafeRedirectPath`, which applies the same rules and falls back to the dashboard.

## Tokens

Invitation and invite-link tokens, the answer links of an email about a solution, the links in
emails about requests (`request_sign_in_link`, see
[Links in emails about requests](authentication.md#links-in-emails-about-requests)), and Better
Auth's reset, welcome and magic links and emailed codes, are stored as SHA-256 hashes (sign-in
links with the app's own hasher, `hashEmailLinkToken` in `src/lib/sign-in/tokens.ts`, so the page
they open can look them up).

The answer links (`/answer/<token>/approve` and `/deny`, a public path; decision 0033) are the
one kind of email link that changes something without signing in. Each answers one proposal, as
the person the email went to, once, for 14 days, and only while that proposal still waits and
the person may still answer it (an active account, a member with `requests:contribute`, an active
company), all checked again when it's used, with the same service as the request's page. It
answers on a `GET` only for a person's click (`Sec-Fetch-User: ?1`); a mail scanner's visit
changes nothing and gets a page with a button, which also waits for its press in Safari, where no
click counts as one. The link can't read the request, sign anyone in or
do anything else, and its token is never logged or stored in recorded errors.

Emails are sent after the response, so no answer waits for the mail server, whether or not the
address has an account. What's left of the difference is Better Auth's own work before it answers
a password reset request: it stores the link's token for an address with an account and does a
lookup in its place for one without, a few milliseconds either way.

Creating an account from an invitation (`acceptInvitationWithNewAccount`, open to anyone who is
signed out) looks the invitation up before it reads the name and password, and an account for
its address before it hashes the password: the hash is slow on purpose, and a loop of made-up
tokens would otherwise cost one each, or have what was typed into a form checked for nothing.
Both are checked again in the transaction, with the invitation locked, as first-run setup does
(`src/server/setup.ts`).

Session cookies are signed, so the database alone gives no usable session; see
[Sessions](authentication.md#sessions).

## Names

Display names, company names and the staff name end up in emails the app sends from its own domain
(an invitation's subject quotes the inviter's name), so `withNameSafety` in `src/lib/validation.ts`
refuses line breaks and control characters, characters that hide or reorder text (text direction
controls, zero-width spaces, U+FEFF, the fillers that are letters to Unicode but blank to the eye
such as U+3164, tag characters, line and paragraph separators; the zero-width joiners that
Persian, Arabic and Indic names need stay allowed, and so does the emoji variation selector; the
list is `HIDDEN_CHARACTER` in `src/lib/character-rules.ts`), and web addresses. A name also needs
at least one character that can be seen (`hasVisibleCharacter`), so it can't be only joiners or
accents and show as nothing in a list or an email; for a name saved before that rule,
`displayName` (`src/lib/display-name.ts`) shows the email address instead. The web-address check reads
a copy without format characters, normalised with NFKC and with look-alike full stops (`。`, `．`,
`․`) as `.`, and matches domains in any script and IPv4 addresses, while initials such as
`J.R.R. Tolkien` and `Adiutor B.V.` pass. It's a denylist, so it can't catch every way of writing an
address (`adiutor-login dot com`); it stops the ones mail clients turn into links. Passkey names
follow the same character rules and are at most 64 characters (`passkeyNameSchema`), checked by the
auth guards where Better Auth's passkey plugin takes them.

A name's length is checked first, and a name of the wrong length is refused without any other
rule reading it (`abort` in `lengthLimited`, and on the reason for signing in as a user): a form
or an action can send up to a megabyte, which zod would otherwise run every rule on. The
web-address check also takes time in proportion to the text, whatever it holds: its patterns never
read a long run of letters again from each letter in it, and a name with neither a dot nor `://`
skips them.

The staff's name reaches further than other names ([decision
0050](decisions/0050-the-staffs-name-instead-of-adiutor.md)): it stands for the product in every
text, so it's on the signed-out pages, in every page title and in the subject of every email the
app sends, security notices and sign-in links included, and in the label of new authenticator
entries and passkeys. The rules above keep it from adding a line break to a subject or a link to an
email; React escapes it in pages, titles and attributes; the authenticator label leaves out colons
(`signInAppName`), which would cut an `otpauth://` label in two; and a page title template takes it
with each `%s` written as `% s` (`forTitleTemplate`), so Next.js doesn't put the page's title into
it. Only staff Admins can change it (`renameStaff`, `staff:manage`, refused while signed in as
someone, recorded as `staff_renamed`). A passkey stays bound to the host (`rpID`), whatever its
label says.

## Text people write

A request's description and replies are written by one side and read by the other, in Markdown
(see [Requests](requests.md#text) and
[decision 0021](decisions/0021-markdown-for-request-text.md)). What someone types must never run,
load or mislead in a reader's browser:

- **No HTML.** The parser doesn't read HTML at all (`withoutHtml` in
  `src/components/ui/markdown/tree.ts`), so a tag is the text it was typed as. A text becomes a
  tree of our own React elements, never an HTML string, and ESLint refuses
  `dangerouslySetInnerHTML`.
- **An allow-list** of elements, attributes and address schemes
  (`src/components/ui/markdown/sanitize.ts`) runs on the tree before the highlighter adds its
  markup. It's the second check: it holds if the parser or one of its plugins ever lets
  something else through.
- **Links only for whole `http` and `https` addresses** (`linkTarget`): not a path of Adiutor
  itself, which could send a reader to a page that does something, and not `mailto:`,
  `javascript:` or `data:`. A link opens in a new tab with `rel="noopener noreferrer nofollow"`,
  and says so to a screen reader.
- **No images.** Every reader's browser would fetch an image from its host, which tells that host
  their IP address and when they read the request. An image is a link to it instead; the Content
  Security Policy (`img-src 'self'`) wouldn't load it either.
- **No text that costs too much.** A text nested deeper than a page can render, or with more
  emphasis marks than the parser pairs quickly, is shown as plain text (`MAX_NESTING`,
  `MAX_EMPHASIS_RUNS`). The limit of 10,000 characters bounds the rest: the parser and the
  highlighter's patterns never run on more. A text shown as it was written finds its links in
  time in proportion to its length (`splitLinks`), and leaves an address longer than 2,048
  characters as text.
- **In an email, the same tree and the same rules.** A text an email shows is rendered from that
  tree with inline styles (`EmailMarkdown` in `src/components/email/email-markdown.tsx`), which
  reads it with the page's own helpers (`textOf`, `writtenCode`, `mentionOf` in `tree.ts`): what was
  typed as HTML is text, only whole `http` and `https` addresses link, and an image is a link,
  which matters as much in a mail app, where a loaded image tells its host who opened the email
  and when. Nothing gets a class or an ID, code has no colours, and a text too costly to format
  is the plain text it is.
- **A mention never carries an ID or a name.** While a text is written, a person is a key that's
  only valid in the request's company (`mentionKey`, a keyed hash); the stored text points at a
  row in `request_mention`. Who it is, is looked up on the server when the text is read, per text,
  with the names the reader may see. A reader who may write in the request also gets the key of
  each person a text mentions, on the mention's element, so a pasted mention stays one; readers
  who can't write get none. A marker the writer may not use for a mention (another company's key,
  a guessed one, a typed row ID) stays text, pasted or typed. A mention pasted into the editor is
  never a link, so the address of a person's page, which the staff's mention links to, doesn't
  end up in a text. See [Mentions](requests.md#mentions).
- **No link to a staff page in a text the company reads.** A name the staff see links to the
  user's page, and a copied link carries the user's ID. A link to one of Adiutor's own staff
  pages (`/admin` and under it, on Adiutor's host) is kept as its text in a description or reply
  when it's saved (`withoutStaffPageLinks`, which reads the text with the page's own Markdown
  reader, so no way of writing a link slips past), where it's shown or emailed, also in texts
  saved before (`textLinkTarget`), and in the editor while it's written; only an internal note
  keeps them, and every text of an internal request, which has no company and which only the
  staff read (`getInternalRequestPermissions`, never a membership:
  [decision 0048](decisions/0048-internal-requests-have-no-company.md)). A text too costly to read as Markdown, and any text shown as it was written, keeps
  only such a link's label by a rule that reads no Markdown (`staffLinksAsLabels`), so its
  address never shows; its time grows in proportion to the text's length, since no address is
  judged by more than its first 256 characters. The text a company's reader starts an edit from
  comes without them, read as Markdown twice at most on each view, so one saved before never
  reaches their browser. A text is read whenever it could name Adiutor's host, also written
  another way (percent-encoded, a character reference, letters a browser maps to ASCII). See
  [Text](requests.md#text).
- **Nothing in a copied note becomes code.** The button on a block of code copies it below a
  comment that names the request and who wrote the text (`withCodeNote` in
  `src/components/ui/markdown/code-note.ts`), and a name is something a person typed. Every line
  of the note stays one line (each kind of line break becomes a space), so a name can't start a
  line of its own in what a reader pastes into a terminal or a file. A line of the note that holds
  what a language reads before or outside its comments is left out, in every language: a
  backslash (Java turns `\u000a` into a line end before anything else, C and C++ join a line that
  ends in one to the next), `??/` (C's trigraph for a backslash) and an encoding declaration
  (`coding:` or `coding=`, which Python reads from the first two lines, where the note goes; in
  UTF-7, `+AAo-` is a line break). Where a comment has an end (`*/`, `-->`), a note that holds what
  would end it isn't written at all: the code is copied alone.
- **The editor is a convenience, never a check.** It follows the same rules while a text is
  written (HTML stays text, only whole `http` and `https` addresses are links, an image is never
  loaded; `src/components/ui/markdown/editor-extensions.ts`), but all it produces is Markdown,
  which goes through everything above like text typed into a plain field. Its libraries are kept
  current like every dependency (`pnpm audit`): a paste into an editor is input from elsewhere.

## Pictures from providers

A person's picture is the picture of a GitHub or Google account they connected, but browsers never
load it from the provider: Adiutor serves it from `/avatars/<account ID>` (see
[decision 0051](decisions/0051-profile-pictures-each-choice-for-its-owner.md)), so the Content Security Policy
keeps images to `img-src 'self'` and viewers never contact GitHub or Google.

- **What's kept:** only an `https` address on the provider's own picture hosts, noted from its
  profile at sign-in (`imageFromProfile` in `src/lib/sign-in/oauth-providers.ts`). The address
  never reaches a browser and is never logged.
- **The fetch** (`loadPicture` in `src/server/people/pictures.ts`): the server asks the provider
  only for an address on those hosts, gives up after 5 seconds, follows no redirect, and accepts
  only PNG, JPEG, GIF and WebP up to 1 MB (never SVG). It stores nothing, and a failure is logged
  without the address.
- **Who gets it:** someone signed in, and only while that account is its owner's current picture.
  The owner alone also gets the other pictures they can choose (one account per provider: its
  first confirmed account with a picture, else its first, `choiceAccounts` in
  `src/lib/sign-in/pictures.ts`), so the account page previews each choice, but a staff member
  signed in as them doesn't: the page gives them initials there (`ownPictureChoices`)
  ([decision 0051](decisions/0051-profile-pictures-each-choice-for-its-owner.md)).
  Anything else gets "not found". The account ID in the address isn't the user's ID, so it tells a
  company user nothing about who someone is beyond the picture they show next to their name.
- **In the browser:** the image comes with its type, `X-Content-Type-Options: nosniff`, and
  `Cache-Control: private, max-age=86400`; its address changes when the provider's does.
- **The version in the address** (`?v=`, `pictureVersion` in `src/server/people/pictures.ts`) is
  a keyed MAC of the provider's address (HMAC-SHA-256, 64 bits of it), with a secret of its own
  worked out from the current auth secret (`derivedSecret` in `src/server/derived-secret.ts`: the
  first of `BETTER_AUTH_SECRETS` when it's set, else `BETTER_AUTH_SECRET`). A
  GitHub picture's address holds the account's number, so an unkeyed hash would let anyone who
  sees the version try every number until one matched; without the secret, a version can't be
  checked against a guess. The route doesn't read it: it's only there for browsers' caches, so a
  new secret only means each picture is fetched once more.

## Files people attach

A file attached to a request is uploaded on its own first, then sent with its text (see
[decision 0044](decisions/0044-attachments.md)):

- **The upload skips the proxy** (`POST /api/attachments`, the one path left out of the matcher in
  `src/proxy.ts`): the proxy holds every request's body in memory, whoever sends it, and cuts one
  over 10 MB short without a word. The route checks what the proxy would and more: only a page of
  this site may send (`isOwnPageFetch`: `Sec-Fetch-Site: same-origin`, or else an `Origin` that's
  exactly the site's), the session must count as `getActor` asks (answered in JSON, never a
  redirect), the size must be given (`Content-Length`, else 411), be within the limit (else 413,
  before the body is read) and match the body read, a piece at a time, and the name must decode.
- **Only the allow-list** (`ATTACHMENT_TYPES` in `src/lib/requests/attachments.ts`), by extension:
  images, PDF, text, Office and OpenDocument files, archives and screen recordings; never HTML,
  SVG, scripts or programs. **A file's bytes must be what its extension says**
  (`matchesAttachmentKind` in `src/lib/requests/attachment-checks.ts`): each kind's signature,
  and for text, valid UTF-8 or UTF-16 throughout without a NUL character, so an HTML page named
  `.png`, or a compiled program named `.txt`, is refused. Text is text whatever it says: a script
  or a page named `.txt` is kept, as `text/plain`, and like every file is only ever served as a
  download under a policy that runs nothing.
- **Names are cleaned** (`cleanAttachmentName`): no folder, no control or format characters (the
  text-direction marks that make `exe.txt` read as `txt.exe`), at most 255 characters with the
  extension kept. A file, its preview and a PDF's large page are kept under keys made from its ID
  only (`attachmentKey`, `previewKey`, `pageKey`), never its name.
- **Nothing is read before the cheap checks** (`uploadAttachment`): whether attaching is on, whether
  the person may write requests anywhere, the name and type, the announced size and the hourly
  limit come first, and the body is read only after them, so a refused upload costs no memory. A
  body that sends nothing for 30 seconds counts as incomplete.
- **Limits per person who really acts** (`actingUserId`): 100 uploads an hour, counting every
  attempt that gets past the checks above (one refused for its bytes too), at most 3 under way at
  once (`UPLOADS_AT_ONCE`, as each holds its file in memory; the picker sends no more), and 1 GB in
  any 24 hours, sent or not (`DAILY_UPLOAD_BYTES`), counted under a lock on the person so uploads
  side by side can't pass it together. The largest file is chosen per install (at most 50 MB, and
  4 on Vercel).
- **Row first, then the file:** a row is stored before its file is written and marked uploaded
  after, so a file never sits in storage without a row. A file refused for its bytes, or that came
  short, takes its row back (nothing was stored); one the storage failed to store keeps its row
  unfinished, since the storage may have kept it all the same (a timeout after it did), and the
  `attachment-files` job deletes both after an hour. An unsent upload is only its uploader's to send, for 24 hours (`claimAttachments`: their
  own finished upload, unclaimed, with the same staff member signed in as them if one was), and
  the `attachment-files` job purges it after 25, or once the uploader's account is gone. A text
  with a file that isn't the writer's to send is refused whole, and names only a file of their
  own, so nobody learns another person's file name by guessing its ID.
- **A file is read by whoever reads its text** (`loadAttachment` in
  `src/server/requests/attachments.ts`): the request's own access (`getRequestAccess`: the
  company's people while it's active, and the staff), and for an internal note's file the readers
  of notes (`requests:view-internal`, by `STAFF_ONLY_ENTRY_KINDS`). `getRequest` gives each text
  only the files its reader may see, the same way, so a company never learns that a note has a
  file. An unsent or removed file, or one the reader may not read, is "not found", by its address
  too.
- **Previews are drawn from untrusted files, within limits** ([decision
  0057](decisions/0057-small-previews-of-attached-files.md), `src/server/previews/`): a tile shows a
  small WebP image drawn on the server, never the file itself. An image reaches the decoder (sharp,
  libvips) only when its signature says PNG, JPEG, GIF or WebP (`matchesAttachmentKind`), so libvips
  never sees SVG, TIFF or any other format it reads; it's decoded only up to 50 megapixels, its
  first frame only, within 5 seconds, with libvips' cache off, and drawn again as WebP without its
  metadata (no location). A progressive JPEG, which is decoded whole (about 6 bytes a pixel) and a
  scan at a time before the time limit can stop it, is drawn only up to 16 megapixels and 100 scans. A PDF's first page is drawn by PDFium, built to WebAssembly without
  JavaScript or XFA, in a worker thread (`draw-pdf.ts`): the module's memory is capped at 256 MiB
  before it's compiled (`lowerMemoryMaximum`), so a PDF that wants more fails inside it; a PDF
  still drawing after 5 seconds stops the worker (drawn large for the viewer first, it's tried once
  more at 480 pixels, for its preview alone), and a password-protected one isn't opened. Its
  pixels are drawn as WebP like an image. An Office or OpenDocument file's preview is the
  thumbnail it carries, the file's own claim of what it looks like: a zip reader of our own
  (`zip-entry.ts`, on Node's zlib) reads the archive's directory and that one entry only, and
  refuses more than 10,000 entries, an entry over 2 MB packed or 4 MB unpacked, one that unpacks to
  more than it says or fails its checksum, encryption, zip64 and any packing but stored or deflated;
  the thumbnail is then drawn like an image, PNG or JPEG only. A video's preview is a frame its
  uploader's browser drew, the uploader's own claim too: the server takes one frame per video, only
  for the uploader's own unsent upload with the same staff member signed in as them, if one was
  (`setVideoFrame`, under its own rate limit), of at most 512 KB, claiming the video before it
  draws it so two frames sent at once can't both be taken, and draws it again as a JPEG, PNG or WebP
  image of at most 4 megapixels. A preview drawn while its file was removed or purged is deleted
  once it's stored, so no copy of a removed file stays behind. A server draws at most two previews
  at once (`DRAWINGS_AT_ONCE`); an upload that finds both taken leaves its preview for the
  `attachment-previews` job, which claims each file before it draws it, so a file that brings the
  process down is never tried again.
  Anything broken, past a limit or too slow keeps its icon, and a preview never fails an upload. The
  preview is served at `/attachments/<id>/preview` with `loadAttachment`'s checks and the file's
  caching, as `image/webp` with `nosniff` and as a download, and is deleted with its file.
- **Removing deletes the file:** the staff who work on requests remove a file someone shouldn't
  have attached (a password in a screenshot), and its bytes, its preview and a PDF's large page are
  deleted from the storage once that's saved, or by the `attachment-files` job if the storage fails then. The row
  stays as the mark of who removed it, with no name of whoever uploaded it.
- **Always a download** (`GET /attachments/<id>`): `Content-Disposition: attachment` with the
  name (`attachmentDisposition`: `filename*` in UTF-8, and a plain ASCII `filename` without
  quotes or backslashes), its type from the allow-list with `nosniff`, and
  `Cross-Origin-Resource-Policy: same-origin`. The proxy gives these paths a fixed policy that runs
  nothing (`FILE_POLICY`, `default-src 'none'; sandbox`), since Next.js puts the proxy's headers
  over a route's own. A tile's preview loads from under the same address
  (`/attachments/<id>/preview`), the same way: an image element shows an image whatever its
  `Content-Disposition` says, and `img-src 'self'` stays. The viewer ([decision
  0058](decisions/0058-files-open-in-a-viewer.md)) shows a file the same way, from its own
  address: an image (or a PDF's large page, `/attachments/<id>/page`) in an `<img>`, and a text
  file's first 200 KB fetched as a part of it and put in the page as text (React escapes it, so
  markup in it stays text), and a video in a `<video>` that asks for it a part at a time, never in
  a frame, so nothing a file holds runs, and navigating to the address is still a download.
- **Kept by the reader's browser, checked every time** ([decision
  0054](decisions/0054-browsers-keep-attachments-and-revalidate.md)): `Cache-Control: private,
no-cache` with the ID as `ETag`, since a file's bytes, name and type never change. `private`
  keeps it out of every shared cache, as what's served depends on who asks. `no-cache` makes the
  browser ask before each use: the route runs `loadAttachment`'s checks first, and only then
  answers `304` to a copy that's the file (`matchesIfNoneMatch`, without reading the storage), so a
  removed file, or a reader who lost access, is "not found" whatever copy they kept. "Not found"
  and an unavailable storage are `no-store`. Signing out asks the browser to drop its cache
  (`Clear-Site-Data: "cache"`, `clearCacheAtSignOut`), so a shared computer keeps no file after
  sign-out in Chrome, Edge and Safari. Firefox ignores it for now, and a session that ends without
  signing out in that browser (it expires, it's signed out from another device, or the account
  deactivates itself) clears nothing: such a copy stays in the browser's cache on disk until the
  browser drops it.
- **A part at a time, after the same checks** (`storedResponse`, `parseRange`): a file may be asked
  for a part at a time (`Range: bytes=…`), as a video player does to play and seek. Only one range
  is read, from a byte to a byte, to the end, or the last few bytes, and only once the checks and
  the browser's copy (`If-None-Match`) are settled; several ranges, or a copy from before
  (`If-Range` with another tag), get the whole file. The part is `206` with `Content-Range`, at
  most 8 MB of it (`MAX_PART_BYTES`: the player asks for the next part), and a part past the end
  `416`. Each storage reads the part itself (`getPart`), so no more of the file is read than asked
  for; a bucket's answer is checked (a `206` whose numbers don't add up fails), and from a server
  that sends the whole file instead, the part is cut out. A `HEAD` request gets the headers alone,
  without reading the storage (Next.js never reads a `HEAD` answer's body). A storage read ends
  after 30 seconds without a piece either way: from a storage that stops sending, and for a reader
  that stops reading (a paused video, a client that stalls on purpose), so nobody holds an SFTP
  connection or an open file for as long as they like.

## The logo and the browser tab icon

The logo and an own icon a staff Admin uploads ([decision
0052](decisions/0052-the-staffs-logo-and-the-icon-made-from-it.md)) are shown to anyone, signed in
or not, so only what Adiutor made itself is ever served:

- **Who:** uploading and removing need `staff:manage` and aren't allowed while signed in as a user;
  each is audited (`brand_logo_changed`, `brand_logo_removed`, `brand_icon_changed`,
  `brand_icon_removed`) and rate-limited (`brandImagesPerUser`: drawing takes the server's time).
- **What's taken:** at most 1 MB (checked in the browser first, and again by the service), then a
  PNG or JPEG by its first bytes, whose header says it's at most 4096 pixels wide and high, before
  anything decodes it. A file mustn't claim one size and decode at a far larger one (a 2 KB JPEG
  can hide a 12000-pixel frame behind bytes some decoders read differently), so a JPEG's header
  is read strictly (`jpegSize`): before its image data only the segments every decoder skips by
  their length and one baseline, extended or progressive frame header, and no other frame header
  before its end; anything else is refused. SVG, which can hold scripts, is never taken. Server actions take bodies of up to 2 MB for it
  (`serverActions.bodySizeLimit`); the proxy already reads up to 10 MB.
- **What's kept and served:** the image drawn again as a PNG with `ImageResponse`, never the
  uploaded file, so a JPEG's location or a PNG's text never leaves the server, and an image that
  doesn't decode (drawn empty, `isBlankPng`, or one the drawing can't read) is refused.
- **How it's served:** `/branding/logo` and `/branding/icon` are public paths (`PUBLIC_PATHS`)
  under a fixed policy that runs nothing (`IMAGE_FILE_POLICY`, set by the proxy through
  `filePolicyFor`; only the browser's own image viewer may style itself), with `nosniff`.
  A request reads an image's ID; its bytes are kept per ID once read, and each version of the icon
  is drawn once per process and size, with requests that come meanwhile waiting for that drawing,
  so asking again with any `?v=` costs a small read of the database, never another drawing. Initials are drawn only from letters
  the built-in font has: for any other, `ImageResponse` would fetch a font from Google Fonts, so
  the server never contacts it (a test fails if drawing initials fetches anything).

## Where email goes

A staff Admin sets the mail server on the Integrations tab of Settings, unless the server's environment
names it (see [Sending email](deploying.md#sending-email) and
[decision 0045](decisions/0045-mail-server-in-settings.md)). Whoever controls the mail server can
read every sign-in link, password reset link and emailed code Adiutor sends, so:

- **Changing it needs the staff Admin's second step from the last 15 minutes**, is in the audit log
  (`smtp_settings_changed`, with the host and port, never the username or password), and is told
  to every staff Admin by email, the one who made it too: their session may be the stolen one, and
  an install with one staff Admin still hears of it. That email goes straight away through the
  mail server in use before the change, as the save read and locked it, one staff Admin at a time
  (`tellStaffAdminsOfMailServerChange` in `src/server/smtp/`), which the new one can't hold back;
  only when there was none, or it fails within its time limit, is it queued (`smtp-changed`, for
  that Admin and the ones after), and then it goes through the new one.
- **The password is sealed** like the storage's secrets (`sealSecret`), never sent back to a
  browser, and kept only for the server, port and username it was saved for (`secretToSave`), so a
  staff Admin can't point a saved password at a host of their own.
- **A mail server is tried before it's saved:** a test email goes through it to the staff Admin
  saving it (`sendThrough`, with the send time limits). A failure is named by its kind only
  (`smtpFailureOf`, through `checkBeforeSaving`): couldn't connect, timed out, couldn't secure the
  connection, refused the login, an address or the email, never what the server replied. The tries
  are limited per staff Admin (`smtpTestsPerUser`).
- **In production a connection must be secured** (TLS, or STARTTLS that must succeed), except to a
  mail server on this computer (`smtpProblems`), as `SMTP_URL` must.
- **A staff Admin can make the server connect to any host it reaches**, as with a storage. An
  operator who doesn't want that sets `SMTP_URL`, which the tab then only shows, without its
  password.

## Where attached files are kept

A staff Admin chooses the storage on the Integrations tab of Settings, unless the server's
environment does (see [Attachments](deploying.md#attachments) and
[decision 0044](decisions/0044-attachments.md)):

- **Secrets are encrypted** (the S3 secret key, the SFTP password or private key) with Better
  Auth's `symmetricEncrypt` and the versioned auth secrets (`sealSecret` in
  `src/server/sealed-secrets.ts`, which any setting with a secret uses), never sent back to a
  browser, and kept only for the place they were saved for (`secretToSave`): another S3 service or
  access key, or another SFTP server, port, user or host key, must be given them again, so a staff Admin
  can't point a saved password at a host of their own. A bucket's name must follow S3's own rules
  (`S3_BUCKET_PATTERN`), since it becomes part of the host name a bucket is reached at.
- **A storage is tried before it's saved** (`checkStorage`, through `checkBeforeSaving` in
  `src/server/check-before-save.ts`), with the staff Admin's second step from the last 15 minutes
  (`needsRecentConfirmation`), at most 20 times an hour, and in the audit log
  (`attachment_storage_changed`, with the driver and its place, never a secret). A failure is told
  and logged by its kind only (`StorageError`): unreachable, refused, host key, not found and so
  on, never what the server replied.
- **A folder is Adiutor's only on purpose** (`setUp` on `FileStorage`): the marker file that every
  store, read and delete needs is written only by the test before saving, or by a staff Admin's
  **Set up this folder** for a folder the environment chooses (`setUpStorage`: the same
  confirmation, limit and test, in the audit log as `attachment_storage_set_up`), never by an
  upload. A server started without its volume refuses files instead of keeping them on a disk that
  goes away, and the `attachment-files` job leaves such a folder alone instead of marking files
  deleted.
- **SFTP checks the host key** against the fingerprint given, on every connection.
- **Saving a storage connects to whatever address it names**, from the server: a server of your own
  on the local network needs this. An operator who doesn't want staff Admins to choose sets the
  storage in the environment, or `ATTACHMENTS_STORAGE=off`.

## Webhooks' addresses

A webhook's address is typed by a staff Admin and the server connects to it, so without a check it
could reach what only the server reaches: a database's admin page, another service on the local
network, or the cloud's metadata service and the credentials it hands out. So
(`src/server/webhooks/address-guard.ts` and `send.ts`):

- **The address:** `https://`, or in production `http://` only on this computer (as for the app's
  own address, `isSecureOrLocalUrl`); no user name or password; at most 2,048 characters
  (`webhookUrlProblem` in `src/lib/webhooks.ts`).
- **Never inside Adiutor's network:** every address a host name resolves to is checked in the
  request's own lookup (`guardedLookup`), so the address that's checked is the one connected to: a
  name that resolves to a public address for one look-up and an internal one for the next can't slip
  through. An IP address in the URL, which is never looked up, is checked before connecting, as the
  URL parser writes it (so `http://2130706433/` is `127.0.0.1`). Refused, unless the operator
  allowed the network (`WEBHOOK_ALLOWED_NETWORKS`, see [Webhooks](deploying.md#webhooks)): private,
  loopback, link-local, shared (CGNAT), multicast, reserved, documentation and benchmarking ranges,
  in IPv4 and IPv6 (unique local and link-local addresses included), and an IPv4 address written
  inside IPv6 (`::ffff:…`, NAT64's `64:ff9b::…`) is judged as the IPv4 it holds, never by an
  allowed IPv6 range (each allowed range holds its own family only). A name with any internal
  address is refused as a whole.
- **What's sent and read:** a signed `POST` that follows no redirect, goes through no proxy, gives up
  after 3 seconds when the connection doesn't open and after 10 in all (look-up, connection,
  encryption and the answer's headers), and reads at most 4 KB of the answer, which it drops. Only the status, the time it took and a kind of failure
  are kept, never what the receiver answered, so a webhook can't be used to read a page.
- **Logs** name a delivery and its kind of failure, never the address, which can hold a token.

## Provider tokens aren't kept

Refresh and ID tokens are never stored, nor the access tokens of
providers that can't prove MFA (Google). A provider that can (GitHub) keeps its access token only
until the request that stored it has checked the account's two-factor authentication
(`withoutKeptTokens` in `src/server/auth/auth-events/provider-accounts.ts`; when connecting from the Security page, the
user comes from the signed session cookie; the `leftover-provider-tokens` job, every 5 minutes, clears any a refused sign-in left).
The app never calls their APIs later, so a leaked database holds no tokens for users' provider
accounts.

## Lock order

Changes to people and their rights run in transactions at Postgres's default READ COMMITTED, which
hold their locks only for SQL: emails are rendered and sent after commit (see
[How emails leave the app](email.md#how-emails-leave-the-app)). Those that can cross each other
take their row locks in one order, skipping what they don't need, so they take turns instead of
deadlocking:

1. `company` rows, `FOR NO KEY UPDATE`, in ID order: the companies whose last active Admin the
   change could take away (`changeMembership` in `src/server/people/members.ts`, and `soleAdminOf`
   in `src/server/people/user-admin/` when deactivating or deleting an account). Deactivating or
   reactivating a company updates its row, so it takes turns with them too, and so does renaming
   one (`updateCompany`, whose audit event names what it replaced as read under that lock, so two
   renames at once record a chain); inserts that only point at the company (memberships,
   invitations, audit events) don't wait.
2. `user` rows, in ID order, in one statement: the staff, the target and the actor `FOR UPDATE`
   (`setStaffRole` in `src/server/people/staff.ts`); the user and, for a staff Admin, the other
   active staff Admins `FOR UPDATE` (`soleAdminOf`); the user `FOR UPDATE` when reactivating an
   account (`reactivateUser` in `src/server/people/user-admin/`); the actor and the target `FOR SHARE`
   (`changeMembership`); the actor `FOR SHARE`, plus the user being added for `addMember`
   (`assertStillManages` in `src/server/access.ts`: creating, resending and revoking invitations
   and invite links, `addMember` and `registerCompany`), plus the staff members a change assigns to
   a request (`changeAssignees`, so a role change, deactivation or deletion of one of them takes
   turns with being assigned) and the people a change subscribes to one (`changeSubscribers`, for
   the same reason); the link's creator `FOR KEY SHARE`
   (`claimInviteLink` in `src/server/people/invite-links/claim.ts`, before it uses the link up), or
   `FOR SHARE` with their rights checked again when a claim is undone because its email couldn't
   be sent (`undoClaim` there, so a link is never freed for a creator who lost their rights
   meanwhile); the staff
   member and the user `FOR SHARE` (`startImpersonation` in `src/server/auth/impersonation.ts`, so
   a role change or deactivation of either takes turns with signing in as the user, which then
   decides again with the locked rows).
3. `membership` rows: the actor's own in the company `FOR SHARE` (`assertStillManages`; none for
   an internal request, which has no company and where only the staff role counts:
   [decision 0048](decisions/0048-internal-requests-have-no-company.md)), then
   the membership of the person a request is raised for `FOR SHARE` (`assertStillRaisableFor`, so
   a change of their role or their removal takes turns with raising it), the company's
   `FOR UPDATE` (`changeMembership`).
4. `invite_link` rows: the link a claim uses (or frees again when its email couldn't be sent, before
   it revokes the claim's invitation under the per-address lock), the links whose creator loses
   their rights (`revokeInvitesWithoutManager`), and the link a resend re-points to the new
   invitation (`resendInvitation`, so an invitation from a link stays one).
5. The `rate_limit_bucket` rows a link claim counts against, the creator's and then the
   company's (`assertClaimLimits`). Only claims count inside their transaction; every other
   limit is counted before its transaction starts, so nothing waits for these while holding locks.
6. The per-address advisory locks (`lockInvitationsOf` in `src/server/people/invitations/locks.ts`), in
   key order when there are several (`revokeInvitationsTo` for a deleted account), then
   `invitation` rows. Removing someone from a company or the staff, and deleting an account, take
   them last among their locks, after any invite links (`revokeInvitationsTo` comes after
   `revokeInvitesWithoutManager`). The invitations the person sent were revoked just before,
   without these locks; they could only cross an invitation to the same address if the person had
   invited their own address, which the deadlock backstop below covers.
7. The `requests.last_number` row of `setting` (`incrementSetting`, which `raiseRequest` in
   `src/server/requests/` calls right before it stores the request, so nothing waits for a number
   longer than the insert takes), then `request` rows,
   `FOR NO KEY UPDATE`: the request a reply or a change is about (`changeRequest`). Every change
   to a request starts with `assertStillManages`, so it has its `user` and `membership` locks
   (steps 2 and 3) before the request's: deleting an account locks the user first and then
   clears them from the requests and entries they wrote, in the same order. Taking someone off the
   requests they're assigned to when they stop working on requests (`unassignFrom`: a staff role
   without request work, a deactivation, a deletion) locks those requests in ID order, after the
   person's user row and any invitation locks of the same change. Ending someone's subscriptions
   when they lose access (`unsubscribeFrom`) comes last in its change too, and locks no request:
   it deletes the person's own rows in `request_participant`. A removal from a company only shares
   the person's user row with a change that subscribes them, so a row can be left behind when both
   happen at once; who is subscribed is read with `loadSubscribers`, which leaves out whoever
   can't read the request (see [Subscribing](requests.md#subscribing)). The request's company
   is read there, never locked (it would come first, step 1): a change refuses when that read
   finds the company deactivated, which leaves the rest of its transaction for a deactivation to
   slip in before it.
8. A `webhook` row, `FOR NO KEY UPDATE`, then its `webhook_delivery` rows: a change to the webhook
   (`src/server/webhooks/manage.ts`; turning it off cancels its pending deliveries) and recording a
   delivery's attempt (`src/server/webhooks/deliver.ts`, after the send). Nothing above
   locks a webhook: a request change only reads which webhooks hear of it, and a new delivery's
   foreign key takes `FOR KEY SHARE`, which doesn't wait for `FOR NO KEY UPDATE`.
9. Sessions and audit events, last.

The other rows of `setting` (the staff's settings and setup's) are locked by settings changes
(`writeSettings`, `FOR UPDATE` in key order, with the rows a check compares them with) and by setup,
which adds `setup.completed_at` before it touches any user row; no change locks them after anything
above, so they take turns only with each other.

What a change decides on (how many Admins are left, the acting user's own rights) is read in a new
statement once the locks are held, so it sees whatever the transaction before it committed. The
rights re-check (`assertStillManages`) is the first statement of its transaction, before the
per-address lock: a change to the actor's rights locks or writes their rows more strongly, so it
either waits for the request (and its revoke sees what the request created) or the request waits
for it (and is refused). The invitations of someone who loses their rights are revoked links
first, then invitations (`revokeInvitesWithoutManager`), so a link claimed at that moment leaves no
open invitation. A deadlock stays possible in rare cases, as a backstop only: Postgres ends one of
the transactions, which changes nothing, and `runAction` (`src/server/action-result.ts`, via
`isDeadlock`) tells the user "Someone changed this at the same moment. Try again." A bulk invite
(`inviteManyByEmail`) runs one transaction per address, so it reports that for the one address and
goes on with the others, keeping the results of those already sent. Both log a warning, without
request details.

## Security headers

Set in `next.config.ts`: `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` and HSTS; no `X-Powered-By`.

## Content Security Policy

The policy (`src/lib/request/csp.ts`, set per request by `src/proxy.ts`): only scripts
carrying that response's nonce run (`'strict-dynamic'`, no `'unsafe-inline'`; `'unsafe-eval'` in
development only), and inline event handlers never do (`script-src-attr 'none'`), so injected
markup can't run script. Next.js adds the nonce to its own scripts; the root layout reads it
(`x-nonce`) for the theme script. Reading it makes every page render per request, with an empty
static shell (`instant = false` on the root layout only turns off Cache Components' empty-shell
check). Styles keep `'unsafe-inline'` (React and Radix use `style` attributes). Media load only
from Adiutor itself and the page's own `blob:` addresses (`media-src 'self' blob:`): a video played
in the attachments' viewer, and the hidden video a frame is drawn from when someone attaches one,
which never plays. The logos and icons
the proxy skips (`/brand/`, `/favicon.ico`) get a fixed policy that runs nothing
(`IMAGE_FILE_POLICY`, from `next.config.ts`), as do the files it serves (`filePolicyFor`:
attachments get `FILE_POLICY`, the brand's images `IMAGE_FILE_POLICY`);
the attachments' upload, which the proxy also skips, answers JSON only. One known gap: Next.js's built-in page for errors outside rendering is
prerendered, so its scripts carry no nonce; it still shows its message and Reload button. Raw
HTML (`dangerouslySetInnerHTML`) is a lint error except for the theme script and the brand colours'
`<style>`, and e2e tests fail on CSP violations that pages report (`e2e/support/test.ts`, console
errors and uncaught `EvalError`s).

The brand colours a staff Admin chose reach every page as CSS ([decision
0049](decisions/0049-brand-colours-from-an-accent-and-a-tint.md)), so nothing typed into them may
reach it: a colour is six hex digits when it's saved (`brandColourSchema`) and when it's read back
(the registry gives the fallback for anything else, `loadBrandColours` checks again), the CSS holds
only colours `derivePalette` worked out and wrote in hex, and `paletteCss` checks every value once
more before it writes a declaration (emails' colours too, in `emailColoursOf`). `derivePalette`
takes anything that isn't six hex digits as the theme's own and caps its search for the accent's
lightness, so no stored value can hang a page or an email, and a page whose palette can't be worked
out keeps the theme's colours (`pageBrandCss`, logged without any value).

Permission checks (the authorization matrix, and pages protected by default) are described under
[Roles and permissions](companies-and-roles.md#roles-and-permissions).
