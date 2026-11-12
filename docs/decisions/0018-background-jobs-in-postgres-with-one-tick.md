# 0018. Background jobs in PostgreSQL, started by one tick

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Adiutor runs on Vercel, where nothing keeps running between requests, and the hourly cron job that
ran `pnpm jobs:run` on a server had no equivalent. Invitation reminders stopped and old data stayed.
Requests (tickets) and billing will need much more background work, such as emails about ticket
updates, checks a while after something happened, and monthly runs. Self-hosted installs (Docker,
a plain server) must keep working too.

## Decision

- **One tick:** something calls Adiutor every 5 minutes: the endpoint for an external cron service
  or a Vercel schedule, or `pnpm jobs:run` for system cron. Adiutor decides what's due. Schedules are cron
  expressions in UTC, in code, so a new job never changes the hosting setup.
- **Two kinds of job** (`src/server/jobs`, see [Background jobs](../jobs.md)):
  - **recurring** jobs run on their schedule;
  - **queued** jobs are added by the app with IDs and small settings, run at the next tick, retry
    with growing waits and then stay failed. Jobs that share a batch key run together in one
    handler, so ten comments make one email.
- **State in PostgreSQL:** each job's state, the history of runs (30 days) and the queue live in
  the database Adiutor already has. A lease row keeps two runs of a job apart, because session
  locks don't survive a pooled connection such as Neon's.
- **Failures show:** a failed run is recorded and alerts staff Admins when it keeps failing, and
  the endpoint and the CLI report it, so the cron service or cron's mail sees it too.

## Consequences

- Every background task is a job in `src/server/jobs`: safe to run again, done within the tick's
  deadline (or in parts over several ticks), with counts but no personal data in its summary.
- A queued job runs at the next tick, so it can be up to 5 minutes late. Emails needed to sign in
  are never queued.
- On Vercel's Hobby plan, a Vercel schedule runs at most every 15 minutes (Schedules, in beta); the
  5-minute tick needs an external cron service, or the Pro plan.

## Alternatives considered

- **One cron entry per job:** simpler code, but every new job would change `vercel.json` and every
  server's crontab.
- **A hosted queue** (such as Upstash QStash or Inngest): another service and account, and
  self-hosted installs couldn't run without it.
- **A job library on Redis** (such as BullMQ): needs a long-running worker and a Redis server, which
  Vercel doesn't have.
- **pg-boss:** a full queue on PostgreSQL, but it expects a long-running process and its own schema;
  Adiutor needs far less, built from the patterns it already uses.
