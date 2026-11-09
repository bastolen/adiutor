# Sign-in and accounts

How people sign in, how sessions work, and what users manage on their account pages. Second
steps are in [Multi-factor authentication](mfa.md), the protections around sign-in in
[Security measures](security-measures.md). Back to the [documentation](README.md).

## Sign-in methods

On `/auth`: email and password, passkey, magic link, and the OAuth providers
in `OAUTH_PROVIDERS` (`src/lib/sign-in/oauth-providers.ts`: GitHub and Google), each shown when its
credentials are set in `.env`. Saved passkeys are also offered in the browser's
suggestions for the email field. The method used last in that browser is marked "Last used" (Better
Auth's `lastLoginMethod` plugin, a cookie only). OAuth callback URLs are
`<BETTER_AUTH_URL>/api/auth/callback/<provider ID>`, e.g. `.../callback/github`. Adding a provider
is listed in the file comment of `src/lib/sign-in/oauth-providers.ts`.

Someone who opens `/auth` while signed in goes on to the page asked for (`callbackURL`, when it's
a page of the app: on the site and not under `/api`) or the dashboard (`signedInPath` in
`src/lib/redirect.ts`): switching accounts means signing out first. A deactivated account counts
as signed out and gets the form.

## Email links

A magic link email opens a confirmation page (`/auth/email-link`, `src/lib/sign-in/email-link.ts`); only
its "Continue signing in" button uses the link, so business mail scanners that open links to check
them don't use it up or get a session. Better Auth's own link (`/api/auth/magic-link/verify`)
opened any other way in a browser (an old email, another site, a script) is sent to that page
first, unused (`src/server/auth/auth-guards/`, from the browser's `Sec-Fetch-Site` and
`Sec-Fetch-User` headers), so a crafted link can't sign someone into another account without a
click. The page names the account the link signs in to, looked up without using the link
(`getEmailLinkPreview` in `src/server/auth/email-links.ts`), so a link someone sent you for their own
account is easy to spot: its name, and its full address, which users can't choose or change
(anyone can give themselves someone else's name). That tells nobody more than the link already
does, since whoever has it can sign in with it. When someone else is signed in in that browser,
it says that continuing switches to the link's account (and points out when both have the same
name), which ends the other account's session there as signing out would. If the link stops
working before the click, Better Auth comes back to this page with the reason, not to the
sign-in page, which would send the browser on to the account still signed in. When it's that
account already, Continue goes on without using the link. A link that
expired or was used says so straight away, and its "Go to sign in" keeps where the link would
have gone. The form only gets the link's token in the browser,
so a tool that only fetches the page finds no form that would use it.

A link's return addresses (`callbackURL`, `errorCallbackURL`, `newUserCallbackURL`) must be pages
of the app: never another site, and never an endpoint under `/api`. Otherwise a genuine link for
your own account could go on to `/api/auth/magic-link/verify` with someone else's token, which the
browser opens as part of the same click, signing you in to their account past the confirmation
page. The guards refuse such addresses when the link is asked for and again when it's used
(`isSafeAppRedirect`, see [Auth endpoints](security-measures.md#auth-endpoints)), and the
confirmation page only passes pages of the app on (`getSafeRedirectPath`). The email goes to the
account's stored address, not the address as typed (the lookup ignores case).

## Coming back to where you were

Whenever the app sends someone away and back, the return address keeps where they were: the page,
the sort and page of its tables, and the anchor of the card where they clicked. That covers:

- the step-up page before a change that needs a recent confirmation, also when a server action
  asks for it, e.g. **Resend** on a staff invitation goes to
  `/auth/verify?callbackURL=%2Fadmin%2Fstaff%3Finv-page%3D2%23invitations&for=change`;
- connecting GitHub or Google from the Security page, which returns to `#connected-accounts`;
- the email verification link, which returns to the Profile page's Email card
  (`/account?verified=1#email`);
- signing in again, with every method (password and its code step, passkey, email link,
  provider).

The result message of the last two (verified, connected, or what went wrong) is shown in that
card.

How it's built:

- **Pages.** A page builds its return address from its known parameters with `createPageUrl`
  (`PageUrl.current()`, never the URL as it was) and hands it to `RecentConfirmationProvider` as
  `returnTo`.
- **Controls.** A control adds the anchor of the card it's in (`useSectionId`, from `Card`'s
  `id`). Client code reads the result from `useRecentConfirmation()`. Forms send it in a hidden
  `returnTo` field (`ReturnToField`: `RowAction`, `ActionDialog` and `RoleSelect` include it).
- **Server actions.** An action that must send the user to confirm first reads that field with
  `confirmChangeUrlFor(formData, fallback)` (`src/lib/sign-in/confirm-url.ts`).
- **Arriving.** The card lands the user on it (see [Design](design.md#design-and-accessibility)).

An anchor is kept only when it names a section, with `isSectionId` in `src/lib/redirect.ts`:
lowercase letters, digits and hyphens, starting with a letter, at most 64 characters, and not
`top`.

- `getSafeRedirectPath` drops any other fragment and keeps the page, for example a text fragment
  (`#:~:text=…`, which scrolls to and highlights text of the attacker's choosing) or `#100%`
  (which Next.js can't decode). Whitespace, control characters or backslashes anywhere, the
  fragment included, still send the user to the dashboard.
- `isSafeAppRedirect` refuses such fragments at Better Auth's endpoints.
- The return address is always encoded inside `callbackURL` (`%23`), so its query and anchor
  stay together.
- Better Auth puts what it adds (`error=…`, `token=…`) in the query, before the anchor, with
  `URL` or `appendQueryParams`.

The server never sees a URL's fragment. When the proxy sends a signed-out visitor from
`/admin/staff#invitations` to the sign-in page, the browser keeps the anchor on the sign-in
page's own address (`/auth?callbackURL=%2Fadmin%2Fstaff#invitations`). The sign-in form adds it
to `callbackURL` when that has none. `/auth` opened while signed in needs nothing: the browser
carries the anchor over the redirect. Redirects to the step-up page from `getActor()` while a
page renders keep only the page (`PATHNAME_HEADER`). They happen when a page is opened, not after
a click, so there's no card to come back to.

## When signing in fails

When signing in fails with nowhere to go back to (a GitHub or Google sign-in that took too
long or was started in another tab, an account that couldn't be connected), Better Auth sends
people to `/sign-in-error` (`onAPIError.errorURL` in `src/lib/auth.ts`, public in
`src/proxy.ts`). Built like the 404 page, it explains what happened in plain words, in the reader's
language (`src/app/sign-in-error/messages.ts`, never the error code itself), offers "Sign in again" and
"Go back", and shows a reference such as `7KQ2-M9XD` with the time, which users can copy and
send to an administrator (`ErrorReference`, the box the app's other error pages show too; see
[Looking up an error reference](deploying.md#looking-up-an-error-reference)). `recordSignInError` (`src/server/auth/sign-in-errors.ts`) logs one line,
`Sign-in error 7KQ2-M9XD: state_mismatch`, and stores the reference with Better Auth's code
and description and the signed-in user, if any, in the `sign_in_error` table for 7 days
(`SIGN_IN_ERROR_RETENTION_DAYS`), at most 20 per IP address per hour. To look a reference up,
search the server log for it, or query `sign_in_error` by `reference`; there's no screen for it
yet.

## How refusals reach the user

Every refusal of a sign-in, or of a change to how someone signs in, carries an error code: Better
Auth's own, or one of the app's (`src/lib/sign-in/sign-in-refusals.ts`). Forms turn the code into a
message in the reader's language with `authErrorText` (`src/lib/sign-in/auth-error-messages.ts`,
with the messages in `auth.codes` of the [catalogues](i18n.md)), so Better Auth's English, written
for developers, never reaches the user:

1. A refusal whose message has details only the server knows (`SERVER_WORDED_CODES`: how long a
   pause or a limit lasts, `PASSWORD_SIGN_IN_PAUSED` and `TOO_MANY_ATTEMPTS`; which providers to
   sign in with, `RESET_ENDS_PROVIDER_MFA`) is worded by the auth guards in the request's language
   (its language cookie, else Adiutor's default language, noted once as the guards start:
   `noteRefusalLocale` in `src/server/auth/auth-guards/refusal-messages.ts`), and the form
   shows it as it comes, e.g. "Too many attempts. Try again in 12 minutes."
2. Any other code with a message of its own gets that message.
3. Any other rate limit, such as Better Auth's per-IP limit, gets "Too many requests. Wait a few
   seconds and try again."
4. Anything else gets the form's own fallback ("Sending the link failed. Please try again.") or
   "Signing in failed. Please try again."

The guards word the other refusals they throw in the request's language too, for clients other
than the app's forms. A code in the URL (`?error=` after a GitHub or Google sign-in or an email
link) gets its message from `signInErrorText`, a refused "Confirm with GitHub" on the step-up page
from `reverifyErrorText`, and the sign-in error page tries the provider errors first
(`src/app/sign-in-error/messages.ts`). The Security page's forms use the same functions
(`authErrorText`, `signInChangeRefusalText`), so a refused change there reads the same as on the
sign-in pages. Client components that show these messages need the `auth` namespace from their
page (`ClientMessages`).

## Automatic linking

Signing in with a GitHub or Google account that isn't connected yet
connects it to the Adiutor account with the same email, when the provider verified the
address. An Adiutor address that wasn't verified yet (registered by staff, welcome link not
used) is then marked verified; there's no public sign-up, so nobody else can have set up that
account in advance. A GitHub or Google account that's already connected always signs in to the
Adiutor account it's connected to, whatever its email. The next page says so, naming the
account, with a link to the Security page to
disconnect it ("Not you?", `ProviderLinkedNotice`, from a short-lived cookie, removed when
someone signs out or another sign-in starts on that browser, so the next person there never
sees the name), and a security
email is sent. If the account already had a second step that can confirm sessions, the new
connection signs in like an email link but doesn't count as MFA, or on the step-up page, until
the user confirms it on the Security page within 15 minutes of confirming with that step
(`account.confirmed`, set by
`beforeAccountCreate` in `src/server/auth/auth-events/provider-accounts.ts`). So whoever controls the inbox can't get
past the existing second step this way. "Confirm with GitHub" on the step-up page never links
an account: it only takes your own confirmed GitHub account, and refuses any other before
anything is connected (see ["Confirm with GitHub" only takes your own GitHub account](mfa.md#confirm-with-github)). When it
signed in with your own account but didn't confirm the session, the page the user lands on
(back on the step-up page, the Security page to set up MFA, or the page they came for) says
why: two-factor authentication is off for that GitHub account, or GitHub couldn't be checked
just now (`ProviderStepUpNotice`, from a short-lived cookie set by `recordProviderSession` that
names the provider and the reason, never the account; removed once the session is confirmed,
when someone signs out, or when another sign-in starts on that browser). Such an attempt takes
nothing away: the new session Better Auth creates for it keeps the confirmation the browser's
session had, as it was, so it opens no new 15 minutes for changing sign-in methods either
(`beforeSessionCreate`). Only GitHub's 2FA confirms it afresh, and even that opens a new 15
minutes only on an account without a passkey or an authenticator app (see
[Confirm with GitHub](mfa.md#confirm-with-github)).

Trusting the provider's verified address is a deliberate choice: people registered by staff or
invited can sign in with GitHub or Google without setting anything up first. The provider's
address is trusted for exactly that, finding the Adiutor account with the same address and
marking it verified, never for anything about a connected account. The remaining risk: "verified"
only means that someone verified the address at GitHub or Google once, and neither checks it
again. Someone who once verified the address there but no longer has the inbox (a former employee
with their work address on a personal GitHub account, a shared address such as
`support@adiutor.dev` that changed hands) can sign in to the Adiutor account that has it, which
for an account without a second step is the whole account. What limits it:

- The owner is told: the next page names the connected account with a link to disconnect it, and
  a security email goes to the address (`provider_connected`).
- On an account with a second step that can confirm sessions, the new connection stays
  unconfirmed until the owner confirms it (see above): it can't get past that step.
- An Admin's MFA reset on the user's detail page disconnects all their GitHub and Google
  accounts, confirmed or not, for when one that isn't theirs became their only second step (see
  [Locked out](mfa.md#locked-out)).
- A deactivated account gets nothing connected (see [Deactivated accounts](#deactivated-accounts)).

## Sessions

Better Auth stores session tokens as they are, but only accepts a session cookie
whose signature (made with `BETTER_AUTH_SECRET`) checks out, and so do the app's own session
lookups (`signedSessionToken` in `src/server/auth/signed-session.ts`): the database alone gives no usable
session. A session lasts a fixed 7 days from the sign-in and isn't extended while it's used
(`disableSessionRefresh` and `SESSION_LIFETIME_SECONDS` in `src/lib/auth.ts`): pages render where
cookies can't be set, so an extended session would outlive its cookie. When Better Auth replaces
the signed-in session with a new one for the same sign-in (changing the password with other
devices signed out, turning two-step verification off, or the code that turns it on), the new
session keeps the old one's sign-in time and end (`beforeSessionCreate` in
`src/server/auth/auth-events/session-hooks.ts`, only from the same user's session), so a replacement never
renews a session or makes it pass for a recent sign-in (the one-hour rule,
`needsFreshSignIn`). Its cookie still lasts 7 days from when it's set; outliving the row is
harmless, since the row decides. Turning off two-step verification that's off already is
refused (`TWO_FACTOR_ALREADY_OFF`), since it would only replace the session.

## Signing out

Signing out removes every cookie the browser sends, except the "Last used" sign-in method and the
language (`cookiesToClearAtSignOut` in `src/lib/sign-in/auth-cookies.ts`, applied by
`afterAuthRequest`; neither says who signed in, and the sign-in page stays in the browser's
language, see [Languages](i18n.md#how-the-language-is-chosen)): the
session, "Trust this device" and anything naming someone (such as the provider-linked notice),
so the next person on that browser starts clean. The browser's trusted device is forgotten too
(`forgetSignedOutBrowserTrust`), so a copy of its cookie no longer skips the code step. Signing a
device out on the Security page ("Sign out" per device, "Sign out other devices") and changing
the password forget every device the user trusted, this browser's included (a session doesn't
say which trusted device is its browser's). Someone else signing in on a browser where
you're still signed in ends your session there the same way, "Trust this device" included
(`replacePreviousSession` in `src/server/auth/auth-events/browser-cleanup.ts`, also when their code step
follows). Like signing out, that's not recorded for you and sends no email: it would show you
their name, IP address or browser.

## Deactivated accounts

Deactivated accounts can't sign in (a Better Auth hook refuses their sessions with "This account
is deactivated. Contact an administrator.", `ACCOUNT_DEACTIVATED`) and count as signed out
everywhere. A GitHub or Google sign-in is refused earlier, with the same message, before Better
Auth connects a new provider account, marks the address verified or stores a token
(`checkIncomingUser` in `src/server/auth/auth-events/reverify.ts`, from `user.validateUserInfo`, after the
re-verify check so a refused "Confirm with GitHub" says nothing about another user): a provider
account can't be planted while the account is deactivated, to sign in once an Admin reactivates
it. They get no sign-in or reset emails, and the invitations and invite links they sent are revoked. So are those
of anyone who loses the right to manage a company or the staff (a role change, removal or
deletion), so a former Admin keeps no way back in. Removing someone from a company or the staff,
or deleting their account, also revokes the open invitations addressed to them there (everywhere,
for a deletion; `revokeInvitationsTo`), so they can't come back through one; a deactivated account
needs nothing more, since it can't accept an invitation. Requests of theirs already under way don't get
around this: sending, resending and revoking invitations, creating and revoking invite links,
adding members and registering companies check their rights again, locked, as the first step of
the transaction (`assertStillManages` in `src/server/access.ts`), and role changes take them from
the rows they lock. So each request comes either before the change, and what it created is revoked
with the rest, or after it, and is refused; a demoted company Admin's queued "make me Admin" too
(nobody raises their own role). A link of theirs claimed at that very moment leaves no open invitation
either: the claim locks the link's creator before the link, so it takes turns with the change (links
are revoked first, then the invitations are read again; see
[Lock order](security-measures.md#lock-order)).

## Account pages

Account pages, two tabs:

### Profile (`/account`)

Change your name and your language (saved with the account, so emails reach you in it and every
browser you sign in on shows it; see [Languages](i18n.md#how-the-language-is-chosen)), and verify
your email with a link sent by email (registered accounts start unverified). A summary shows whether your sign-in is
protected, and **Recent activity** lists the last 20 things that happened to your account
(sign-ins and failed attempts, sign-in method and security changes, memberships and role
changes, saying who made changes for you), with when, and the device and IP address of your
own actions only: not of an admin's changes, nor of passwords typed for your address (wrong
ones, or right ones whose sign-in then asked for the code) and wrong codes typed at that code step
("Wrong two-step verification code entered at sign-in", see
[Two-step verification](mfa.md#two-step-verification)), which may be anyone's (staff see
those in the audit log) (`listOwnActivity` in
`src/server/audit.ts`, worded in your language by `src/app/(app)/account/own-activity.ts`: one
whole sentence per event, with who made the change, if not you, where each language puts it).

### Security (`/account/security`)

- **Passkeys:** add, rename and remove.
- **Two-step verification:** set it up with an authenticator app (QR code drawn in the browser,
  plus the key as text) or email codes (not offered to roles that require MFA); get new backup
  codes; turn it off. Users with a password confirm these changes with it. New passwords need at
  least 12 characters.
- **Keeping MFA:** for roles that require MFA, a change that would take it away is refused, on
  the page (disabled, with the reason) and on the server, also from a page opened before another
  change (`wouldRemoveRequiredMfa`): removing the last passkey, turning off the only
  authenticator app, disconnecting the provider account that gives them MFA, or setting a
  password or connecting another account next to it, or confirming one without two-factor
  authentication (provider MFA only counts while there's no password and every connected account
  has it; each account to confirm is judged on its own); the reasons name the provider. They add a passkey first (to move
  an authenticator app to a new phone too). For every role, a password reset or welcome link
  can't give an account its first password when that would end its MFA (`wouldEndMfa`: provider
  MFA only counts without a password). Otherwise whoever reads the inbox would get past the
  provider's second step with a password of their own. The guards refuse it with
  `RESET_ENDS_PROVIDER_MFA` before Better Auth sets anything, and the reset page names the
  provider and says to sign in with it and set a password here instead (roles that require MFA
  add a passkey or an authenticator app first). Accounts that keep their MFA (a passkey next to
  GitHub) and new accounts without one reset as usual. One such change is made at a time per user
  (`src/server/auth/sign-in-change-lock.ts`, also taken by a reset): two sent at the same moment (removing both passkeys
  from two tabs) can't both pass the check; the second is told to try again in a moment, and
  a provider connected meanwhile waits for confirmation. A first password goes through
  `setFirstPassword` (`src/server/auth/accounts.ts`), since Better Auth's `setPassword` is
  server-only and never reaches the guards.
- **Connected accounts:** connect or disconnect GitHub and Google while signed in; the provider
  account's email may differ from yours. Each account shows its name at the provider (the
  GitHub username, the Google email address: `PROVIDER_ACCOUNT_NAME_CLAIMS` in
  `src/lib/sign-in/oauth-providers.ts`), which also tells several accounts of one provider apart. The
  name is stored when the account is connected and refreshed at every sign-in with it (Better
  Auth hands the provider's profile only to `user.validateUserInfo`, which notes it for the
  account hooks: `noteProviderAccountName` in `src/server/auth/auth-events/provider-accounts.ts`; noting it never
  refuses a sign-in, and only a re-verify with another account than your own confirmed one is
  refused there). Accounts connected before names were stored show none until their next
  sign-in.
  Connecting and disconnecting need a recent
  confirmation (or, without a second step, a sign-in from the last hour), and an email link
  always remains as a way to sign in. Connecting returns to this tab. A connection
  made while signing in that isn't confirmed yet (see [Automatic linking](#automatic-linking)) shows **Confirm** next
  to Disconnect; confirming needs the same as disconnecting (`confirmConnectedProvider`).
- **Password:** set or change it. Changing it needs the current one (`changeOwnPassword` in
  `src/server/auth/accounts.ts`): wrong ones are recorded (`password_check_failed`) and limited
  per user (`checkCurrentPassword` in `src/server/auth/current-password.ts`, see
  [Rate limits](security-measures.md#rate-limits)), since Better Auth's own limiter doesn't run
  for its calls from server actions. Setting a first one needs a recent confirmation next to a
  second step, or without one a sign-in from the last hour, like the changes above
  (`setFirstPassword`).
- **Signed-in devices:** every browser where you're signed in (browser and system, IP address,
  when, and an "MFA Verified" badge when that sign-in had MFA), with "Sign out" per device and "Sign out other
  devices". Both also forget every browser you trusted at the code step, this one included (see
  [Signing out](#signing-out)).
- **Deactivate account:** signs you out everywhere and blocks sign-in until an Admin reactivates
  it; nothing is deleted. Like the changes above, it needs a recent confirmation once the account
  has a second step (starting it without one sends you to the step-up page first). It also needs
  your password, if you have one (wrong ones are recorded and limited, as for changing it), and
  without a password or a second step a sign-in from the last hour (`deactivateOwnAccount` in
  `src/server/people/user-admin.ts`). It's blocked while you're the only Admin of the staff or a
  company, and the card says so with the service's own refusal ("You are the only staff Admin.
  Make someone else an Admin first.", `soleAdminError`); that's checked before the password, so
  the refusal is the same with a right or a wrong one. Only Admins delete accounts.

## Security emails

Security emails (`src/emails/security-notice.tsx`): users get an email when their password is
changed, added or reset, two-step verification is turned on or off, backup codes are renewed, a
passkey or GitHub/Google is added or removed, or they deactivate their own account. It says what
changed, when and from which device. Only these, the user's own changes, name the device and IP
address: `sendSecurityNotice` (`src/server/auth/security-notices.ts`) leaves them out unless it's
given `showDevice: true`, so a new email can't show someone else's by mistake. Changes someone
else makes to their access are emailed too, sent once the change has committed and without the
device or IP address, which would be that person's: an Admin resetting their MFA, signing them
out (or the command line doing so), deactivating or reactivating them; a staff role given, changed
or taken away; a changed company role (`company_role_changed`, naming the company and the new role) and a removal
from a company (`removed_from_company`), except when they made that change themselves (see
[Changing roles and removing people](companies-and-roles.md#changing-roles-and-removing-people));
and the deletion of their account (`account_deleted`, sent to the address the account had). They're also
told when wrong passwords pause their password sign-in (see [Rate limits](security-measures.md#rate-limits)), at most once a day (a
notice that couldn't be sent is tried again at the next pause) and without the device or IP
address, which may be someone else's. Likewise when wrong codes at sign-in pause signing in with a
code (`two_factor_locked`, see [Two-step verification](mfa.md#two-step-verification)): once per
15-minute pause (a notice that couldn't be sent is tried again at the next refusal while it
lasts), also without the device or IP address.
