# Multi-factor authentication (MFA)

Second sign-in steps, who must have them, and when a session counts as confirmed. Back to the
[documentation](README.md).

MFA uses Better Auth's `twoFactor` and `passkey` plugins; the rules are pure functions in
`src/lib/authz/mfa/`. How the Security page keeps it is under
[Security](authentication.md#security-accountsecurity) in Sign-in and accounts.

## Two-step verification

After a correct password, the code step (`/auth/two-factor`) asks
for a code from an authenticator app, or one sent by email (it works for 5 minutes,
`EMAIL_CODE_MINUTES`; sign-in links too, `EMAIL_LINK_MINUTES`). A new emailed code can be asked
for once half the last one's lifetime has passed (2.5 minutes, `EMAIL_CODE_RESEND_SECONDS`): "Send
a new code" counts down until then, at the code step, on the step-up page and while setting up
email codes, and the guards refuse an earlier one (`EMAIL_CODE_SENT_RECENTLY`, shown as a notice,
since the last code still works). The wait is per sign-in or session, as the code is: Better Auth
keeps an emailed code with the sign-in it was asked for (its two-factor cookie), or with the
signed-in session (the step-up page, setting up email codes). So after going back and signing in
again, or in another browser, a code that works is sent at once, instead of a pointer to one that
can't be used there (`limitEmailCode` in `src/server/auth/auth-guards/attempts.ts`, which stores
only a hash of the sign-in's cookie). Using a code ends its session's wait. The 5 codes per 15
minutes per user still apply to all of them together. The code step, and the step-up page when email codes are its only way, send their code once
each time the page is shown, not once in the page's life (pages stay alive; `useOncePerVisit` in
`src/components/ui/use-transient-state.ts`), so a new sign-in gets its own code. **Once an
authenticator app is set
up, email codes aren't accepted any more**, so the inbox alone (which also gets email links and
password resets) can't get past the app. The app adds single-use backup codes, which only work once the app is set up, so an unfinished setup leaves no way in. "Trust this
device" skips the step on that browser until 30 days after the last password sign-in there, as
its label says: each password sign-in that skips the step starts the 30 days again (Better Auth
replaces the trusted device with a new one, and has no setting for it), so a browser where the
password is used at least once every 30 days stays trusted. It's forgotten (the trusted device itself,
not only the browser's cookie, so a copy of the cookie stops working too) when you sign out on
that browser, when you sign out a device or every other device on the Security page, when the
password is changed or reset, when MFA is reset or two-step verification is turned off, when an
authenticator app is added next to email codes, when the account is deactivated, and when someone
else signs in on that browser. Every way of signing a user out (an Admin's sign-out, MFA reset or
deactivation, the Security page, the command line) ends the sessions and forgets the trusted
devices together (`endSessionsOf` in `src/server/auth/sessions.ts`).

Each sign-in takes 5 codes at most. Ten wrong codes in a row at sign-in (`TWO_FACTOR_LOCK_ATTEMPTS`,
across sign-ins and kinds of code; a right code starts the count again) pause signing in with a
code for 15 minutes (`TWO_FACTOR_LOCK_MINUTES`): Better Auth's account lockout, set in
`src/lib/auth.ts` and kept on the account's `two_factor` row (`failed_verification_count`,
`locked_until`). While it lasts every code is refused, even the right one. The owner gets a
security email when it starts (`two_factor_locked`), once per pause and without the device or IP
address that typed the codes, which may be someone else's. Every wrong code at the code step is
recorded as `mfa_failed` with `atSignIn: true` and without an actor, like the password before it:
the user's Recent activity says "Wrong two-step verification code entered at sign-in" without a
device or IP address, and staff see both in the audit log. The guards find the user from Better
Auth's two-factor cookie (`pendingCodeSignInOf` in `src/server/auth/auth-guards/code-step.ts`), and
`src/server/auth/auth-events/` records the code and sends the email after the response. Accounts
with only email codes have no `two_factor` row, so Better Auth never pauses them: each emailed code
takes 5 tries, and emailing a new one (at most 5 per 15 minutes per user) starts again, with each
code reaching the owner's inbox.

## Passkeys

Passkeys are their own sign-in. They require user verification (fingerprint, face or device
PIN), enforced on the server, so they count as MFA and skip the code step.

