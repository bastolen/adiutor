# 0053. Staff Admins may keep every page in light or dark mode

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Every visitor chooses System, Light or Dark, stored only in their browser
([decision 0009](0009-cache-components-and-pages-kept-alive.md) keeps the theme out of the server: a
cookie read there would make every page dynamic). Adiutor now runs in its operator's colours, name
and logo ([decisions 0049](0049-brand-colours-from-an-accent-and-a-tint.md),
[0050](0050-the-staffs-name-instead-of-adiutor.md) and
[0052](0052-the-staffs-logo-and-the-icon-made-from-it.md)). An operator whose brand works in only
one mode needs every page kept in it.

## Decision

- **A setting, not a cookie:** `brand.forced_theme` (`light`, `dark`, or none for both, as today),
  chosen by staff Admins on Settings › Appearance and audited (`brand_theme_changed`). The root
  layout reads it with the brand on every request (`requestForcedTheme`); it already renders per
  request, so nothing new becomes dynamic. A person's own choice stays in their browser.
- **Rendered on `<html>`:** while one mode is kept, the root layout renders `data-theme` itself
  with a `data-theme-forced` marker (`THEME_FORCED_ATTRIBUTE`). The existing CSS then fixes
  `color-scheme` and the `dark:` variant, also without JavaScript; the theme script and the theme
  hook leave it alone.
- **Nothing to choose:** the account menu drops its theme row, and the corner button on the
  signed-out pages offers the language alone, or isn't there with one language. A person's stored
  choice is kept, never deleted, and applies again once both modes come back.
- **The colours form follows:** in light mode only, the dark accent's field and preview are hidden
  but its value is still sent, so saving never clears it. In dark mode only, the previews show the
  dark page, and the accent is described as the emails' and the tab icon's.
- **Emails stay light** in every setting, as do the initials icon and the brand panel's glow, which
  take the light palette.

## Consequences

- An operator can keep every page in one mode, for every visitor, with or without JavaScript.
- Every palette still keeps the contrast rules in both modes, as "both" stays the default and a
  setting can change back at any time.
- `global-error.tsx`, which can't reach the database, keeps the person's or the system's mode, as it
  keeps the theme's colours.
- Other open tabs follow at their next full page load, as the brand colours do.

## Alternatives considered

- **Applying the mode only in the theme script:** visitors without JavaScript would still get the
  system's mode, logo included.
- **A separate attribute for the forced mode in the CSS:** more CSS for the same result, as
  `data-theme` already switches everything.
- **Deleting people's stored choice:** it would be lost when both modes come back, unlike a
  language that's turned off (its choice is kept too).
