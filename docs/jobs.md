# Background jobs

Back to the [documentation](README.md).

Adiutor does some of its work in the background: cleaning up data nobody can use any more, keeping
data only as long as it may, and reminding people of invitations. That work runs as **jobs**, in
`src/server/jobs` ([decision 0018](decisions/0018-background-jobs-in-postgres-with-one-tick.md)):
**recurring** jobs run on a schedule, and **queued** jobs are added by the app to run once.

## The tick

Every 5 minutes something starts a **tick**: Vercel Cron or an external cron service calling the
[endpoint](#the-endpoint), or `pnpm jobs:run` from system cron or the Docker image (see
[Background jobs](deploying.md#background-jobs) and [Vercel](deploying.md#vercel) in the
deployment docs).
A tick runs every recurring job that's due, one after another, then the
[queued jobs](#queued-jobs) that are due (`runTick` in `src/server/jobs/tick.ts`). It stops starting
new runs at its deadline (4 minutes from the command line), and what's left waits for the next
tick.

- **Due** means the job never ran, or its schedule named a moment since its last run started. After
  a long silence (say, the server was down) a job runs once, not once per missed moment
  (`isDue` in `schedule.ts`).
- **One run at a time:** a run takes its job under a lease (`claimJob` in `state.ts`): a row in
  `job_state` with `locked_until` 15 minutes ahead. A second tick leaves the job to that run, and
  can't run it again for the same moment once it's done. A run that dies frees the job when the
  lease runs out. A lease row is used because PostgreSQL's session locks don't survive a pooled
  connection, such as Neon's.
- **Failures** don't stop the other jobs. A job fails when it throws, or when it finishes but
  reports a `failure` (say, some reminders couldn't be sent). The run is recorded as failed, the
  error is recorded with a reference (see [Failures](#failures)), and
  `job_state.consecutive_failures` counts failed runs in a row.
- **Paused** jobs (`job_state.paused_at`) are skipped by the tick. Running a job by hand still works.

## The jobs

| Job                          | Schedule (UTC)  | What it does                                                                                                                                  |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `leftover-provider-tokens`   | every 5 minutes | Clears OAuth tokens a failed GitHub or Google sign-in left behind, after 10 minutes                                                           |
| `finished-sign-ins-as-users` | every 5 minutes | Ends and records staff sign-ins as a user whose time is up or whose staff session is gone                                                     |
| `expired-sign-in-data`       | hourly          | Deletes expired sign-in links, codes and sessions, and finished rate-limit windows                                                            |
| `invitation-reminders`       | hourly, at :10  | Emails a reminder 48 hours before an invitation expires; one that can't be sent is tried again next run                                       |
| `retention`                  | daily, at 03:15 | Deletes audit events after a year, sign-in errors and other recorded errors after 7 days, and job runs and finished queued jobs after 30 days |

## The endpoint

`GET /api/jobs` runs one tick (`answerTickRequest` in `src/server/jobs/endpoint.ts`, the route in
`src/app/api/jobs/route.ts`). Only `GET`, since that's all Vercel Cron sends; a link checker or
prefetcher can't start a tick, because it needs the secret:

- It asks for `Authorization: Bearer <CRON_SECRET>`, compared in constant time. Vercel Cron sends
  that header by itself; an external cron service sends it as a request header. Without
  `CRON_SECRET` the endpoint is off and answers 503.
- A wrong or missing secret answers 401 and counts against the sender's IP address. Past 20 in 15
  minutes it answers 429, but the right secret still runs the tick, so someone sharing the cron
  service's address can't lock it out.
- With the right secret it runs one tick, stopping new runs after 45 seconds (the route's
  `maxDuration` is 60), and answers 200, or 500 when a run failed, with each run's job, status and
  counts. It's public in the proxy (`PUBLIC_PATHS`), since it checks its own secret, and never
  cached.

## Queued jobs

The app adds a job to the queue (`queued_job`) with `queueJob(db, kind, payload)`, inside the
transaction of the change it belongs to, so the job only exists if the change was saved. The next
tick runs it; with `runAt`, not before that moment.

- **Payload:** IDs and small settings only, such as `{ userId, kind: 'password_changed' }`, and
  lists of IDs for references to several things (`JobPayload`). Never personal data like names or
  addresses: the job reads what it needs when it runs, so nothing sensitive or out of date sits in
  the queue. Each kind checks its payload with a zod schema, when it's queued and when it runs.
- **Running:** due jobs run one at a time, oldest first (`runQueue` in `run-queue.ts`). A run takes
  the next job under a lease, skipping jobs another run is taking (`FOR UPDATE SKIP LOCKED`), so two
  ticks at once never run the same job.
- **How it ends:** `done`, or `skipped` when what it was about is gone (the job checks: say, the
  user was deleted meanwhile).
- **Retries:** a job that throws is tried again after 5 minutes, then 15, an hour and 6 hours
  (`RETRY_MINUTES` in `queue.ts`). After its kind's last attempt (`maxAttempts`, 5 by default: about
  7½ hours) it stays `failed`. Each failed attempt is recorded with a reference (see
  [Failures](#failures)), and the log names the jobs' IDs and attempts, never their payloads. A job
  whose run died (its lease ran out) is taken again, as another attempt.
- **Limits:** each kind runs at most its `perTick` jobs per tick (50 by default), so one large batch
  can't push the others out; the rest wait for the next tick. A paused kind's jobs wait too, and
  jobs of a kind the registry doesn't list are never taken.

### Batches: coupled jobs

Some jobs belong together: a status update and a comment on the same ticket for the same person
should make one email, not two. A kind made with `batch: { group, key }` instead of `run` doesn't
run its jobs on its own:

- Each job is queued with a **batch key**, `<group>:<key>`, where `key` comes from its payload (say,
  the ticket's and the person's IDs).
- When the tick takes a job with a batch key, it takes every other waiting, due job with the same
  key too, of any kind in the group, and hands them all to the group's batch
  (`defineJobBatch({ group, run })`) in one call. The batch reads each job's payload typed with its
  kind's `read`, and returns the IDs of jobs it skipped; the rest are done.
- **Each job is in exactly one batch.** Once taken, a job is no longer waiting, so a job queued
  after a batch ran goes in the next one: an email never repeats what an earlier one said.
- When the batch throws, all its jobs are tried again later, and the next try includes whatever was
  queued for the key meanwhile.
- Jobs are gathered until the next tick: whatever arrived since is sent together, which turns a
  burst of comments into one email. In the rare case that two ticks run at the same moment, they can
  split one key's jobs between them (two emails), but never run a job twice.

Each kind that ran jobs during a tick gets one run in the history, with how many were done,
skipped, retried and failed (given up); the run counts as failed when any job failed.

## Failures

Every failure is recorded as an error in the app (`recordJobError` in `record-error.ts`, which calls
`recordAppError` with source `job` and the job's name), so staff Admins look it up by its reference
under **Logs → Errors**, where it shows as a job error. The run in the history keeps the reference
(`job_run.error_reference`), and so does a failed queued job (`queued_job.last_error_reference`).
The server log gets one line with the job and the reference, never the error's message: it can
quote personal data, such as the address a mail server refused. Job errors are never rate-limited,
since no visitor can cause them, and they're deleted after 7 days like other recorded errors.

**The staff Admins are told** when a job keeps failing (`alertStaffAdmins` in `alerts.ts`): after a
recurring job's third failed run in a row, or when queued jobs are given up. Every active staff
Admin gets an email in their own language, with the last error's reference and a link to it under
Logs → Errors. At most one email a day goes out per job (`job_state.last_alert_at`), and it's sent
straight away, not through the queue, which may be what's broken. A mail problem is logged and never
stops the tick.

## History

Every finished run is a row in `job_run`: the job, what started it (`tick`, `cli` or `page`), when it
started and finished, how it ended, and what it did as counts, e.g. `{ "sessions": 12 }`. The
summary never holds personal data. The `retention` job deletes runs after 30 days
(`JOB_HISTORY_RETENTION_DAYS`).

## From the command line

| Command                  | What it does                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm jobs:run`          | One tick. Exits with 1 when a run failed, after the other jobs ran.                                                                                                  |
| `pnpm jobs:run <name>`   | Runs one job now, whether it's due or paused (unless another run holds it).                                                                                          |
| `pnpm jobs:list`         | Every job with its schedule, whether it's paused or running, its last and next run; each kind of queued job with how many wait and failed; and the failed jobs' IDs. |
| `pnpm jobs:retry <id>`   | Puts a failed queued job back in the queue with a fresh count of attempts; `--kind <name>` for every failed job of a kind.                                           |
| `pnpm jobs:discard <id>` | Discards a failed queued job; `--kind <name>` for every failed job of a kind.                                                                                        |

In production, run the tick every 5 minutes; see [Background jobs](deploying.md#background-jobs) in
the deployment docs. The command is thin (`scripts/jobs.ts`); the logic lives in the module and its
tests.

## Adding a recurring job

1. Add a file to `src/server/jobs/recurring/` that exports a job made with `defineRecurringJob`:
   - `name`: stable, in kebab-case. It's stored with the job's state and history, so don't rename
     it.
   - `schedule`: a cron expression in UTC with five fields, e.g. `0 6 1 * *` for 06:00 on the 1st.
   - `run(ctx, { deadline })`: does the work and returns `{ summary }` with counts, plus `failure`
     when it finished but something went wrong.
2. Add it to `RECURRING_JOBS` in `src/server/jobs/registry.ts`. The tick runs due jobs in that
   order.
3. Write its integration test next to it (`*.int.test.ts`), calling its `run` directly.

A job must be safe to run again at any time: a tick can stop between two jobs, and a run by hand can
follow a scheduled one. Work that can take longer than a tick should stop starting new pieces at
`deadline` and leave the rest for the next run.

## Adding a queued job

1. Add a file to `src/server/jobs/queued/` that exports a kind made with `defineQueuedJob`:
   - `name`: stable, in kebab-case. It's stored with each job, so don't rename it while jobs of it
     may be waiting.
   - `payload`: a zod schema of IDs, enums, numbers and booleans (see [Queued jobs](#queued-jobs)).
   - `run(ctx, job)`: reads what it needs with the IDs in `job.payload`, does the work and returns
     `'done'`, or `'skipped'` when what it was about is gone. It throws when it can't do its work,
     and must be safe to run again: an attempt can fail halfway and be retried.
   - `perTick` (optional): how many of its jobs one tick runs at most.
   - `maxAttempts` (optional): how many times a job is tried before it's given up.
   - Or, for jobs that run together, `batch: { group, key }` instead of `run`, and a batch for the
     group made with `defineJobBatch` (see [Batches](#batches-coupled-jobs)), added to `JOB_BATCHES`
     in the registry.
2. Add it to `QUEUED_JOBS` in `src/server/jobs/registry.ts`, and export it from the module's
   `index.ts` for the code that queues it.
3. Queue it with `queueJob(tx, kind, payload)` in the transaction of the change, and test it next
   to its file (`*.int.test.ts`), calling its `handle` or running the queue.
