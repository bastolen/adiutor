# 0052. The staff's logo, and the browser tab icon made from it

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Adiutor runs in its operator's colours ([decision 0049](0049-brand-colours-from-an-accent-and-a-tint.md))
and under the staff's name ([decision 0050](0050-the-staffs-name-instead-of-adiutor.md)), but every
page, email and browser tab still showed Adiutor's logo and icon. A staff Admin should be able to
upload the operator's logo, without having to make a favicon too. The logo has to show on the
signed-out pages and in emails, so it must be reachable without a session, on every install:
attachments storage is optional, and there's no image library to resize or convert images. SVG can
carry scripts and is refused everywhere.

## Decision

- **Kept in the database:** the logo and an optional own icon are rows of `brand_image` (one per
  kind), not files in the attachments storage, so every install has them with nothing to set up,
  database backups hold them, and a page reads them without a network call. They're small: at most
  1 MB uploaded, smaller once drawn.
- **Only a PNG Adiutor drew:** an upload must be a PNG or JPEG by its first bytes, of a size and
  shape that fits (`imageFacts`, `brandImageProblem`), read from its header before anything decodes
  it. It's then drawn again with Next's `ImageResponse` into a PNG that fits its box (1024×256 for
  the logo, 512×512 for an icon), and only that is stored and served: whatever else the file held
  (a JPEG's location, a PNG's text) stays behind, an image that doesn't decode draws empty and is
  refused (`isBlankPng`), and mail clients always get a PNG.
- **One logo for both modes:** the staff Admins' choice. The Appearance tab previews it on the
  light and the dark palette, and suggests a transparent background.
- **The icon is made from the brand:** an own icon if one was uploaded, else the logo when it's
  about square (`isAboutSquare`), else the staff name's initials in white on the light accent;
  Adiutor's while neither was uploaded (`brandIconSource`). A name whose initials aren't Latin
  letters, which the built-in font can't draw, gets the logo fitted into the square instead.
- **Served to anyone from `/branding`:** `/branding/logo` and `/branding/icon` (32 pixels, or 180
  for the Apple touch icon) are public paths with the fixed file policy, `nosniff` and no session.
  Their address carries a version (the logo's row ID, or a hash of what the icon is drawn from), so
  it may be kept for a year; any other address for five minutes, so an old email still shows what's
  current. `/favicon.ico` is rewritten to an `.ico` of the 32-pixel icon, or redirects to Adiutor's
  own. Each version of the icon is drawn once per process, whatever a request asks for.

## Consequences

- An uploaded logo shows at once in the sidebar, on the signed-out and error pages and in every
  email (32 pixels high, at most 200 wide), and the browser tab follows; renaming the staff or
  changing the accent changes an icon made of initials too.
- Without an upload, every page, email and icon is Adiutor's as before. `global-error.tsx`, which
  can't reach the database, keeps none.
- An install moved without its database loses the logo with everything else; one restored from a
  backup gets it back.
- Uploading and removing are staff Admins' (`staff:manage`), rate-limited and audited. A JPEG's
  orientation tag isn't applied when it's drawn, so a rotated photo stays as stored.

## Alternatives considered

- **The attachments storage:** no logo on installs without storage, and a network call (to S3 or
  SFTP) for every page's logo or a cache to keep.
- **Serving the uploaded file itself:** simpler, but it would serve whatever the file holds,
  metadata included, and emails would need a PNG anyway.
- **A separate dark-mode logo:** more to upload and explain; the preview shows whether one logo
  works on both.
- **Always cropping the logo's left square for the icon:** fits a symbol beside a wordmark, but cuts
  a plain wordmark mid-letter.
- **An `app/icon.tsx` file:** its address is fixed at build, so a new logo would stay invisible in
  browsers that keep the old icon.
