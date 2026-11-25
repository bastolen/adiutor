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

- **The operator chooses the storage,** behind one small interface (`FileStorage` in
  `src/server/storage/`: put, get as a stream, delete): a folder on the server's disk, or a
  bucket of any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, Garage, SeaweedFS).
  The server's environment chooses it (`ATTACHMENTS_STORAGE`); without a storage, attachments are
  off.
- **One S3 driver for every S3-compatible service,** with a configurable endpoint, signed with
  `aws4fetch` (AWS Signature V4 on `fetch`) rather than the AWS SDK: the driver needs four requests,
  not the SDK's hundred packages. Each upload is signed with its SHA-256.
- **Keys come from IDs only,** `attachments/<last two characters>/<ID>`, never from a file's name,
  and are the same paths in every storage, so files can be copied from one to another as they are.
- **Errors name a kind, never a reply:** a driver's failure says unreachable, refused, not found,
  not writable, timed out and the like (`StorageError`), so it can be logged and shown as it is.
- **The local disk is marked as Adiutor's:** a marker file, written with the first file, must be
  there before a file is read or deleted, so a server started without its volume fails loudly
  instead of taking every file for gone.

## Consequences

- A Vercel deployment needs a bucket; R2's free plan fits, and downloads cost nothing there.
- Local disk serves one server only, and a container that runs the jobs needs the same volume.
- Every call has a time limit (connecting, the first byte, and each next piece of a file that's
  read, rather than a whole file), so a slow storage fails a request instead of holding it.
- The integration tests run the S3 driver against a real S3 server (SeaweedFS in `compose.yaml`),
  locally and in CI.

## Alternatives considered

- **Files in PostgreSQL:** nothing to set up, and backups include them, but the database grows
  with every file and a hosted database's free plan is small.
- **The AWS SDK:** the reference client, but large, and its default checksums have broken uploads
  to S3-compatible services before.
- **A hosted file service** (such as Vercel Blob): another account, and self-hosted installs
  couldn't use it.
- **Presigned uploads straight to the bucket:** larger files on Vercel, but the bucket needs CORS,
  the Content Security Policy must allow its host, the server checks a file only after it's
  stored, and local disk would still need a second way in.
