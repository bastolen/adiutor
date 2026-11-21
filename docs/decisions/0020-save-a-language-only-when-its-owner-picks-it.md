# 0020. Save a language only when its owner picks it

- **Status:** Accepted; a saved language counts only while it's offered
  ([0029](0029-staff-choose-the-offered-languages.md))
- **Date:** 2026-11-16

## Context

[0014](0014-languages-without-urls-with-next-intl.md) saved a language picked in the signed-out menu
with the account at the next sign-in: an account on Default took the language of the browser's
language cookie. But the cookie says nothing about who picked it. Signing out keeps it, so the
sign-in page stays in the browser's language, and every sign-in of an account with a saved language
writes it. On a shared browser, the next person on Default silently got the previous person's
language, for their screens and for every later email. A Default chosen in one browser was also
undone by an old cookie in another.

## Decision

Someone's own choice of language is saved with their account only when they make it signed in: on
the account page's Language card, or in the theme and language menu of a page they reach signed in
(`setLanguageAction`, through `setOwnLocale`). What staff give a new account, and what setup saves
for the first Admin, stays as it was.

Signing in saves nothing. It makes the browser mirror the account (`rememberLanguage` in
`src/server/auth/auth-events/language.ts`): the cookie gets the account's saved language, and for an
account on Default the cookie is removed, so the browser follows Adiutor's default language.

This replaces one rule of 0014, "or in the signed-out menu before signing in". The rest of 0014
stands. Details: [Languages](../i18n.md#how-the-language-is-chosen).

## Consequences

- Someone on Default who picks a language on a signed-out page (the sign-in page, an invitation)
  gets Adiutor's default language once signed in, and picks theirs once more. That choice is then
  saved.
- After an account on Default signed in, the sign-in page is in the default language again, also
  for the next person on that browser.
- A session that still has to be confirmed with its second step changes nothing in the account:
  its choice on the step-up page stays in the browser, until the next sign-in.
- Nothing may read the language cookie as a person's choice. It only says which language this
  browser shows.

## Alternatives considered

- **Keep saving the cookie's language at sign-in:** the defect above.
- **Save it, and remove the cookie at sign-out:** the sign-in page would lose its language for
  everyone, and a browser that's closed without signing out would still hand its language on.
- **Save only a language picked since the last sign-out:** it still can't tell the person who
  picked it from the person who signs in.
