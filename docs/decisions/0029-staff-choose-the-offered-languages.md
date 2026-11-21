# 0029. Staff choose the offered languages

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Adiutor offered every language it has (English (US), Dutch and Spanish) everywhere a language is
chosen. An installation that works in one or two of them couldn't stop offering the others: people
picked a language the staff don't answer in, and invitations could go out in it.
[Decision 0014](0014-languages-without-urls-with-next-intl.md) set how a language is chosen (the
cookie, then the default, then the browser before setup) and
[0020](0020-save-a-language-only-when-its-owner-picks-it.md) when one is saved.

## Decision

How it works is in [Offered languages](../i18n.md#offered-languages). The choices behind it:

- **Staff Admins choose,** on the staff page's Languages card: a checkbox per language, next to the
  default (`staff_settings.offered_locales`).
- **A language that's off follows the default:** a cookie, a saved language or an invitation's
  language that's turned off counts as none, so whoever chose it reads and gets emails in the
  default language. Their choice is kept, and comes back when the language is on again.
- **It isn't offered, and it's refused:** the choices leave it out, and the services that take a
  language refuse it.
- **The default is always on,** in the form and in the database, so there's always a language to
  fall back on.
- **With one language left, the choices go:** there's nothing to choose between.
- **Not in the audit log,** like the default language: it changes no one's access.

## Consequences

- This extends 0014 and 0020; their rules stand, with a language counting only while it's on.
- Every request reads the language settings (one row, once per request), also with a cookie.
- Code that reads a stored language checks it with `offeredLocale` (or `recipientLocale`), and
  choices take the offered languages from `useOfferedLocales`.
- A language added later starts off in installations that exist, until a staff Admin turns it on.

## Alternatives considered

- **Resetting everyone who chose a language when it's turned off:** turning it on again wouldn't
  bring their choice back, and a mistaken click would change many accounts for good.
- **Allowing the default to be turned off:** it would leave people with no language to fall back
  on, or a fallback the staff turned off.
- **Keeping the choices with one language:** a menu with a single language and Default offers
  nothing to choose.
