# 0014. Languages without URLs, with next-intl

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Adiutor was English only. It now speaks English (US), Dutch and Spanish, and more languages may
follow. The URLs had to stay as they are: no `/nl/...` prefixes or translated paths. The app uses
Cache Components and Partial Prefetching, mixes Server and Client Components with server actions,
sends emails from services, Better Auth hooks and scripts, and reads the request on every page for
the Content Security Policy's nonce ([0006](0006-nonce-based-content-security-policy.md)).

## Decision

- **next-intl, without locale routing.** Its request configuration (`src/lib/i18n/request.ts`)
  gives each request its language and messages; Server Components, server actions and metadata use
  `getTranslations`, client components get their namespaces from a provider, and emails and
  services use its core translator (`use-intl/core`). Keys are checked by TypeScript against the
  English (US) catalogues.
- **The language comes from a cookie, then Adiutor's default language, then (before setup)
  `Accept-Language`.** Signed in, the account's saved language is copied into the cookie, so
  rendering only reads the database without a cookie: one row with the default language, which a
  staff Admin chooses at setup and on the staff page. It comes before the browser's language
  because the staff choose the language their users work in; anyone can pick another in the menu.
  Reading the cookie costs nothing extra, since every page already renders per request.
- **Default is a choice of its own, and where everyone starts.** An account on Default saves no
  language and has no cookie, so it follows the default language, also after a staff Admin changes
  it; its emails use the default too, never the language of whoever caused them. Only a language
  someone picks is saved (on the account page, or in the signed-out menu before signing in); a
  guessed one never is.
- **Messages are ICU, one whole sentence each,** in one JSON catalogue per area and language, so
  translators choose the word order.

Details: [Languages](../i18n.md).

## Consequences

- No page can be prerendered per language. Today the nonce rules that out anyway. If 0006 is ever
  replaced to get static pages back, the language moves to a proxy rewrite onto an internal
  `[locale]` root segment (`next/root-params`), which keeps the public URLs unchanged.
- Text in a route's static shell comes from client components that read the root provider, so
  Partial Prefetching can still prefetch the shell.
- Every change adds its text to every language; `pnpm lint:messages` and ESLint refuse anything
  less, and hard-coded or glued-together text.
- A cached function (`'use cache'`) can't read the request's language: it must take the locale as
  an argument.
- A request without a cookie (a first visit, or anyone on Default) waits for one small query for
  the default language before rendering. The browser's language only counts before setup.

## Alternatives considered

- **Locale in the URL** (`/nl/...`), as Next.js's guide shows: ruled out by the requirement, and it
  would gain nothing while every page renders per request.
- **Lingui:** needs a compiler macro (an SWC plugin), which is risky with Turbopack.
- **Paraglide:** compiles messages to tree-shaken functions, but its Next.js 16 support is young.
- **react-i18next:** not built for Server Components, and ships more to the browser.
- **Our own dictionaries** on `intl-messageformat`: we'd rebuild the provider, the types and the
  formatter ourselves.
