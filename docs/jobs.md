# Background jobs

Back to the [documentation](README.md).

Adiutor does some of its work in the background: cleaning up data nobody can use any more, keeping
data only as long as it may, reminding people of invitations and sending emails that can wait a few
minutes. That work runs as jobs, in `src/server/jobs`
([decision 0018](decisions/0018-background-jobs-in-postgres-with-one-tick.md)). How to start them on
each kind of hosting is in [Background jobs](deploying.md#background-jobs) in the deployment docs.

## Words

- **Tick:** one pass over the jobs, started every 5 minutes (every minute by `pnpm dev`, see
  [Development](development.md#background-jobs)). It runs the recurring jobs that are due, then the
  queued jobs that are due.
- **Recurring job:** runs on its own schedule ("scheduled" on the Jobs page).
- **Queued job:** work the app hands off to run once, at the next tick. Its **kind** says what it
  does, such as `security-notice`.
- **Run:** one recurring job's turn in a tick, or one kind's queued jobs in a tick. Every run is kept
  in the history.
- **Attempt:** one try at a queued job. A failed attempt is attempted again later, until the job is
  **given up** (`failed` in the database). Staff can **retry** a job that was given up.

## The tick

A tick runs every recurring job that's due, one after another, then the queued jobs that are due
(`runTick` in `tick.ts`), until its deadline; what's left waits for the next tick.

- **Due** means the job never ran, or its schedule named a moment since its last run started. After
  a long silence a job runs once, not once per missed moment (`isDue` in `schedule.ts`).
- **One run at a time:** a run holds its job under a lease (`job_state.locked_until`), so a second
  tick leaves the job alone. A lease row is used because PostgreSQL's session locks don't survive a
  pooled connection, such as Neon's.
- **Paused** jobs are skipped by the tick (`job_state.paused_at`). Running one by hand still works.
- **Failures** don't stop the other jobs (see [Failures](#failures)).

## The jobs

| Job                          | Schedule (UTC)  | What it does                                                                                                                                  |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `leftover-provider-tokens`   | every 5 minutes | Clears OAuth tokens a failed GitHub or Google sign-in left behind, after 10 minutes                                                           |
| `finished-sign-ins-as-users` | every 5 minutes | Ends and records staff sign-ins as a user whose time is up or whose staff session is gone                                                     |
| `expired-sign-in-data`       | hourly          | Deletes expired sign-in links, codes and sessions, and finished rate-limit windows                                                            |
| `invitation-reminders`       | hourly, at :10  | Emails a reminder 48 hours before an invitation expires, soonest first, until its deadline; the rest go next run                              |
| `retention`                  | daily, at 03:15 | Deletes audit events after a year, sign-in errors and other recorded errors after 7 days, and job runs and finished queued jobs after 30 days |

`retention` deletes 10,000 rows at a time until its deadline, so a large backlog is cleared over a
few runs without holding the database for long.

`invitation-reminders` sends 3 reminders at a time (as many as the mail pool has connections,
`SMTP_MAX_CONNECTIONS`), and never lets a run that's stopped cost an invitee their link. A run
first claims the invitation (`invitation.reminder_claimed_at`), which leaves the link alone; it
stores the reminder's new link, with `reminder_sent_at`, only once the email is out; and a reminder
that can't be sent gives the claim back. A run that's stopped mid-send (the platform's 60 seconds,
a crash) leaves its claim behind: the link they have keeps working, and after 15 minutes
(`REMINDER_LEASE_MINUTES`) the next run takes the invitation again. That costs a second reminder,
and the first one's link, if it arrived, never works.

| Kind of queued job  | What it does                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `security-notice`   | Emails a user about a security change on their account (see [Security emails](authentication.md#security-emails))                                                  |
| `added-to-company`  | Emails a user that staff added them to a company; skipped when the membership is gone by then                                                                      |
| `staff-admin-added` | Emails one staff Admin that someone became a staff Admin (one job per Admin, so a refusal for one never resends the others); skipped for an Admin who stepped down |

## The endpoint

`GET /api/jobs` runs one tick (`answerTickRequest` in `endpoint.ts`). It asks for
`Authorization: Bearer <CRON_SECRET>`, compared in constant time, and is off (503) without
`CRON_SECRET`. A wrong secret answers 401 and counts against the sender's IP address, 429 past 20 in
15 minutes, but the right secret always runs the tick. It answers 200, or 500 when a run failed,
with each run's counts and whether the tick `continues`. It's public in the proxy, since it checks
its own secret, and never cached.

**Continuing a tick:** when a tick stops at its deadline with work still due and it ran something,
the endpoint calls itself again after answering (`afterAnswer`, run with `after()`), so a backlog
doesn't wait for the next tick. The call goes to the app's own address (`BETTER_AUTH_URL`, never a
host from the request) with the secret, the step in `x-adiutor-tick-continuation` and, on a
protected Preview, `x-vercel-protection-bypass`. A continued call answers 202 at once and runs its
tick afterwards, so no function waits on another. It stops after 16 steps in a row
(`MAX_TICK_CONTINUATIONS`, nearly 7 minutes of extra work), or when only jobs waiting for a later
attempt are left. A continuation
that fails is logged, and the next tick takes over. `pnpm jobs:run` doesn't continue: it runs until
the queue is empty or its time is up.

## Queued jobs

The app queues a job with `queueJob(tx, kind, payload)` from `src/server/queue`, inside the
transaction of the change it belongs to, so the job only exists if the change was saved.

- **Payload:** IDs and small settings only, such as `{ userId, kind: 'password_changed' }`. Never
  names, addresses or other personal data: the job reads what it needs when it runs. Each kind checks
  its payload with a zod schema when it's queued and when it runs.
- **Running:** the kinds take turns, one job each, oldest first (`runQueue` in `run-queue.ts`), so a
  kind with many jobs can't keep the others waiting. Jobs are taken with `FOR UPDATE SKIP LOCKED`,
  so two ticks never run the same job.
- **How it ends:** `done`, or `skipped` when what it was about is gone (say, the user was deleted).
- **Attempts:** a job that throws is attempted again after 5 minutes, then 15, an hour and 6 hours.
  After its kind's last attempt (`maxAttempts`, 5 by default) it's given up. A job whose attempt
  died (see [Failures](#failures)) is taken again, as its next attempt.

**Batches:** some jobs belong together, such as a status update and a comment on the same ticket
for the same person, which should make one email. A kind declared with `batch: { group, key }` is
queued with a batch key; when the tick takes one of its jobs, it takes every waiting job with the
same key too, of any kind in the group, and hands them to the group's batch in one call (its
kinds are handled with `batchedJobRunner`, and the batch, made with `defineJobBatch`, goes in
`JOB_BATCHES`). Each job is in exactly one batch, so an email never repeats an earlier one, and a batch
that throws is attempted again with whatever was queued for its key meanwhile.

**At least once:** a job's work and the note that it's done are two steps. When the note can't be
written (the database dropped the write), only that job is attempted again, so its work can happen
twice; the jobs of its batch that were noted stay finished. A failure never puts a finished job back
in the queue (`retryQueuedJobLater` and giving up only touch jobs that are still `running`).

## Failures

A failure is recorded as an error in the app (`recordJobError`), so staff Admins look it up by its
reference under **Logs → Errors**. The run in the history keeps the reference, and so does a queued
job that failed. The server log gets the job and the reference, never the error's message, which can
quote personal data.

**The limits:** a tick starts new runs for 25 seconds from the endpoint (and when a job is run
from the Jobs page) and 4 minutes from the command line, and the recurring jobs get at most the
first half of that, so the queue always has time. On Vercel the platform stops the endpoint's
function after 60 seconds. The 25 follow from that (`REQUEST_RUN_SECONDS` in `tick.ts`): work
started just before the deadline must still end and be recorded. The longest such piece is one
email, which fails after 15 seconds (`SEND_TIMEOUT_MS` in `src/lib/email-limits.ts`); when that
job fails for good, the staff Admins' alert follows (below), up to another 15; then 5 seconds to
answer: 60 − 15 − 15 − 5 = 25. A lease lasts 15 minutes.

**A run that never finishes** (say, the platform stopped it at 60 seconds) fails too. A recurring
run always frees its lease when it ends, so a lease that ran out means its run died: the next tick
records it as a failed run (`recordUnfinishedRuns` in `run.ts`), once, and the job runs again at its
next scheduled moment. A queued job whose attempt died uses up that attempt.

**The staff Admins are told** when a job keeps failing (`alerts.ts`): after a recurring job's third
failed run in a row, or when queued jobs are given up. Each active staff Admin gets an email in their
own language with the error's reference, at most once a day per job, sent straight away rather than
through the queue, in time the tick keeps for it (see the limits above): an alert cut off mid-send
would be lost and still count as the day's. An alert that reached nobody (not one email could be sent, as when the mail
server is what's down) doesn't count as the day's alert: the next failure sends it.

**When the ticks stop**, no job runs and none can tell anyone. So every tick notes when it started
(`job_tick`, `recordTick` in `tick-record.ts`), and when none started in the last 45 minutes
(`TICK_LATE_MINUTES`; Vercel's 15-minute schedule can fire up to 30 minutes apart), or none ever did,
the Jobs page and the dashboard of staff who see the jobs warn that background jobs aren't running
(`getTickWarning`).

## History

Every run is a row in `job_run`: the job, what started it (`tick`, `cli` or `page`), when, how it
ended and what it did as counts, e.g. `{ "sessions": 12 }`, never personal data. A tick's run for a
scheduled moment that succeeded without doing anything isn't kept, or the every-5-minutes jobs would
bury the rest; its job's state still says when it last ran. Runs started by hand are always kept. The
`retention` job deletes runs after 30 days.

## From the command line

| Command                  | What it does                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `pnpm jobs:run`          | One tick. Exits with 1 when a run failed, after the other jobs ran.                                            |
| `pnpm jobs:run <name>`   | Runs one recurring job now, whether it's due or paused (unless another run holds it).                          |
| `pnpm jobs:list`         | Every job with its state, last and next run; each kind of queued job with how many wait and failed; failed IDs |
| `pnpm jobs:retry <id>`   | Retries a failed queued job, with a fresh count of attempts; `--kind <name>` for every failed job of a kind    |
| `pnpm jobs:discard <id>` | Discards a failed queued job; `--kind <name>` for every failed job of a kind                                   |

## For staff

Staff Admins and Managers (`jobs:view`) see the jobs under **Logs → Jobs** (`/admin/logs/jobs`): when
the last tick started; the scheduled jobs with what each does, its schedule in words, its last and
next run, all in the reader's time zone (a schedule's hour and minute come from its next run,
`nextRunOf`, so they stay right when the clocks change; one words can't say shows its cron
expression, marked as UTC); the kinds of queued job with how many wait and failed; the failed queued jobs; and the
runs of the last 30 days that did something, failed or were started by hand. Error references link
to Logs → Errors for those who may see it (`errors:view`).

Staff Admins (`jobs:manage`) also run a recurring job now (for at most 40 seconds of new work; the
page's `maxDuration` is 60), pause and resume jobs, and retry or discard failed queued jobs, one or
all of a kind (`controls.ts`). Each is recorded in the audit log, never allowed while signed in as
someone, and discarding asks first. A failed job of a kind the registry no longer lists can only be
discarded, from the page and from the command line: no tick would take it, so a retry leaves it
failed (`retryFailedQueuedJobs`). Jobs that keep Adiutor secure can't be paused (`pausable:
false`: security notices, new staff Admins, leftover provider tokens and finished sign-ins as a
user), and run even with a pause left in the database.

## Adding a recurring job

1. Add a file to `src/server/jobs/recurring/` that exports a job made with `defineRecurringJob`:
   - `name`: stable, in kebab-case, since it's stored with the job's state and history;
   - `schedule`: a cron expression in UTC with five fields, e.g. `0 6 1 * *` for 06:00 on the 1st
     (a name or schedule that's wrong stops the app from loading);
   - `run(ctx, { deadline })`: does the work and returns `{ summary }` with counts, plus `failure`
     when it finished but something went wrong. Each count is one of `JOB_SUMMARY_KEYS` in
     `src/lib/job-names.ts`, with its words in `jobs.summary.<count>`.
2. Add it to `RECURRING_JOBS` in `registry.ts` (the tick runs them in that order), and its name to
   `RECURRING_JOB_NAMES` in `src/lib/job-names.ts` in the same place, with what it does in
   `jobs.descriptions.<name>` in every language.
3. Test it next to its file (`*.int.test.ts`), calling its `run`.

A job must be safe to run again at any time. Keep each piece of work to seconds, with a time limit
on every network call (`ctx.sendEmail` has one: 15 seconds for a whole send, `SEND_TIMEOUT_MS`), and
stop starting new pieces at `deadline`, leaving the rest for the next run (see
[the limits](#failures)). A piece of work that can take longer than an email needs the tick's
deadline moved up with it (`REQUEST_RUN_SECONDS`).

## Adding a queued job

A queued job comes in two parts, in two modules, so code that queues jobs never imports the code
that runs them:

1. **Declare the kind** in `src/server/queue/` with `defineQueuedKind`, and export it from that
   module's `index.ts`: its `name` (stable, in kebab-case), its `payload` schema, and optionally
   `maxAttempts`, `pausable: false` (for jobs that keep Adiutor secure) and `batch`.
2. **Handle it** in `src/server/jobs/queued/` with `handleQueuedJob(kind, run)`, and add it to
   `QUEUED_JOBS` in `registry.ts` and its name to `QUEUED_JOB_NAMES` in `src/lib/job-names.ts`, with
   what it does in `jobs.descriptions.<name>`. `run(ctx, job)` reads what it needs with the IDs in
   `job.payload` and returns `'done'`, or `'skipped'` when what it was about is gone. It throws when
   it can't do its work, and must be safe to run again, taking seconds like a recurring job.
3. **Queue it** with `queueJob(tx, kind, payload)` in the change's transaction, and test the handler
   next to its file.
