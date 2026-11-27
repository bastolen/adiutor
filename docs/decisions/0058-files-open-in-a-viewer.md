# 0058. A request's files open in a viewer

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

A file's tile on a request was a download link ([decision 0044](0044-attachments.md): every file
"always as a download"), so looking at a screenshot meant downloading it and opening it elsewhere,
and the previews of [decision 0057](0057-small-previews-of-attached-files.md) are too small to read
a screenshot or a page. People asked to see a file where it's attached, and to keep downloading it
from its tile.

## Decision

- **A tile opens the file in a viewer** (`AttachmentViewer` in `src/app/(app)/_requests/`, a
  dialog built on `Modal`), and keeps a Download button of its own; the viewer has one too.
  Previous and Next, and the arrow keys, step through every file the reader can see on the page,
  in its order.
- **The viewer shows a file only from its own address, after the same checks:** an image as it is
  (an `<img>` from `/attachments/<id>`, which the page's `img-src 'self'` already allowed), a PDF's
  first page drawn large at upload (`/attachments/<id>/page`, 1,600 pixels), a text file's first
  200 KB as text (read as a part of the file, `Range`), an Office file's thumbnail, and for
  anything else its icon. Nothing is shown in a frame, and nothing the file holds
  runs.
- **Navigating to a file is still a download** under the fixed policy that runs nothing
  (`FILE_POLICY`): decision 0044's rule holds for the address itself.

Details: [Attachments](../requests.md#attachments) and
[Files people attach](../security-measures.md#files-people-attach).

## Consequences

- Opening an image loads the whole file, as the tiles did before decision 0057; the tiles stay
  small.
- A PDF shows only its first page; the rest is a download. A PDF drawn before pages were shows its
  preview instead.
- A HEIC photo shows only in a browser that decodes it (Safari); elsewhere it's its icon.
- A long log shows its start; the rest is a download.

## Alternatives considered

- **The browser's own PDF viewer in a frame:** every page, but it would need the file served inline
  in a frame, which the file policy (`sandbox`) and decision 0044 rule out.
- **Every page of a PDF drawn on request:** much more drawing on the server for each look, and a
  page limit anyway.
- **Steps through the files of one text only:** simpler, but a request's screenshots are usually
  spread over its replies.
