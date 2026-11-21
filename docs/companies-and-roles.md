# Companies, users and roles

Who uses Adiutor, what each role may do, and the staff screens for people, companies and
invitations. Back to the [documentation](README.md).

Adiutor is run by its **staff** (the people who handle requests), who add **companies** (the
customers, who raise requests). Staff have a **platform role** on their account (`user.platform_role`),
and the name users see and Adiutor's default language and time zone live in the single-row
`staff_settings` table
(`src/db/schema/staff.ts`).
**Users** can belong to several companies, with one company role (Admin, Client or Watcher) in
each. Staff can also be members of companies. What each role may do with requests is in
[Requests](requests.md).

In the interface, staff screens say **users**, **companies** and **staff** (the `Staff` badge),
and screens for company users talk about their company by name and about **requests**.

## Roles and permissions

| Staff (platform role)                     | Admin | Manager | Finance | Support |
| ----------------------------------------- | :---: | :-----: | :-----: | :-----: |
| Manage staff (`staff:manage`)             |   ✓   |    –    |    –    |    –    |
| Add / edit / (de)activate companies       |   ✓   |    ✓    |    –    |    –    |
| Manage any company's users                |   ✓   |    ✓    |    –    |    –    |
| View all companies and their users        |   ✓   |    ✓    |    ✓    |    ✓    |
| View all users (`/admin/users`)           |   ✓   |    ✓    |    ✓    |    ✓    |
| Work on every company's requests          |   ✓   |    ✓    |    –    |    ✓    |
| Be assigned to requests                   |   ✓   |    ✓    |    –    |    ✓    |
| Read every company's requests             |   ✓   |    ✓    |    ✓    |    ✓    |
| Reset MFA, sign out, (de)activate         |   ✓   |    –    |    –    |    –    |
| Delete user accounts                      |   ✓   |    –    |    –    |    –    |
| View the audit log (`audit:view`)         |   ✓   |    ✓    |    –    |    –    |
| See recorded errors (`errors:view`)       |   ✓   |    –    |    –    |    –    |
| See background jobs (`jobs:view`)         |   ✓   |    ✓    |    –    |    –    |
| Run, pause and retry jobs (`jobs:manage`) |   ✓   |    –    |    –    |    –    |
| Billing (reserved for later)              |   ✓   |    –    |    ✓    |    –    |
| Join a company with an invite link        |   ✓   |    ✓    |    –    |    –    |
| Sign in as a user (see below)             |   ✓   |    ✓    |    –    |    ✓    |

Nobody can give themselves a higher staff role: Admins can step down, never back up. Finance and
Support can't join with an invite link, or accept the invitation a link sends them, so a shared link
isn't a way into a company for them; an email invitation someone sends them still works, and staff
Admins and Managers can add them (or themselves) to any company directly.

Signing in as a user lets staff see Adiutor as that user does, to check what isn't working for them.
Each role can sign in as different users:

- staff Admins: anyone but staff Admins;
- Managers: company users;
- Support: company users who aren't an Admin in any company.

