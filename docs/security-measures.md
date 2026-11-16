# Security measures

How the app records security events, limits abuse and protects tokens and pages. To report a
vulnerability, see the [security policy](../SECURITY.md). Back to the [documentation](README.md).
The reasons behind the trust and confirmation rules are in the decision records
[0002](decisions/0002-trusted-provider-email-addresses.md) and
[0004](decisions/0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md).

## Audit log

The audit log (`audit_event`, `src/server/audit.ts`) records sign-ins (one per sign-in; failed ones; and
right passwords whose sign-in then asked for the code, recorded without an actor), wrong second-step
codes (on the step-up page, and at the code step of a sign-in without an actor), MFA changes,
password and provider changes, wrong current passwords typed in a signed-in session
(`password_check_failed`), revoked sessions, account deactivation, reactivation and deletion,
MFA resets, role changes, removed members, invitations and invite links, company changes, and staff
signing in as a user (`impersonation_started`, with the optional reason the staff member gave, and
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

Better Auth's own limits (per IP address) are stored in the database
(`rate_limit`), so they hold across restarts and instances. On top of those, per email address
whether or not it has an account: 10 wrong passwords per 15 minutes, 5 email links and 5 password
resets per hour, and per user 5 emailed codes and 5 wrong step-up codes per 15 minutes
(`src/server/auth/auth-guards/`). Emailed codes also wait for each other: one per user every 2.5
minutes, half a code's lifetime (`EMAIL_CODE_RESEND_SECONDS`), checked first so a refused one
doesn't count, and ended once a code is used. Setting up email codes waits too, but isn't counted
towards the 5, so it doesn't eat into the sign-in budget. Each password sign-in takes one of the address's attempts before
its password is checked and gives it back unless the password was wrong, and each step-up code
takes one of the user's attempts the same way, so requests sent at the same moment can't all get
through and successful ones don't count. Since anyone can type wrong
passwords for an address, reaching the limit only pauses password sign-in: the message (the same
for every address) points to email links, passkeys and a password reset, and proving the inbox
lifts the pause (a completed reset, or creating an account from an invitation). The owner gets a
security email if the account has a password. Wrong current passwords typed while signed in
(changing the password, deactivating the account) are limited to 5 per 15 minutes per user, in a
bucket of their own (`checkCurrentPassword` in `src/server/auth/current-password.ts`): Better Auth's
per-IP limiter doesn't run for its calls from server actions, so a signed-in (possibly stolen)
session can't guess the password without limit, and since the bucket isn't the address's sign-in
one, it can't pause the owner's password sign-in either. Each check takes an attempt first and
gives it back unless the password was wrong, and each wrong one is recorded. The app also limits invitations (per user and per company),
role changes (30 an hour per user, company and staff roles together; each one emails the member,
and removals aren't counted, see
[Changing roles](companies-and-roles.md#changing-roles-and-removing-people)),
invite-link claims (per IP address), verification emails (per user), starting to sign in as a user
(10 an hour per staff member, `RATE_LIMITS.impersonationsPerUser`, since each start emails the
user), sign-in link pages
opened with a link that can't be used (20 per 15 minutes per IP address, so links can't be
guessed by looking them up; past it, the page offers no way to continue), wrong secrets sent to
the background jobs' endpoint (20 per 15 minutes per IP address, `RATE_LIMITS.jobTickMissesPerIp`;
past it the endpoint answers 429, while the right secret still works), work on requests (per
user and hour: 60 requests raised, 200 replies and 300 changes of a status or of details;
`RATE_LIMITS.requestsPerUser`, `requestRepliesPerUser` and `requestChangesPerUser`, far more than
anyone does by hand and few enough to stop a flood), and the errors stored for
admins (see [Recorded errors](#recorded-errors)). All are kept in
`rate_limit_bucket` (`src/server/rate-limit.ts`), with a clear "Try again in N minutes" message.
A claimed invite link also counts as an invitation its creator sends, against their limit and
the company's (or the staff's), in the claim's transaction once the link is used up
(`assertClaimLimits` in `src/server/people/invite-links.ts`): past either, the claim is refused
with "This invite link can't be used right now. Try again later." and rolls back, so the link
stays unused and nothing is counted. Invite links therefore can't send more invitation emails
than the limits allow, however many IP addresses claim them.

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
`/join/…` and Better Auth's `/api/auth/reset-password/…` are stored with `[token]`). The log line
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
(`refuseWhileSignedInAs` in `src/server/auth/auth-guards/`). The session is the staff member's, so
an endpoint would act on their own account (see
[Signing in as a user](authentication.md#signing-in-as-a-user)).

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
`/magic-link/verify` (after the confirmation page) and `/sign-in/social`; `callbackURL` and
`errorCallbackURL` on `/link-social`; `redirectTo` on `/request-password-reset`; and `callbackURL`
on `/reset-password/:token` (the link in a reset email, which Better Auth sends on to it with the
token or an error), `/verify-email` and `/send-verification-email`. A test walks the endpoints the
browser can reach (`BROWSER_AUTH_PATHS`) and fails when one takes a return address that isn't
checked (`request-checks.test.ts`); the two it lets through, `/sign-in/email` and `/sign-out`, take
a `callbackURL` that Better Auth never sends the browser to here. Fields that aren't sent are fine. A refused
request gets `UNSAFE_RETURN_ADDRESS` (`src/lib/sign-in/sign-in-refusals.ts`); a refused link the
browser opened goes to the sign-in error page, which explains it. The app's own pages only send
relative paths that pass: the redirect targets they read from the URL go through
`getSafeRedirectPath`, which applies the same rules and falls back to the dashboard.

## Tokens

Invitation and invite-link tokens, and Better Auth's reset, welcome and magic links and
emailed codes, are stored as SHA-256 hashes (sign-in links with the app's own hasher,
`hashEmailLinkToken` in `src/lib/sign-in/tokens.ts`, so the page they open can look them up).

Emails are sent after the response, so no answer waits for the mail server, whether or not the
address has an account. What's left of the difference is Better Auth's own work before it answers
a password reset request: it stores the link's token for an address with an account and does a
lookup in its place for one without, a few milliseconds either way.

Session cookies are signed, so the database alone gives no usable session; see
[Sessions](authentication.md#sessions).

## Names

Display names, company names and the staff name end up in emails the app sends from its own domain
(an invitation's subject quotes the inviter's name), so `withNameSafety` in `src/lib/validation.ts`
refuses line breaks and control characters, characters that hide or reorder text (text direction
controls, zero-width spaces, U+FEFF, line and paragraph separators; the zero-width joiners that
Persian, Arabic and Indic names need stay allowed), and web addresses. The web-address check reads
a copy without format characters, normalised with NFKC and with look-alike full stops (`。`, `．`,
`․`) as `.`, and matches domains in any script and IPv4 addresses, while initials such as
`J.R.R. Tolkien` and `Adiutor B.V.` pass. It's a denylist, so it can't catch every way of writing an
address (`adiutor-login dot com`); it stops the ones mail clients turn into links. Passkey names
follow the same character rules and are at most 64 characters (`passkeyNameSchema`), checked by the
auth guards where Better Auth's passkey plugin takes them.

## Provider tokens aren't kept

Refresh and ID tokens are never stored, nor the access tokens of
providers that can't prove MFA (Google). A provider that can (GitHub) keeps its access token only
until the request that stored it has checked the account's two-factor authentication
(`withoutKeptTokens` in `src/server/auth/auth-events/provider-accounts.ts`; when connecting from the Security page, the
user comes from the signed session cookie; the hourly job clears any a refused sign-in left).
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
   reactivating a company updates its row, so it takes turns with them too; inserts that only
   point at the company (memberships, invitations, audit events) don't wait.
2. `user` rows, in ID order, in one statement: the staff, the target and the actor `FOR UPDATE`
   (`setStaffRole` in `src/server/people/staff.ts`); the user and, for a staff Admin, the other
   active staff Admins `FOR UPDATE` (`soleAdminOf`); the actor and the target `FOR SHARE`
   (`changeMembership`); the actor `FOR SHARE`, plus the user being added for `addMember`
   (`assertStillManages` in `src/server/access.ts`: creating, resending and revoking invitations
   and invite links, `addMember` and `registerCompany`); the link's creator `FOR KEY SHARE`
   (`claimInviteLink` in `src/server/people/invite-links.ts`, before it uses the link up); the staff
   member and the user `FOR SHARE` (`startImpersonation` in `src/server/auth/impersonation.ts`, so
   a role change or deactivation of either takes turns with signing in as the user, which then
   decides again with the locked rows).
3. `membership` rows: the actor's own in the company `FOR SHARE` (`assertStillManages`), the
   company's `FOR UPDATE` (`changeMembership`).
4. `invite_link` rows: the link a claim uses, the links whose creator loses their rights
   (`revokeInvitesWithoutManager`), and the link a resend re-points to the new invitation
   (`resendInvitation`, so an invitation from a link stays one).
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
7. The `request_counter` row (`raiseRequest` in `src/server/requests/`, right before it stores the
   request, so nothing waits for a number longer than the insert takes), then `request` rows,
   `FOR NO KEY UPDATE`: the request a reply or a change is about (`changeRequest`). Every change
   to a request starts with `assertStillManages`, so it has its `user` and `membership` locks
   (steps 2 and 3) before the request's: deleting an account locks the user first and then
   clears them from the requests and entries they wrote, in the same order. The request's company
   is read there, never locked (it would come first, step 1): a change refuses when that read
   finds the company deactivated, which leaves the rest of its transaction for a deactivation to
   slip in before it.
8. Sessions and audit events, last.

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
check). Styles keep `'unsafe-inline'` (React and Radix use `style` attributes). The logos and icons
the proxy skips (`/brand/`, `/icon.svg`) get a fixed policy that runs nothing
(`next.config.ts`). One known gap: Next.js's built-in page for errors outside rendering is
prerendered, so its scripts carry no nonce; it still shows its message and Reload button. Raw
HTML (`dangerouslySetInnerHTML`) is a lint error except for the theme script, and e2e tests fail
on CSP violations that pages report (`e2e/support/test.ts`, console errors and uncaught `EvalError`s).

Permission checks (the authorization matrix, and pages protected by default) are described under
[Roles and permissions](companies-and-roles.md#roles-and-permissions).