## Who requires MFA

Required for staff Admins and Managers, and company Admins (`requiresMfa`), the last only
while their company is active (`mfaRoleOf` works out which rules apply). For them an account meets the
requirement (`hasMfa`) with an authenticator app or a passkey, or when it has no password and
every connected provider account has MFA itself; **email codes don't count for them**. Provider
MFA only comes from providers that can prove it (`MFA_PROVIDERS` in `src/lib/sign-in/oauth-providers.ts`:
GitHub, whose API says `two_factor_authentication`), checked at every sign-in with or connection
of such an account (`src/server/auth/provider-mfa.ts`; without a definite answer, which includes
GitHub not answering within 3 seconds, the stored value stays and that sign-in doesn't count as
confirmed). Google can't, so a Google account never
counts. A provider's MFA only counts while its sign-in is configured on the server
(`availableProviders`). Until an account meets it, every app page sends them to the Security
page (`getActor()` in `src/server/authz.ts`). When it stops meeting it (2FA turned off at the
provider, a password added), the requirement applies again, and while
a provider account with 2FA is still connected they first confirm with it on the step-up page,
so whoever set the password can't set up MFA instead. Everyone else gets a
dismissible recommendation on the dashboard (dismissed per user and saved with the account,
`user.mfa_recommendation_dismissed_at`, so the dashboard knows on the server and shows it from the
first paint, and it stays dismissed on every device), and email codes count for them.

## Every session counts

