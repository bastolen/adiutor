# 0016. Ship Inter and JetBrains Mono

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Adiutor used each device's own system font: San Francisco on Apple devices, Segoe UI on Windows,
Roboto on Android and DejaVu Sans on Linux, which is also what the CI's browsers use. These differ
in width, so text that fit on a Mac didn't fit on CI or on some phones. The 320px checks in
`e2e/a11y.spec.ts` (placeholders, clipped boxes, sideways scrolling) passed locally and failed on
CI for the same page. No font is installed on every device, so the only way to get the same text
everywhere is to ship one.

## Decision

- **Inter for text and JetBrains Mono for codes, URL names and references**, loaded with
  `next/font/google` in `src/lib/fonts.ts`, with their variables (`--font-inter`,
  `--font-jetbrains-mono`) at the front of `--font-sans` and `--font-mono` in
  `src/styles/theme.css`. Only the Latin subset, which covers English, Dutch and Spanish.
- **Downloaded when the app is built, served from Adiutor's own domain:** visitors never contact
  Google, and the Content Security Policy's `font-src 'self'` covers them. `next/font` adds a
  size-adjusted fallback, so text doesn't jump while the fonts load.
- **Licence:** both are under the SIL Open Font License 1.1. It allows using, embedding and
  redistributing them with software, commercially too and even when the software is sold (a SaaS
  or a licence), but not selling the fonts by themselves, and asks that their copyright and licence
  go with them: `LICENSES/OFL-1.1-Inter.txt` and `LICENSES/OFL-1.1-JetBrains-Mono.txt`.
- **Emails keep the system fonts:** many email clients block or strip web fonts
  (`src/components/email/theme.ts`).

## Consequences

- Text looks and measures the same on every device and in CI, so a layout check that passes
  locally passes there too.
- A build needs internet access to fetch the fonts (CI, Vercel and the Docker build have it).
- The first page loads two font files (the Latin subsets, preloaded); later pages use the cached
  copies.

## Alternatives considered

- **Keep the system fonts and test with a wide stand-in** (Verdana) locally. Cheaper, but real
  devices would still differ, and every new text would need checking against the widest font.
- **Font files in the repository (`next/font/local`).** Builds without internet, but the files and
  their updates would be ours to manage; `next/font/google` subsets and updates them for us.
