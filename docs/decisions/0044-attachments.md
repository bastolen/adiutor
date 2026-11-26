# 0044. Attachments: files kept where the operator chooses, behind one interface

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

People raising requests want to attach screenshots, logs and documents. Adiutor runs on Vercel,
whose disk doesn't keep files, and as one Docker image on a server of its own
([decision 0013](0013-one-docker-image-with-the-whole-application.md)), and self-hosters should be
able to keep files for free on what they already have. The database could hold the files, but it
would grow with every screenshot, and a hosted database's free plan is small.

## Decision

How to set it up is in [Deploying](../deploying.md#attachments). The choices behind it:

- **Uploads go through Adiutor, a file at a time,** as soon as it's picked, to a route that checks
  who sends it, its size, its type by extension and by its first bytes (an allow-list), before
  it's stored; the text's form then sends the files' IDs, and its service claims them. The largest
  file is chosen per install, at most 50 MB, and 4 on Vercel, which refuses a larger request body.
- **Served by Adiutor, always as a download:** a file comes from `/attachments/<id>` to whoever
  may read its text, with `Content-Disposition: attachment`, `nosniff`, no caching and a policy
  that runs nothing. Images show as thumbnails from the same address, so nothing loads from
  elsewhere ([decision 0021](0021-markdown-for-request-text.md) keeps images in a text as links).
- **The upload is the one route the proxy skips:** the proxy holds every body in memory, whoever
  sends it, and cuts one over its limit short without a word. Raising its limit would let anyone
  make the server hold that much for any path; the route checks the session and the origin itself.
- **Several storages behind one small interface** (`FileStorage` in
  `src/server/storage/`: put, get as a stream, delete): a folder on the server's disk, a bucket
  of any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, Garage, SeaweedFS), or a
  folder on another server over SFTP (`ssh2`). Without a storage, attachments are off.
- **Settings chooses it, unless the environment does:** a staff Admin sets it up on the
  Attachments tab, and the server's environment (`ATTACHMENTS_STORAGE`, or `off`) wins over it, so
  an operator can fix it, or keep staff from choosing one; the tab then only shows it.
- **Attaching has a switch of its own,** "People can attach files", off until a staff Admin turns
  it on and only once there's a storage: a storage can be set up and tried before anyone attaches,
  and attaching turned off again without losing it. Files already attached stay downloadable.
- **Only the uploader sends an upload:** a text takes only its writer's own unsent uploads (with the
  same staff member signed in as them, if one was), and a file that isn't theirs refuses the whole
  text without naming it.
- **Only the staff who work on requests remove a file,** at any time, and removing deletes it: a
  file attached by mistake (a password in a screenshot) must be gone from the storage, not hidden.
  Its row stays as the mark of who removed it, so the text doesn't silently change.
- **Files can be added to a text later, in an edit:** an edit that only adds files keeps no version
  and doesn't mark the text edited, since versions keep what a text said, and the files show with
  it.
- **A storage is tried before it's saved** (a small file written, read back and deleted), with the
  staff Admin's second step from the last 15 minutes and a record in the audit log: it decides
  where every company's files go, and holds credentials.
- **Its secrets are encrypted** with Better Auth's `symmetricEncrypt` and the versioned auth
  secrets, as authenticator secrets are, never shown again, and kept only for the place they were
  saved for: another S3 service or key, or another SFTP server, port or user, must be given them
  again, so a changed host can't receive a saved password.
- **One S3 driver for every S3-compatible service,** with a configurable endpoint, signed with
  `aws4fetch` (AWS Signature V4 on `fetch`) rather than the AWS SDK: the driver needs four requests,
  not the SDK's hundred packages. Each upload is signed with its SHA-256.
- **SFTP checks the server's host key** against a fingerprint the operator gives, on every
  connection, and a connection to any other key is refused.
- **Keys come from IDs only,** `attachments/<last two characters>/<ID>`, never from a file's name,
  and are the same paths in every storage, so files can be copied from one to another as they are.
- **Errors name a kind, never a reply:** a driver's failure says unreachable, refused, not found,
  not writable, timed out and the like (`StorageError`), so it can be logged and shown as it is.
- **A folder is marked as Adiutor's, on purpose:** on the local disk and over SFTP, a marker file
  must be there before a file is stored, read or deleted, so a server started without its volume
  fails loudly instead of keeping files on a disk that goes away or taking every file for gone.
  Only setting the folder up writes it (the test before a storage is saved, or a staff Admin's
  **Set up this folder** for one the environment chooses), never an upload: the first upload on a
  fresh container would otherwise mark the wrong folder.

## Consequences

- An upload is unsent until a text claims it, for a day; a job purges what's left after 25 hours,
  file and row.

- A Vercel deployment needs a bucket; R2's free plan fits, and downloads cost nothing there.
- Local disk serves one server only, and a container that runs the jobs needs the same volume.
- Every call has a time limit (connecting, the first byte, and each next piece of a file that's
  read, rather than a whole file), so a slow storage fails a request instead of holding it.
- The integration tests run the S3 and SFTP drivers against real servers (SeaweedFS and OpenSSH
  in `compose.yaml`), locally and in CI.
- `ssh2` runs in plain JavaScript: its native cipher code isn't built, and its optional
  `cpu-features` isn't installed (`ignoredOptionalDependencies`), since an unbuilt one kept Next's
  development server reloading every page that imports `ssh2`.

- A staff Admin can make the server connect to any address it reaches by saving a storage, which
  a server of your own on the local network needs. The test reports only the kind of failure,
  never the reply, and an operator who doesn't want this sets the storage, or `off`.

## Alternatives considered

- **The environment alone:** simpler and out of reach of the web, but every change needs the
  operator and a restart, and a Vercel project's secrets are set in another place again.

- **Files in PostgreSQL:** nothing to set up, and backups include them, but the database grows
  with every file and a hosted database's free plan is small.
- **The AWS SDK:** the reference client, but large, and its default checksums have broken uploads
  to S3-compatible services before.
- **A hosted file service** (such as Vercel Blob): another account, and self-hosted installs
  couldn't use it.
- **Raising the proxy's body limit** (`proxyClientMaxBodySize`) instead of skipping it for the
  upload: every request to any path, signed in or not, could then make the server hold the
  largest file's worth of memory.
- **Presigned uploads straight to the bucket:** larger files on Vercel, but the bucket needs CORS,
  the Content Security Policy must allow its host, the server checks a file only after it's
  stored, and local disk would still need a second way in.