Each session records whether, and with what, it had a second factor
(`session.mfa_verified`, `session.mfa_method`): the code step, a passkey, a provider account
with 2FA (the method is the provider's ID, e.g. `github`), or a trusted device. Whether that's enough is decided when the session is read, with the user's role
at that moment, so a promotion or a deactivated company takes effect in sessions that already
exist. A password without the code step, an email link, a provider that can't prove MFA
(Google), or a provider account without 2FA doesn't. A session confirmed with a provider keeps
counting after that provider's sign-in is turned off. **Anyone with MFA** who has such a session is sent to the step-up page (`/auth/verify`)
to confirm it before they continue, from every page (`isSessionMfaVerified`). For roles that
require MFA only strong factors count: not email codes, and not a trusted device. Wrong step-up
codes are limited to 5 per 15 minutes per user, and each is recorded (`mfa_failed`). Only a code
that was compared and refused counts and is recorded (`isWrongCodeWithSession` in
`src/server/auth/auth-events/`): an emailed code that expired, too many tries for one code or an
error isn't a wrong code, so it gives its attempt back and the user's activity doesn't say one was
entered. Setting up a first method from an unconfirmed
session confirms it, since there was nothing to protect before.

## Confirm with GitHub

"Confirm with GitHub" only takes your own GitHub account: on the step-up page it's a whole
new GitHub sign-in, so the server marks it as confirming the browser's session (a re-verify):
the page sends a hint, and before Better Auth starts the sign-in the guards store who is signed
in, from which session, in the server-side part of the OAuth state, which the browser can't
change (`markReverify` in `src/server/auth/reverify-marker.ts`). When GitHub answers, only the GitHub
account you connected and confirmed as a second step counts (`mayReverifyWith` in
`src/lib/authz/mfa/step-up.ts`), from the browser that still has that session. Anything else is refused
before anything is connected, any token stored or any session created (`checkReverify` in
`src/server/auth/auth-events/reverify.ts`, from Better Auth's `user.validateUserInfo`): a new GitHub account
with your email address, another user's GitHub account, or one of yours that isn't confirmed.
You stay signed in as yourself, the step-up page says "GitHub couldn't confirm it's you: you
signed in with a different GitHub account than the one you set up as a second step. Nothing was
changed. …" (`REVERIFY_WRONG_ACCOUNT` in `src/lib/sign-in/sign-in-refusals.ts`), and it's recorded as a
failed MFA confirmation (`mfa_failed` with `reason: 'different_account'`). Better Auth's own
answers for an address without an Adiutor account (or one it wouldn't connect) say the same on
that page, so it never tells whether an address has an account. A session for another user is
refused once more when it's created, as a backstop. Without the hint (GitHub on the sign-in
page), it's a plain sign-in with GitHub, as before.

A confirmation with GitHub (a sign-in with it, or "Confirm with GitHub") always counts for the
session (`isSessionMfaVerified`), but GitHub only reports that the GitHub account has 2FA, not
that this sign-in used it: it doesn't ask for it again on a browser that's signed in there. So
it only opens the 15 minutes for changing sign-in methods (see below) while GitHub is the
account's only strong second step. On an account with a passkey or an authenticator app, those
confirm such changes (`hasStrongerStepThanProvider` and `mfaConfirmedUntil` in
`src/lib/authz/mfa/session.ts`), so whoever has a browser signed in to the user's GitHub can't add a way
in of their own. The step-up page then doesn't offer GitHub for a change (see below).

When a sign-in with your own GitHub account didn't confirm the session, the page the user lands
on (back on the step-up page, the Security page to set up MFA, or the page they came for) says
why: two-factor authentication is off for that GitHub account, or GitHub couldn't be checked just
now (`ProviderStepUpNotice`, from a short-lived cookie set by `recordProviderSession` that names
the provider and the reason, never the account; removed once the session is confirmed, when
someone signs out, or when another sign-in starts on that browser). Such an attempt takes nothing
away: the new session Better Auth creates for it keeps the confirmation the browser's session
had, as it was, so it opens no new 15 minutes for changing sign-in methods either
(`beforeSessionCreate`).

## A promotion ends weaker sessions

When someone's role starts requiring MFA (made a company
Admin, a staff Manager or Admin, by an invitation or invite link, or when their company is
reactivated), their sessions that weren't confirmed with a strong factor end
(`withMfaPromotion` in `src/server/auth/mfa-promotion.ts`), so an older (possibly stolen) session
can't set up the account's first strong method. The session they accept an emailed invitation
with themselves stays: they've just proved the inbox and set up MFA next. A session that joins
with an invite link doesn't (a link proves no inbox): the user is sent to sign in again, with a
note, and then sets up MFA.

## Changing sign-in methods needs a recent confirmation

Once an account has MFA, or any
second step the step-up page can use (`canConfirmSessions`, e.g. a provider account with 2FA
next to a password), adding or removing passkeys, connecting, confirming or disconnecting a
provider account, two-step verification, backup codes or a first password (which would
otherwise stop provider MFA counting) needs a confirmation with that second step from the last
15 minutes (`mfaConfirmedUntil`, from `session.mfa_verified_at`: the sign-in or the latest
step-up; a trusted device doesn't count, nor does GitHub on an account with a passkey or an
authenticator app, see [Confirm with GitHub](#confirm-with-github)). So a stolen session can't add its own way in, however
long ago it was confirmed. This is refused also when Better Auth's endpoints are called
directly (`src/server/auth/auth-guards/`); renaming a passkey only needs a confirmed session.
The same window guards giving someone else a lasting way in: any staff role (or a higher one) and
a company's Admin role, by invitation, invite link, role change, adding a member or registering a
company (`grantNeedsConfirmation`, enforced in the services by `assertConfirmedForGrant`; see
[Invitations](companies-and-roles.md#invitations)), since an account a stolen session creates for
itself outlasts signing the victim out.
Better Auth's own `freshAge` check is off (a code step-up doesn't renew it); accounts without a
second step need a sign-in from the last hour for any of these changes instead
(`needsFreshSignIn`, from the session's `createdAt`, which a session Better Auth replaces keeps,
see [Sessions](authentication.md#sessions); a session whose sign-in time is unknown counts as too
old), so an old (stolen) session can't add the account's first way in. That covers adding a
passkey, connecting or disconnecting a provider account, turning two-step verification on or off
and backup codes (the guards, for Better Auth's endpoints), and setting a first password and confirming a
provider account connected at sign-in (`setFirstPassword` and `confirmConnectedProvider` in
`src/server/auth/accounts.ts`, which apply both rules themselves: Better Auth's `setPassword` is
server-only and never reaches the guards). Deactivating your own account needs the same recent
confirmation (see [Security](authentication.md#security-accountsecurity)). Two-step
verification is only turned on by proving a code (an authenticator app, or email codes through
their code step), and setting up an authenticator app next to email codes is recorded and
emailed as a new method. On
the Security page, starting such a change without one sends you to the step-up page first,
which brings you back to the card you started it in (e.g. `/account/security#passkeys`, with focus
on its heading) to start it again (`src/components/auth/recent-confirmation.tsx`, see
[Coming back to where you were](authentication.md#coming-back-to-where-you-were)). It opens the page in its
change mode (`for=change`, from `confirmChangeUrl`; a session that's confirmed already is
only there for a change, so it gets that mode too), which offers only the methods that allow the
change (`windowOpeningMethods`): not GitHub next to a passkey or an authenticator app, where the
page says why instead. So it never sends you back and forth: an account whose only strong step is
GitHub still gets GitHub, which opens the window there. Accounts without a second
step set up their first one without a step-up, within an hour of signing in. A reset that gives an account its first password sends a
"password added" email, unless it's the welcome link of a new account.

A reset or welcome link never gives an account its first password when that would end its MFA,
whatever the role (`wouldEndMfa` with a first password): an account whose only MFA is a provider
account with 2FA would otherwise lose it to whoever reads the inbox, who could then sign in with
the new password alone (for roles that don't require MFA, nothing would ask for GitHub again). The
guards refuse it (`RESET_ENDS_PROVIDER_MFA` in `src/lib/sign-in/sign-in-refusals.ts`, checked in
`src/server/auth/auth-guards/` while holding the user's sign-in change lock), before Better Auth
uses the link or sets anything. The reset page then names the provider: sign in with it and set a
password on the Security page, where it needs a recent confirmation; roles that require MFA add a
passkey or an authenticator app there first, since a password next to provider MFA alone is
refused for them. With a passkey or an authenticator app, or without MFA (a new account's welcome
link), the reset goes ahead.

## Signing in as someone needs strong MFA

Signing in as a user (see [Signing in as a user](authentication.md#signing-in-as-a-user)) asks the
staff member for the rules of the roles that require MFA, whatever their own role, so Support too:

- **Strong MFA on their account** (`hasStrongMfa`, the Actor's `strongMfa`): an authenticator app,
  a passkey, or no password with every connected provider account having MFA. Email codes don't
  count.
- **A confirmation with it from the last 15 minutes** (`strongMfaConfirmedUntil`, the Actor's
  `strongMfaConfirmedUntil`): an email code or a trusted device never opens this window, and GitHub
  doesn't on an account with a passkey or an authenticator app.

Starting without one sends them to the step-up page in its strong mode (`for=strong`, from
`confirmStrongUrlFor` in `src/lib/sign-in/confirm-url.ts`). That mode offers only the methods that
open the window (`strongStepUpMethods`): never email codes, and GitHub only as the account's only
strong step. So Support with email codes next to a passkey confirms with the passkey rather than
being sent back and forth. A session confirmed strongly already goes straight back. So does an
account without strong MFA, since the page that sent them explains what's missing.

## Locked out

An Admin resets two-step verification on the user's detail page (`resetUserMfa` in
`src/server/people/user-admin/`). The reset turns off two-step verification (the authenticator
app, its backup codes and email codes), removes the user's passkeys if the Admin ticks that, and
disconnects every GitHub and Google account connected to theirs, confirmed or not. Someone who
once verified the user's address at GitHub or Google can connect their own account by signing in
with it (see [Automatic linking](authentication.md#automatic-linking)); with 2FA on there, it can
become the user's only second step, and then only that person can confirm a session with it, so
neither the user nor the Security page could remove it. The reset also signs the user out
everywhere and forgets their trusted devices. They then sign in with their password, a passkey
they kept or an email link, and if their role requires MFA they're asked to set it up again. They
get a security email, and the audit log names the providers whose accounts were disconnected
(never the accounts).

The Admin needs a confirmation with their own second step from the last 15 minutes, as for
changing their own sign-in methods: without one, the Reset button sends them to the step-up page in
its change mode before its dialog opens (`ActionDialog`'s `confirmFirst`), so what they choose in
the dialog isn't lost on the way, and brings them back to the card on the user's page. The action
checks it again and sends them there itself if the window closed meanwhile. The reset holds the user's sign-in change
lock (`withSignInChangeLock`), so it's refused while a change of theirs is being made, such as
connecting an account, rather than crossing it. Admins can't reset their own account; they use
their Security page.
