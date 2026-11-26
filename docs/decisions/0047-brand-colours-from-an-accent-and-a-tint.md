# 0047. Brand colours from an accent and a tint, worked out to keep the rules

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Adiutor is meant to run in the look of whoever operates it, while still saying it's Adiutor; colour
comes first. The theme's four brand colours don't map to what the interface does: teal and green
are one role (the accent, in light and in dark mode), orange appears only in the logo, and ink is
the light mode's text and the base of the navy dark mode. Behind them are 23 mode-aware tokens and
a WCAG AA promise that tests check.

## Decision

- **Two choices, not the four colours:** a staff Admin chooses an **accent**, optionally a different
  **accent for dark mode**, and a **tint** (the `brand.*` settings). Everything else is worked out
  (`derivePalette` in `src/lib/branding`):
  - The tint gives its hue to every grey, in both modes and dark backgrounds included. Each grey
    keeps the theme's lightness and chroma, capped at a share of what its lightness and hue allow,
    and a grey tint gives plain greys.
  - The accent keeps its hue and how vivid it is. It's made darker in light mode, or lighter in
    dark mode, only as far as the rules need, and the text on it is white or the darkest grey.
  - Errors, statuses and highlighted code keep the theme's colours.
- **The rules are data:** `PALETTE_RULES` (text 4.5:1 on every surface and on buttons, borders of
  controls and focus rings 3:1, elevation in dark mode). The theme keeps them
  (`src/styles/theme.test.ts`), and so does every worked-out palette, for every hue the tests sweep.
- **Applied over the theme:** the root layout adds a `<style>` with a `:root:root` rule of only the
  tokens that differ (`paletteCss`), so pages, signed-out pages and error pages share it. Nothing
  chosen adds nothing. Emails take the light palette when they're sent.
- **Chosen in Settings, not at setup:** setup is one narrow form with no room for a preview.

## Consequences

- No palette can fail the contrast rules, whatever is chosen. The price is that an accent may show
  a little darker or lighter than chosen; the Settings page shows what will be used.
- A new colour token goes in `theme.css` and in `THEME_PALETTE`, and in the rules when it stands on
  another. A colour that should follow the brand is a token, never a fixed colour in a component.
- A colour set back to the theme's own is no row at all: `writeSettings` removes a setting written
  as `null`, since the table keeps no `null` values.
- `global-error.tsx` can't reach the database, so it keeps the theme's colours. So do the logo and
  the favicon until they can be uploaded.

## Alternatives considered

- **The four brand colours as pickers:** they don't match the roles; orange would change nothing.
- **Every token as a picker:** 46 values to keep readable and in step (dark mode's elevation).
- **An accent only:** a warm brand clashes with navy greys, and dark mode stays Adiutor's.