Nobody can sign in as themselves or as a user who turned it off on their Security page, and nothing
can be changed while signed in as someone. See
[Signing in as a user](authentication.md#signing-in-as-a-user).

| Company                                      | Admin | Client | Watcher |
| -------------------------------------------- | :---: | :----: | :-----: |
| Invite and manage users                      |   ✓   |   –    |    –    |
| Raise requests, reply, close and reopen them |   ✓   |   ✓    |    –    |
| View and follow the company's requests       |   ✓   |   ✓    |    ✓    |

Nobody can give themselves a higher company role either (`isCompanyRoleRaise` in
`src/lib/authz/guards.ts`): an Admin can step down to Client or Watcher while another Admin remains,
but nobody raises their own role in a company, not even staff who may manage its members. (Staff
Admins and Managers who aren't members can still add themselves with any role, as above.)

- **Role descriptions** (`roles.<role>.description` in the `roles` catalogue) are shown when
  choosing a role, and describe the intended request workflow. `roleOptions(roles, t)` in
  `src/lib/authz/roles.ts` turns a list of roles into the options of a role picker, named in the
  reader's language (`t` translates the `roles` namespace).
- **Permissions** come from roles only, defined in `src/lib/authz/permissions.ts`. Staff act on every
  company through their platform role, without being members. Members of a deactivated
  company lose access; staff keep it. Deactivating a deactivated company, or reactivating an active
  one (e.g. on a page opened before someone else did it), is refused, so the audit log and the
  deactivation date stay as they were. A company, and the staff, always keep at least one active
  Admin, also when two changes come at the same moment (see
  [The last Admin, at the same moment](#staff-screens)).
- **Authorization matrix:** `src/server/authorization-matrix.int.test.ts` checks every role against
  every service behind a server action, and the page loaders that check roles, on their own
  company, another company, the staff and another user, down to the kind of refusal. What a role
  is allowed must also succeed: any other refusal (invalid input, a missing confirmation, a limit)
  fails the matrix unless the operation's row names it. The own-account
  services that take an ID (`revokeOwnSession`, `confirmConnectedProvider`) are tried with another
  user's ID; password changes, which need a second step, are covered in
  `src/server/auth/accounts.int.test.ts`. It also tries every operation with a staff member signed
  in as the acting user: every change is refused (`signed_in_as`) except the user's own work
  (`OWN_WORK`), and the reads (`READS`) give what they give the user. A new operation counts as a
  change unless it's listed there (see
  [Signing in as a user](authentication.md#signing-in-as-a-user)).
- **Protected by default:** `src/proxy.ts` sends signed-out visitors of every page to `/auth`, except
  the public `/auth`, `/invite`, `/join`, `/setup` and `/api/auth` paths, the health check (`/api/health`) and the background jobs' tick (`/api/jobs`, which checks its own secret). Pages and server actions still check
  the session and permissions on the server through `src/server/authz.ts`. Someone without the
  permission gets the 404 page, titled "Not found · Adiutor" like it, so the browser tab doesn't
  name the page they may not see (see "Page titles" in [Design](design.md)).

## Navigation and dashboard

- **Everyone:** the menu has Dashboard and **Requests** (`/requests`: every request the user may
  see), and the dashboard has a Requests tile. Requests is declared once for both
  (`src/app/(app)/requests-section.ts`), like the staff sections (`staff-sections.ts`).
- **Staff who work on requests** (Admin, Manager, Support) also get an **Assigned to you** tile
  after Requests: how many active requests are assigned to them, linking to the list with its
  Assignee filter on Me (`/requests?assignee=me`; see [Assigning](requests.md#assigning)).
- **Staff:** the menu also has Users and Companies, and the dashboard a tile for each. Admins
  (`staff:manage`) also get **Staff** in the menu and as a tile on the dashboard, which opens the
  staff page. Admins and Managers (`audit:view`) also get **Logs**, last in the menu and as a tile
  on the dashboard, and a warning there when background jobs aren't running (see
  [When the ticks stop](jobs.md#failures)).
- **Company users:** the dashboard also has a **Your companies** card ("Your company" for one):
  each active company they're in, with their role, linking to the company's page. The menu lists
  no companies, so the card is their way to a company and from one company to another. Someone
  who is in no company gets no card.
- **Company addresses:** a company's pages are at `/companies/<URL name>` (its `slug`, e.g.
  `/companies/adiutor/members`), and its ID works there too (`getCompanyAccess` takes either; a
  company the user can't see is "not found" either way). The app's links use the URL name; emails
  use the ID, so a link in an inbox still works after the URL name changes. Changing the URL name in
  the company's settings changes its address: the page moves to the new one (and confirms with
  "Saved."), and links with the old URL name stop working. A URL name can't look like an ID
  (`slugSchema`), so the two never collide. Names may repeat, URL names can't: where someone picks
  a company (raising a request, the Company filter of the request lists, adding someone to a
  company), a company whose name another in the choice shares shows its URL name too, as
  "Adiutor Tests (adiutor-tests)" (`companyChoiceLabels` in `src/lib/company-choices.ts`).

## Staff screens

- **Staff page** (`/admin/staff`, `staff:manage`, Admins): change the name shown to users (in
  invitations and wherever users see who's helping them) and Adiutor's default language (for
  everyone who hasn't chosen one; see [Languages](i18n.md#how-the-language-is-chosen)) and time zone
  (for signed-out pages and everyone whose zone isn't known yet; see
  [Time zones](i18n.md#time-zones)), see the staff with their role, when
  they were last active and when their account was created ("Joined"), change roles, remove people from staff (their account stays), and invite
  staff by email or single-use invite link. Staff invitations and links have no company
  (`company_id` is null) and give a platform role; a database check keeps staff rows on platform
  roles and company rows on company roles.
- **Logs** (`/admin/logs`, `audit:view`, Admins and Managers): the whole audit log, newest first
  until the Sort menu says otherwise, in pages. Each event says what happened, who did it, whom it
  was about and which company (each a link), when, and the browser and IP address it came from. It
  can be searched by a person's name or email or a company's name, filtered to a group of events
  (Sign-ins, Sign-in methods, Accounts, People, Companies and staff, Background jobs; `AUDIT_GROUPS` in
  `src/lib/audit-actions.ts`, named by `audit.groups.*`) and limited to a range of days (UTC, both
  days included). Admins (`errors:view`) also get an **Errors** tab (`/admin/logs/errors`): look up
  the reference an error page showed, typed in any case, with or without the dash, and see the
  errors of the last 7 days, newest first (see [Looking up an error
  reference](deploying.md#looking-up-an-error-reference)). Admins and Managers (`jobs:view`) also get
  a **Jobs** tab (`/admin/logs/jobs`), where Admins (`jobs:manage`) also run, pause and retry jobs
  (see [Background jobs](jobs.md#for-staff)). The errors page is "not found" for Managers.
- **Users page** (`/admin/users`, `users:view`): every account in a table, sorted by name
  until another order is chosen from the Sort menu (email, last active or joined), with staff marked with a
  brand-coloured avatar and a "Staff · role" badge. Each avatar shows the person's picture when they
  have one (see [Sign-in and accounts](authentication.md#security-accountsecurity), "Pictures"), here
  and in the Staff and Members tables and on the user's page. Under each name it lists the user's
  companies (linking to them) and MFA status ("MFA on", "No MFA", or "Needs MFA" when their role
  requires it); it also shows when they were last active and when they joined, with "Deactivated" and "Email not verified" badges. It
  can be searched by name or email, and filtered to All, Staff, Not staff, Without MFA or
  Deactivated. Each name opens the user's detail page. Admins and Managers (`users:create`) also get
  **Add user**.
- **Add user** (`/admin/users/new`): registers an account from just an email address, without companies
  or staff access (`registerUser` in `src/server/people/user-registration.ts`). The person gets a welcome email
  with a link to choose a password, valid for 7 days (a Better Auth password reset token, so the reset
  page sets the first password), and can always sign in with an email link instead. An address that
  already has an account is reported, with a link to it.
- **User detail page** (`/admin/users/[id]`, staff): the account, its sign-in security (two-step
  verification, passkeys, password, connected provider accounts and, for providers that can prove
  MFA, whether they have 2FA; staff Admins also see each account's name at its provider, a GitHub
  username or Google email address), companies and roles,
  signed-in devices and, for Admins and Managers, recent activity from the audit log.
  - **Companies:** Admins and Managers (`members:manage` in companies) add the user to a company
    right away with a role (they get an email), change their role there, and remove them, with the
    same last-Admin rule and the same security emails as a company's Members page (see
    [Changing roles and removing people](#changing-roles-and-removing-people)). The card offers
    only what the services allow: a membership of a deactivated company shows its role as a badge
    and nothing to press, as that company's Members page does, and "Add to company" is turned off
    for a deactivated account, with the reason below it (`describedBy`).
  - **Staff access** (Admins, `staff:manage`): make the user staff with a role, change it, or remove
    it, with the last-staff-Admin rule; the user gets a security email. Removing it also revokes the
    open staff invitations addressed to them. Admins and Managers must set up a second sign-in step
    at their next sign-in.
  - **Sign in as user** (staff Admins, Managers and Support, not on your own page): see Adiutor as
    the user does for up to 30 minutes, with an optional reason (`SignInAsCard`). The card says why
    when the rules don't allow it for this user (`impersonationVerdictFor`). Without a recent
    strong confirmation, the button goes to the step-up page in its strong mode first, and comes
    back to the card. See [Signing in as a user](authentication.md#signing-in-as-a-user).

  Admins can also (each confirmed in a dialog, logged and emailed to the user):
  - **reset two-step verification** for a lost phone (optionally removing passkeys too), which
    also disconnects their GitHub and Google accounts and needs the Admin's confirmation with
    their own second step from the last 15 minutes, which the button asks for before its dialog
    opens (see [Locked out](mfa.md#locked-out));
  - **sign the user out everywhere** (which also forgets the devices they trusted);
  - **deactivate or reactivate** the account (deactivating one that's deactivated already, or
    reactivating one that's active, is refused, also when two Admins do it at the same moment: the
    second waits for the account's row and finds the first one's change, so it's recorded and
    emailed once);
  - **delete** the account, after typing its email address. Memberships, sign-in methods and
    sessions go with it, the open invitations and invite links they sent are revoked (used
    ones stay in the history, without an inviter), and so are the open invitations addressed to
    them, to any company or the staff, so nobody can create a new account for the address with
    one. The address the account had gets an `account_deleted` security email once it's gone.

  None of these, nor the staff controls, work on your own account (use the Security page and the
  Staff page), or on the last staff Admin or the last Admin of an active company who can still sign
  in. Your own companies are managed on your page like anyone's.

- **The last Admin, at the same moment:** the last-Admin rule holds when two changes come at once
  too (two Admins deactivated or deleted together, one deactivated while the other is demoted or
  removed, two staff Admins demoting each other). Everything that can take away a company's last
  active Admin locks that company's row first (`changeMembership` in
  `src/server/people/members.ts`, `soleAdminOf` in `src/server/people/user-admin/sole-admin.ts`), and the
  staff equivalents lock the staff Admins' rows (`setStaffRole` in `src/server/people/staff.ts`),
  so they take turns and count the Admins again once they hold the lock: the second one sees the
  first and is refused with the usual last-Admin message. In the rare case where two changes still
  cross (Postgres breaks a deadlock), one is refused with "Someone changed this at the same moment.
  Try again." and changes nothing. See [Lock order](security-measures.md#lock-order).

- **Rights checked when the change is made:** a request reads the signed-in user's roles once, when
  it starts. Every change to people checks those rights again inside its transaction, from the
  user's own rows as it locks them: inviting, resending and revoking invitations, creating and
  revoking invite links, adding members and registering companies (`assertStillManages` in
  `src/server/access.ts`; invitations and invite links call it through `assertStillManagesPeople`,
  which picks the permission for the staff or the company), and changing staff or company roles
  and removing people (`setStaffRole`
  and `changeMembership` work the rights out from the rows they lock, with the same permission rules
  as when the request started, `getGlobalPermissions` and `getPermissions` (both in `src/lib/authz/permissions.ts`), never by comparing
  roles). So someone demoted, removed or
  deactivated while their request was under way is refused (a demoted company Admin's queued "make
  me Admin" included), and whatever they created just before is revoked with the rest. The
  invitations and invite links someone sent are revoked whenever they or anyone else take away
  their right to manage a company or the staff: a role change, a removal, a deactivation or a
  deletion (`revokeInvitesWithoutManager`), so a former Admin keeps no way back in. In the same
  way, someone who stops working on requests (a staff role without request work, leaving the
  staff, a deactivation or a deletion) is taken off every request assigned to them, with a line in
  each request's history (`unassignFrom`; see [Assigning](requests.md#assigning)); reactivating
  them doesn't put them back. A link of
  theirs claimed at that very moment leaves no open invitation either: the claim locks the link's
  creator before the link, so it takes turns with the change (see
  [Lock order](security-measures.md#lock-order)).

- **Last active:** `getOptionalActor()` records when each user last did something, at most once a
  minute (`touchLastActive` in `src/server/actor.ts`), and signing in sets it too. It's written in
  the background (`startInBackground` in `src/server/background.ts`, which says why not with Next's
  `after`), so pages never wait for it. It's shown in the Activity column of the Users, Staff and
  Members tables, and on the user detail page.

## Accounts and invitations

### Accounts

There's no public sign-up. People join by accepting an invitation, or staff register
them (Add user). Choosing a password through an emailed link (reset or welcome) also verifies the
email address; a first password chosen that way sends no security email.

### First run

On a fresh install (no `staff_settings` row and no accounts), `/auth` redirects to
`/setup`. There, the first person chooses the name users see and Adiutor's default language (the
setup page's own to begin with) and becomes the first staff Admin, keeping the language they set up
in for themselves, or starting on Default when it's the default they chose; the browser's time zone
becomes Adiutor's default zone and the Admin's own (or use `pnpm setup:platform`, with
`--default-language` and `--time-zone`); a new account's email
address counts as verified. Until then `/setup` is
open to anyone who can reach the site, so complete it right after deploying. Once set up, or once
any account exists, `/setup` shows the not-found page, so it can never promote an existing account.
The command refuses once set up; if the settings row were ever lost, it can make an existing
(active) account the Admin again, to recover, recorded in the audit log; renaming the staff on the
staff page also recreates the row. A fresh setup itself isn't recorded in the audit log.

### Invitations

- **Confirming first:** giving someone a lasting way in needs a confirmation with your second step
  from the last 15 minutes, as changing how you sign in does (see
  [Changing sign-in methods needs a recent confirmation](mfa.md#changing-sign-in-methods-needs-a-recent-confirmation)):
  any staff role (inviting, an invite link, making someone staff or raising their staff role) and a
  company's Admin role (inviting an Admin, an Admin invite link, making a member Admin, adding
  someone as Admin, or adding a company with its first Admin). Stepping down, removing someone, and
  the Client and Watcher roles need nothing. The services refuse without it
  (`assertConfirmedForGrant`); the forms show "Confirm it's you" instead of their submit button as
  soon as such a role is chosen, a role select sends you to the step-up page before saving, and
  you come back to the same page. A stolen session therefore can't leave an account of its own
  behind, which signing the victim out wouldn't remove.
- **New staff Admins:** when someone becomes a staff Admin, every other staff Admin gets an email
  naming them and who made it happen (`staff-admin-added`), so an unexpected one gets noticed.

- **By email:** company admins (and staff Admins and Managers) invite people from a company's
  Members page, and Admins invite staff from the staff page. Staff add a company
  (`/admin/companies/new`) by naming it and inviting its first Admin. The invitation, its resend and
  its reminder go out in the form's Email language (see [Which language](email.md#which-language)).
  The link works once and
  expires in 7 days. Inviting an address again, or resending, replaces its open invitation, so
  only the newest link works; two requests at the same moment take turns, and the newest wins.
- **By invite link:** a single-use link for a role, valid for 1, 7 or 30 days. Whoever opens it
  first enters their email address and gets an email invitation there, which proves they own it.
  The link is shown once; only its hash is stored. Finance and Support staff can't use links (see
  the [role table](#roles-and-permissions)).
- **Several at once:** the invite form takes up to 20 addresses (one per line or separated by
  commas) with one role, and lists what happened per address. Whether you may invite there at all
  is checked once, before the first address (`inviteManyByEmail`): someone who may not gets the same
  refusal as for one address (not found for another company, not allowed otherwise), and nothing is
  sent. If one address crosses another change at that moment (Postgres breaks a deadlock), only
  that address fails, with "Someone changed this at the same moment. Try again.", and the others
  still go through.
- **Claims and limits:** claiming a link counts as an invitation sent by whoever created it, against
  their limit (30 an hour) and the company's (60 an hour; the staff share one), like an email
  invitation. Past either, the claim is refused with "This invite link can't be used right now. Try
  again later." and the link stays unused. A claim never replaces an open invitation that someone
  sent to that address: the invitation is kept, the address gets an "already invited" email pointing
  to it, and the link is used up all the same, so whoever claimed it sees the usual "check your
  inbox" and learns nothing about the address. (An open invitation that came from another link is
  replaced, as before.)
- **When the email can't be sent:** a claim whose email fails (the mail server is down) is undone,
  whatever the address: its invitation is revoked and the link can be used again, so an outage
  doesn't use up a single-use link with nothing in anyone's inbox. Whoever claimed it sees that it
  failed and can try again; the audit log has the claim and its undoing ("Invite link made usable
  again because its email couldn't be sent"), and the claim still counts against the limits. The
  link stays used up when it isn't as the claim left it any more: its creator lost their rights
  meanwhile (freeing it would give a former Admin's link back), or the invitation was resent,
  revoked or accepted.
- **Resending** an invitation sends a new link for it with the same role. One that came from an
  invite link stays one (the link is pointed at the new invitation), so Finance and Support still
  can't accept it, and the Open invitations list marks such invitations "From an invite link".
- **Reminders:** an invitation that's still open a day after it was sent gets one reminder email
  2 days before it expires, with a new link (the old one stops working), sent by
  `pnpm jobs:run`. Addresses that are already members of the company (or, for staff invitations,
  on the staff) get none: they joined some other way meanwhile. The old link only stops working
  once the reminder is out: a reminder that can't be sent, or whose run was stopped halfway, keeps
  it working, and a later run tries again (see [Background jobs](jobs.md#the-jobs)).
- **Accepting** (`/invite/…`): signed in with the invited address, you join directly. Signed out,
  you can sign in or create an account (name and password). Joining as staff sets the platform role
  (someone who's already staff keeps theirs) and opens the dashboard. The audit log records what
  happened: someone who was in already (on the staff, or a member of the company) keeps their
  role, and the event says so ("Used an invitation and kept the role they had", with the role they
  have and the one the invitation or invite link was for) instead of saying they joined with the
  invited role.

### Changing roles and removing people

Company Admins (on the Members page) and staff Admins and Managers (also on the user detail page)
change members' roles and remove them; staff Admins do the same for the staff on the staff page.

- **Your own row:** it speaks to you. Your role select asks before saving ("Step down to Manager?"
  on the staff page, where you can't raise your role again yourself; "Change your own role to
  Client?" on the Members page), and "Leave" replaces "Remove", with "Leave the staff?" or "Leave
  {company}?".
- **A role they already have:** choosing the role someone already has (e.g. on a page opened before
  someone else changed it) changes, records and emails nothing, for company and staff roles alike.
- **Where you land:** a change that takes away the page you made it on doesn't end on the 404
  page. The actions check your rights as they are after the change (`currentPermissionsOf` in
  `src/server/access.ts`) and send you on with a note (`src/app/(app)/access-notices.ts`, shown
  by `AccessNotice`): stepping down from staff Admin or leaving the staff goes to the dashboard;
  stepping down in a company goes to the company's page while you can still see it; leaving a
  company you can no longer see goes to the dashboard. Staff with rights in every company keep the
  Members page and the user detail page, so they stay where they are.

- **Security emails:** a member whose company role changes gets a `company_role_changed` email
  naming the company and the new role, and a removed member gets `removed_from_company`, both once
  the change has committed and without the device or IP address (they'd be whoever made the
  change). Nobody is emailed about a change they made to themselves in a company (stepping down,
  leaving), or about a role they already had. Staff role changes send `staff_role_granted`,
  `staff_role_changed` or `staff_role_removed`, also without the device or IP address.
- **Limit on role changes:** each person may change roles 30 times an hour, company and staff
  roles together, making someone staff included (`assertRoleChangeLimit` in
  `src/server/rate-limit.ts`, counted before the change's transaction). Past it, the change is
  refused with "Too many attempts. Try again in N minutes.", so switching a role back and forth
  can't flood a member's inbox. The limit is on the change, not the email: every change that goes
  through is still emailed, so the member always hears about their latest role. Removals aren't
  counted: one can't be repeated without a new invitation, which has limits of its own, and
  refusing one could keep someone in a company, or on the staff, that an Admin is removing them
  from.
- **Invitations addressed to them:** removing someone from a company revokes the open invitations
  to that company addressed to them, and taking someone off the staff revokes the open staff
  invitations addressed to them (`revokeInvitationsTo` in `src/server/people/invitations/revoke-on-loss.ts`,
  recorded as `invitation_revoked` with the reason `member_removed`). Such an invitation is left
  over when someone joins another way while it's open (added directly, given a staff role, or
  joining with an invite link while signed in), and could otherwise bring them back, even with a
  higher role than they had. Deleting an account revokes those to every company and the staff
  (`account_closed`). Their other invitations stay: removal from one company doesn't touch another's.

### Privacy rule

Whether an email address already has an account is only ever shown to staff
(`mayRevealAccountExistence`). Company admins always see the same
"Invitation sent" message, whatever the address; someone who's already a member gets an "already a
member" email instead.
