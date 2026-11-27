# 0055. Four Settings tabs, grouped by what they're for

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

Settings grew a tab per feature: General, Staff, Requests, Attachments, Email, Webhooks and
Appearance. Two of the seven held a single card, the name and the logo that replace Adiutor's sat
on different tabs, and finding the mail server meant knowing it had a tab of its own. Every tab is
for staff Admins, so the tabs can only be grouped by what a setting is for. Staff and Requests are
used week to week; the mail server, the storage and the brand are mostly set once.

## Decision

How the tabs look is in [Companies, users and roles](../companies-and-roles.md#staff-screens).

- **General** (`/admin/settings`): how users see the staff and what they read in. The name, the
  languages and the default time zone, then the logo, the browser tab icon, light and dark mode
  and the brand colours: the short forms first, the tall cards with previews after.
- **Staff** and **Requests** stay as they were.
- **Integrations** (`/admin/settings/integrations`): what Adiutor works with outside itself. The
  mail server first, since nobody gets a sign-in link or an invitation without it; then one
  Attachments card, in three parts with a button each: whether people can attach files, the
  largest file and where files are kept (the first two need a storage, so they stay with it; saving
  a storage tests it and asks for a recent confirmation, which the others don't); then the webhooks.
- **In that order:** the tabs used week to week first, the services set once last.
- **A new setting is a card on the tab of what it's for,** or a part (`CardSection`) of the card
  it belongs with. A new tab only for a group that fits none of these.
- **Old addresses still land:** `redirects` in `next.config.ts` send the four old tabs to the card
  that took their first place (`#logo`, `#mail-server`, `#attachments`, `#webhooks`). A webhook's page
  keeps `/admin/settings/webhooks/[webhookId]`, with Integrations current there (`SegmentTabNav`'s
  `alsoOn`), so emailed links don't change.

## Consequences

- Longer pages: links and return addresses point at a card's anchor, never only at a tab.
- An anchor on an old address gives way to the first card's: `/admin/settings/appearance#colours`
  lands on the logo, two cards above.
- The redirects are temporary (307), so browsers don't keep them and a later tab may take one of
  these addresses.
- **2026-11-27:** the four redirects are gone, once nobody used the old addresses any more; the old
  addresses now answer 404. A webhook's page kept its address, so emailed links still work.
- `appearance/`, `attachments/` and `email/` hold cards and actions, not routes: each old page
  became the cards component its tab renders (`appearance-cards.tsx` and so on).

## Alternatives considered

- **A sidebar of sections instead of tabs:** a second kind of section navigation for one page, and
  with four tabs nothing left to tidy.
- **Attaching files and the largest file on Requests:** they wait for a storage, which would then
  be on another tab.
- **Other names:** "Connections" sat close to "Connected accounts" on the account page, where people
  link their sign-in; "Services" close to "service desk", which is what Adiutor is; "Server" reads
  as the operator's machine.
- **Webhook pages under `/admin/settings/integrations/webhooks/`:** tidier addresses, but more
  files would move and emailed links would go through a redirect, for nothing users see.
