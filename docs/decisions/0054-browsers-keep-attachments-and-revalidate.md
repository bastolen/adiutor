# 0054. Browsers keep attached files, and ask before each use

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

[Decision 0044](0044-attachments.md) served every attached file with `Cache-Control: no-store`, so
a shared computer keeps no file after sign-out. But every reload, new tab or new visit then
streamed each file from the storage again: a call to the bucket, or a new SSH connection per file
over SFTP. The request page's thumbnails are the files themselves, so a page of screenshots was
sent in full every time it loaded, and clicking a thumbnail to download it sent the file once more.

## Decision

Every attached file is served with `Cache-Control: private, no-cache` and its ID as its entity tag
(`ETag`; `entityTag` and `matchesIfNoneMatch` in `src/lib/request/conditional-get.ts`):

- **The browser keeps a copy, and asks before each use.** The route runs the same checks every time
  (`loadAttachment`: the reader may read the file's text, a note's only with
  `requests:view-internal`, the file isn't removed), and only then answers `304 Not Modified` to a
  browser whose copy is the file, without reading the storage (`readFile` reads it only for the
  bytes). A removed file, or a reader who lost access, gets "not found", whatever copy they kept.
- **The ID names the answer:** a file's bytes, name and type never change after it's uploaded.
- **Only the reader's browser keeps it** (`private`): who asks decides what's served, so no shared
  cache may keep it.
- **Signing out asks the browser to drop its cache** (`Clear-Site-Data: "cache"`,
  `clearCacheAtSignOut`), so the next person on a shared computer finds none of the files.

Details: [Security measures](../security-measures.md#files-people-attach).

## Consequences

- Loading a page again sends no file and reads no storage; downloading an image whose thumbnail
  loaded, or a file downloaded before, is a `304`. A first download is as fast as before.
- Copies can outlive the session: Firefox ignores `Clear-Site-Data: "cache"` for now, and a session
  that ends without signing out in that browser (it expires, it's signed out from another device,
  or the account deactivates itself, which a server action can't send the header for) clears
  nothing. Each copy is only what that person could read, and is used only once the server says so.
- Anyone who can read the computer's browser cache, outside the browser, can read such a copy.

## Alternatives considered

- **Keep `no-store`:** nothing on the computer, but every view costs the storage and the transfer.
- **`max-age` for thumbnails:** no request at all for a while, but a removed file or a lost access
  would still show from the browser's own copy until it expired.
- **A cache on the server:** saves the storage for the first view by each browser too, but holds
  copies a removal must reach on every server, and helps little on short-lived serverless
  instances.
- **Small previews for thumbnails:** a fraction of the bytes, but a decoder for untrusted images on
  the server and a second file per image to keep and delete; not chosen for now.
