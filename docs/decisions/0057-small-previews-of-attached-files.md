# 0057. Small previews of attached files, drawn on the server

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

The tiles under a request's texts showed an image by loading the file itself from `/attachments/<id>`
([decision 0044](0044-attachments.md)), so a page of screenshots sent megabytes the first time it
loaded, even with browsers keeping copies ([decision 0054](0054-browsers-keep-attachments-and-revalidate.md)),
and every other kind of file showed only an icon. Decision 0054 left small previews "not chosen for
now": they need a decoder for untrusted files on the server, and a second file per attachment to keep
and delete.

## Decision

- **A preview per file, drawn on the server:** a WebP image that fits inside 480 pixels, without
  metadata, kept in the attachments' storage next to the file (`previewKey`) and deleted with it.
  `request_attachment.preview` says where it stands: `drawn`, `none` (tried and impossible: the
  icon), or not drawn yet. Nothing outside `src/server/previews/` draws.
- **Images** (PNG, JPEG, a GIF's first frame, WebP) are drawn with sharp (libvips), which Next.js
  already brings, prebuilt; only after the bytes' signature says they're one of those four, with a
  pixel and a time limit (`src/server/previews/limits.ts`).
- **A PDF's first page** is drawn with PDFium built to WebAssembly (`@embedpdf/pdfium`: an MIT
  wrapper of BSD-licensed PDFium, without JavaScript or XFA), in a worker thread, with the module's
  memory capped at 256 MiB before it's compiled and a 5-second limit, after which the worker is
  stopped; one PDF at a time per server.
- **An Office or OpenDocument file** shows the thumbnail it carries (always in OpenDocument files,
  usually in PowerPoint's, rarely in Word's or Excel's), read by a small zip reader of our own with
  hard caps (`zip-entry.ts`) and drawn again like an image; PNG or JPEG only.
- **A video** shows a frame its uploader's browser drew (`video-frame.ts`, a hidden muted `<video>`
  on the file's `blob:` address, which the page's `media-src blob:` allows), sent once the upload is
  done and taken once, for the uploader's own unsent upload (`setVideoFrame`), then drawn again
  within the image limits. Its tile carries a play mark. A video the browser can't decode keeps its
  icon.
- **Drawn at upload,** from the bytes the upload already holds, at most two at a time per server. A
  drawing that can't start, or a preview the storage refuses, is left for the `attachment-previews`
  job, which also draws the files attached before previews existed; a file that can't be drawn is
  `none`. A preview never fails the upload.
- **Served from `/attachments/<id>/preview`** with the file's own checks and caching (decision
  0054), as `image/webp`, and a download if it's opened on its own. A tile shows a preview or an
  icon, never the file itself.

Details: [Files people attach](../security-measures.md#files-people-attach) and
[Attachments](../requests.md#attachments).

## Consequences

- A tile costs a few kilobytes instead of the whole file.
- Untrusted images are decoded on the server. Only four signatures reach libvips, and every drawing
  has its limits, but a flaw in one of those decoders now reaches the server's process: sharp must
  stay up to date (Renovate updates it with Next.js).
- A server uses more memory while it draws, up to two large images at once.
- A PDF that needs a password, is broken, or is past a limit keeps its icon. A stuck PDF costs a
  worker thread for 5 seconds, then a new one.
- An Office file's thumbnail is its own claim of what it looks like, made by the program that saved
  it, not a drawing of its content; most Word and Excel files have none and keep their icon.
- A video's frame is its uploader's claim, like an Office file's thumbnail: a browser made to lie
  can send any picture, shown only to the readers of that file. Videos uploaded before previews
  existed keep their icon, as no browser is there to draw them.
- HEIC keeps its icon: prebuilt sharp has no HEVC decoder, and adding one brings LGPL code and
  patent questions.

## Alternatives considered

- **Keep showing the file itself:** no decoder on the server, but a page of screenshots costs
  megabytes, and only images get a picture.
- **Draw on first view:** the first reader waits, and the drawing runs inside a page's request; at
  upload the bytes are already in memory.
- **An outside image service:** sends the companies' files to a third party.
- **MuPDF or Ghostscript for PDFs:** both AGPL, which doesn't fit Adiutor's MIT licence. Poppler is
  GPL and a native program the Docker image, a plain server and Vercel would each need installed.
- **LibreOffice to draw Office files:** a faithful page for every file, but a large native program
  to install everywhere, seconds per file, and a far larger surface for untrusted files.
- **A zip library:** more than one entry needs, where a reader of a hundred lines can refuse
  everything it doesn't need (zip64, encryption, other packings).
- **ffmpeg for videos:** decodes every video on the server, but it's a large native program (with
  GPL builds and patent questions for H.264 and HEVC), and decoding untrusted video is a large
  surface; the uploader's browser has already decoded the file.
- **PDF.js:** draws in a browser; on a server it needs a canvas library of its own and runs the
  PDF's fonts and images through JavaScript in the server's process.
