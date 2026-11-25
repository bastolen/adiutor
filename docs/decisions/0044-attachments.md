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

- **Several storages behind one small interface** (`FileStorage` in
  `src/server/storage/`: put, get as a stream, delete): a folder on the server's disk, a bucket
  of any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, Garage, SeaweedFS), or a
  folder on another server over SFTP (`ssh2`). Without a storage, attachments are off.
- **Settings chooses it, unless the environment does:** a staff Admin sets it up on the
  Attachments tab, and the server's environment (`ATTACHMENTS_STORAGE`, or `off`) wins over it, so
  an operator can fix it, or keep staff from choosing one; the tab then only shows it.
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
- **A folder is marked as Adiutor's:** on the local disk and over SFTP, a marker file, written
  with the first file, must be there before a file is read or deleted, so a server started
  without its volume fails loudly instead of taking every file for gone.

## Consequences

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
- **Presigned uploads straight to the bucket:** larger files on Vercel, but the bucket needs CORS,
  the Content Security Policy must allow its host, the server checks a file only after it's
  stored, and local disk would still need a second way in.
