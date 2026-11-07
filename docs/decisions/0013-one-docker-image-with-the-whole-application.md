# 0013. One Docker image with the whole application

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Running Adiutor takes more than the server. You also run commands on it: `pnpm db:migrate` runs
drizzle-kit, and `pnpm jobs:run`, `pnpm setup:platform` and `pnpm sessions:revoke-all` run through
tsx. Both are dev dependencies. Without them, migrations, the hourly jobs, the first-run setup and
signing everyone out after a leak all fail, possibly in the middle of an incident.

## Decision

A multi-stage `Dockerfile` (earlier stages build, the last one is what ships) ends in one image that
holds the whole application with all its dependencies, dev ones included.

- By default it runs the server: `pnpm start` as the non-root `node` user, on port 3000, with a
  `HEALTHCHECK` on `/api/health`.
- The same image runs the other commands as one-offs: `pnpm jobs:run` (hourly, from cron),
  `pnpm setup:platform`, `pnpm sessions:revoke-all` and `pnpm db:migrate`.
- The database is the operator's responsibility. The image holds none, and never migrates on its
  own.
- `/api/health` answers 200 when the database answers and every migration is applied, and 503
  otherwise.

## Consequences

- There's one image to build and keep working, for the server and every command.
- The image is bigger than a server-only one would be, since it carries the dev dependencies.
- You run `pnpm db:migrate` yourself before starting a new release, as without Docker. Until you
  do, the health check answers 503, so a new build running against the old schema shows up as
  unhealthy.
- Every release publishes the image, for amd64 and arm64, to Docker Hub (`bastolen/adiutor`) and
  GitHub's container registry (`ghcr.io/bastolen/adiutor`), private while the repository is. Pull
  requests don't build it, so a change that breaks the build shows up at the next release or a
  local build.

Details: [Docker](../deploying.md#docker) and
[Installing and upgrading](../deploying.md#installing-and-upgrading).

## Alternatives considered

- **Next.js's standalone output for a small server image, plus a separate image for the commands.**
  Rejected: two images to keep working, and `next start`, which the end-to-end tests use, doesn't
  support standalone output.
- **A database in a compose file.** Rejected: the database isn't Adiutor's responsibility.
