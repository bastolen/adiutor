# 0009. Cache Components, and pages kept alive

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

Cache Components is a Next.js 16 feature that lets one page mix static, cached and per-request
parts. It came with the create-next-app defaults (`cacheComponents: true` in `next.config.ts`). It
also changes navigation: Next.js keeps the last few pages alive, hidden with React's `<Activity>`,
instead of unmounting them. Their state survives navigation. That's right for typed input, but a
"Saved" message, an error or an open dialog shouldn't still be there when you come back.

## Decision

Adiutor keeps Cache Components on and builds for pages that stay alive:

- Forms use `useTransientActionState` instead of `useActionState`. Status messages and dialog open
  state use `useTransientState` instead of `useState` (`src/components/ui/use-transient-state.ts`).
  Both reset when the page is hidden.
- Pages read the signed-in user with `getActor()` or `requireCompanyAccess()` inside a `<Suspense>`
  boundary.
- The theme is never read on the server, since cookies would make every page dynamic. The inline
  `themeScript` in the root layout applies it before the first paint.

## Consequences

- Plain `useState` and `useActionState` are wrong for anything that shouldn't outlive a visit.
- The sign-in pages keep even their fields in `useTransientState`. They come back after signing
  out, and the next person on the browser mustn't find the last user's details.
- A card with an anchor lands you on it again when `<Activity>` shows its page
  (`AnchoredSection`).
- How this meets the per-request rendering the CSP needs is in
  [0006](0006-nonce-based-content-security-policy.md).

Details: "Messages don't outlive the page" under
[Design and accessibility](../design.md#design-and-accessibility), and
[Dark mode](../design.md#dark-mode).

## Alternatives considered

- **Turning Cache Components off.** These docs record no comparison. The hooks above are what
  keeping it costs.
- **Reading the theme from a cookie on the server.** Rejected: it would make every page dynamic.
