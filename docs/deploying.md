# Deploying and running Adiutor

What to set up on a server, and how to run and look after it: installing and upgrading, deploying
on Vercel, the Docker image and health check, the client IP address, background jobs, logs, looking up the reference of
an error, rotating the auth secret, and what to do after a suspected leak. Back to the
[documentation](README.md).

## Installing and upgrading

**What's needed:** Node.js 26.13 or newer, the current LTS (`engines` in `package.json`, and
`.nvmrc`), pnpm in the version `packageManager` names, and PostgreSQL 18, as the local services and
CI use. Node.js no longer ships Corepack: install pnpm once with `npm install --global pnpm`, and it
switches to that version by itself.

**First install**, in the folder the app runs from:

1. `pnpm install --frozen-lockfile`, with the dev dependencies: the build needs them, and so do the
   commands you run on the server (see below). `HUSKY=0` skips installing the Git hooks, which a
   server doesn't need.
2. Set the environment: a `.env` file based on `.env.example`, or your platform's settings. The
   checklist below says what each setting needs on a server.
3. `pnpm build`, with those settings in place (CI builds the same way).
4. `pnpm db:migrate` creates the tables (drizzle-kit applies the migrations in `drizzle/`).
5. `pnpm start`, then the first-run step and the hourly jobs from the checklist below.

**Every new release:** get the new code, then `pnpm install --frozen-lockfile`, `pnpm build` and
`pnpm db:migrate`, and only then restart the app. Migrations bring the database to what the new
code expects, so the new build must never run against the old schema. If a release needs more
than this, its release notes (the changelog Release Please writes) say so.

**Don't prune the dev dependencies** (no `pnpm prune --prod`, and no slim image without them).
Commands you run on the server need them: `pnpm db:migrate` runs drizzle-kit, and
`pnpm setup:platform`, `pnpm jobs:run` and `pnpm sessions:revoke-all` run through tsx. Without
them, migrations, the hourly jobs, the first-run setup and signing everyone out after a leak all
fail, possibly in the middle of an incident.

## Vercel

Vercel runs two environments from two branches:

- **Production** follows releases: its branch is `production`, which only moves when a release is
  published.
- **Preview** follows `main`: every commit on `main` is a preview deployment, at an address of its
  own.

Every other branch is skipped, so pull requests get no preview deployments.

`vercel.json` sets how Vercel builds Adiutor. It's strict JSON, so it can't carry comments; this
section explains it instead. Both of its settings take precedence over the same fields in the
project's dashboard.

- **What's built** (`ignoreCommand`): Vercel builds a commit when the command exits with 1. It does
  for every commit on `main`, and for `production` only when the branch points at a release commit
  (one whose first line starts with `chore(main): release `), so a stray push to `production` never
  reaches production. Every other branch is skipped.
- **Each build migrates first** (`buildCommand`): for `main` and `production`, `pnpm db:migrate`
  runs before `pnpm build`, through the environment's `DATABASE_URL_UNPOOLED` (Neon's direct
  connection) or else its `DATABASE_URL`. Migrations should use a direct connection, not a pooled
  one. When migrating fails, the build fails and the previous deployment stays live, so new code
  never runs against the old schema.

**Moving production** (`.github/workflows/production-branch.yml`): when Release Please publishes a
release, this workflow moves `production` to the release's commit, creating the branch the first
time. It does so as Release Please's app, the one account besides repository admins that
[Protecting production](ci-and-releases.md#protecting-production) allows. It only moves forward (a fast-forward), so an older release can't replace a newer one; to roll
back, use Vercel's Instant Rollback. Run it by hand (Actions → Production branch → Run workflow, with
a tag such as `v0.2.0`) to move production to an existing release.

**Each environment needs its own settings** (Settings → Environment Variables):

- **A separate database for Preview.** Preview migrates on every commit to `main`. If it shared
  production's database, each migration would reach production before its release, and the live
  release would run against a schema it doesn't know. Either turn on the Neon integration's branch
  for preview deployments, or connect the integration to Production only, create a `preview` branch
  in Neon and set `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` for Preview yourself. Check
  that Preview's database host differs from Production's.
- **`BETTER_AUTH_URL`:** each environment's own address, or sign-in links and redirects point at the
  other one. GitHub and Google sign-in need Preview's address as a callback URL too; otherwise leave
  their settings unset in Preview.

**One-time setup, in this order:**

1. Give Preview its own database and settings, as above.
2. In Settings → Environments → Production, set the branch to `production`. Until it exists,
   production keeps its current deployment.
3. In Settings → Domains, give `main` a fixed address: a domain with **Git Branch** set to `main`
   always shows the latest commit.
4. Publish a release (see [Releases](ci-and-releases.md#releases)): the workflow creates
   `production` at it, and Vercel deploys it as production.

## Docker

The `Dockerfile` builds one image with the whole application: the built app, its source, scripts
and migrations, and every dependency (development ones included, for the reasons above). It runs
the app by default and every command below as a one-off, so the same image serves the site, the
hourly jobs and the first-run setup. Why one image instead of a small server image plus a tools
image is in [decision 0013](decisions/0013-one-docker-image-with-the-whole-application.md).

```bash
docker build -t adiutor .
```

`.dockerignore` keeps your `node_modules`, builds, test output, database files and `.env` out of
the image; the build uses placeholder settings and connects to nothing. Give the real settings when
you run it, never at build time, so they don't end up in the image:

```bash
docker run -d --name adiutor --env-file .env -p 127.0.0.1:3000:3000 adiutor
```

The image sets `NODE_ENV=production` and runs as the unprivileged `node` user on port 3000 (`PORT`
changes it). The settings are the same as without Docker (see the checklist below); when the
database runs on the host, `DATABASE_URL` points at the host's address (such as
`host.docker.internal` on Docker Desktop), not `localhost`.

**The database is yours to provide and look after**: the image contains no database, and it never
migrates on its own. Migrate as part of each release, before the new image serves traffic, with
your own process or with the image itself. The same goes for the other commands:

```bash
docker run --rm --env-file .env adiutor pnpm db:migrate
docker run --rm --env-file .env adiutor pnpm setup:platform --staff-name "Adiutor" --email you@adiutor.dev --name "Your Name"
docker run --rm --env-file .env adiutor pnpm jobs:run
docker run --rm --env-file .env adiutor pnpm sessions:revoke-all
```

Run `pnpm jobs:run` from cron every hour, as in [Background jobs](#background-jobs).

**Health check:** `GET /api/health` answers `200 {"status":"ok"}` when the database answers and has
every migration in `drizzle/` applied, and `503 {"status":"unavailable"}` otherwise, so a load
balancer or platform holds traffic from a server that can't reach its database or wasn't migrated.
The image's `HEALTHCHECK` uses it (`docker ps` shows the container as healthy or unhealthy). It
works signed out and tells nobody more than that; the reason it's unhealthy goes to the logs, as
the migration state or an error code, never connection details. Not cached.

**Published images:** every release publishes the image for amd64 and arm64, tagged with its
version, its minor line and `latest` (see [Docker image](ci-and-releases.md#docker-image)). While
the repository is private, so are they, so log in first:

```bash
docker login
docker pull bastolen/adiutor:0.1.0
```

From GitHub's registry instead, log in with a personal access token that can read packages
(`docker login ghcr.io`) and pull `ghcr.io/bastolen/adiutor:0.1.0`. Pull requests don't build the
image, so build it once yourself after changing the `Dockerfile`, the dependencies or the build.

## Before sharing the address

What to set up on a server before sharing its address:

- **Install, build and migrate:** as described in
  [Installing and upgrading](#installing-and-upgrading), and migrate again before starting each new
  release.
- **HTTPS everywhere.** `BETTER_AUTH_URL` must be `https://…`; cookies then get the `Secure` flag
  and the `__Secure-` prefix, and HSTS takes effect. With `NODE_ENV=production` the app (and every
  script) refuses to start with an `http://` address, except on this computer (`localhost`,
  `127.0.0.1`, `[::1]` or a `.localhost` name, which the end-to-end tests use).
- **Client IP:** set it up for your hosting and check it, as described in
  [Client IP address](#client-ip-address).
- **Sign-in providers that prove MFA** (GitHub: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`):
  keep their credentials set while staff or company Admins rely on them as their only MFA. Without
  them that MFA doesn't count, and such an Admin is treated like a newly invited one: after an
  email link they set up a passkey or an authenticator app, which whoever controls their inbox
  could do too. Before turning one off, have them add a passkey or an authenticator app. While
  it's off, staff Admins see a warning on the dashboard with how many users it affects
  (`getProviderMfaWarning`), and the Users list shows them as "Needs MFA".
- **First run:** complete `/setup` (or run `pnpm setup:platform`) right after deploying. Until then
  the first visitor becomes the staff Admin (see [First run](companies-and-roles.md#first-run)).
- **Email:** set `SMTP_URL` with TLS, since the emails carry sign-in links:
  `smtps://user:password@smtp.adiutor.dev:465` (TLS from the start), or
  `smtp://user:password@smtp.adiutor.dev:587?requireTLS=true` (STARTTLS, required). A plain
  `smtp://` URL only uses STARTTLS when the server offers it, so someone on the network could strip
  it and read the links; with `NODE_ENV=production` the app refuses one, except to a mail server on
  this computer. The app keeps up to 3 connections open and reuses them (nodemailer's pool), so a
  bulk invitation doesn't connect and sign in once per email; settings in the URL win, e.g.
  `?maxConnections=1` for a provider that allows one connection, or `?pool=false`. Never set
  `EMAIL_OUTBOX_DIR`.
- **No test data:** never run `pnpm db:seed` on a server. It deletes all data and adds a staff Admin
  whose password and authenticator secret are in the repository. It refuses to run when
  `BETTER_AUTH_URL` isn't on this computer (see [Test accounts](development.md#test-accounts)).
- **Secrets:** a random `BETTER_AUTH_SECRET` of at least 32 characters; rotate it as described in
  [Rotating the auth secret](#rotating-the-auth-secret).
- **Jobs:** run `pnpm jobs:run` hourly with `NODE_ENV=production` (see
  [Background jobs](#background-jobs)).
- **Logs:** successful requests log nothing that identifies anyone, but errors can: an email
  address an email failed for, a user's name, and so on (database values are left out, see
  [Logs](#logs)). Treat the app's output and the jobs log as personal data:
  - only the people who run the server can read them (not the whole team or a public dashboard);
  - keep them about 30 days (e.g. `logrotate` for `/var/log/adiutor-jobs.log`, or your platform's
    log retention setting);
  - mention them in your privacy notice: what's logged on errors, why and for how long.

## Client IP address

Every per-IP rate limit, the audit log, the signed-in devices list and the security emails use the
client's IP address. The app reads it the same way Better Auth does (`src/lib/request/ip-address-options.ts`):

- `CLIENT_IP_HEADERS` (default `x-forwarded-for`) names the headers to read, in order.
- Without `TRUSTED_PROXIES`, a header only counts when it holds a single address. A chain like
  `client, proxy` is ignored, since anyone can put an address at its left end.
- With `TRUSTED_PROXIES` (addresses or CIDR ranges), a chain is read from the right, skipping those
  addresses: the first other address is the client.

Whatever the setup, **clients must not be able to reach the app without going through your proxy
or platform**. Anyone who can talk to the app directly can send any IP header and choose their own
address: getting around the per-IP limits and putting fake addresses in the audit log and emails.

**VPS with Docker and a reverse proxy** (Caddy, nginx, Traefik):

1. Keep the app's port off the internet. Docker's published ports bypass firewalls such as ufw, so
   publish it on the loopback address only (`127.0.0.1:3000:3000` instead of `3000:3000`) when the
   proxy runs on the host, or don't publish it at all and put the proxy on the same Docker network.
2. Have the proxy replace `X-Real-IP` with the address that connected to it, whatever the client
   sent:
   - Caddy (`Caddyfile`):

     ```text
     adiutor.dev {
       reverse_proxy app:3000 {
         header_up X-Real-IP {remote_host}
       }
     }
     ```

   - nginx, in the `location` that proxies to the app: `proxy_set_header X-Real-IP $remote_addr;`
3. Set `CLIENT_IP_HEADERS=x-real-ip` and leave `TRUSTED_PROXIES` empty.

If you'd rather keep `X-Forwarded-For` (proxies add the client's address to its right end), set
`TRUSTED_PROXIES` instead. With a single proxy any value works, e.g. the proxy's own address, since
it only makes the app read the chain from the right. With more hops (a load balancer or CDN in front
of the proxy), list all of their addresses. Otherwise the app sees a hop's address, or none, instead
of the client's, so everyone shares one rate limit and one person can block password and email-link
sign-in for the whole site. When it sees none, Better Auth logs "Rate limiting could not determine a
client IP".

**Vercel:** nothing to set. Vercel replaces `X-Forwarded-For` with the client's address and drops
what the client sent, so the default works; leave both settings empty. Put no other proxy or CDN in
front of it without coming back to this section.

**Elsewhere:** platforms that add to a client's `X-Forwarded-For` instead of replacing it (such as
AWS load balancers and Heroku-style routers) need their addresses in `TRUSTED_PROXIES`, like a
second hop above. Behind Cloudflare, use `CLIENT_IP_HEADERS=cf-connecting-ip` and only accept
traffic from Cloudflare's addresses.

**Check after deploying:**

1. Sign in and open the Security page: under "Signed-in devices", this device shows your own
   public address (compare with `curl https://icanhazip.com`).
2. Try a forged address, with a wrong password for your own account:

   ```bash
   curl https://adiutor.dev/api/auth/sign-in/email -H 'Content-Type: application/json' -H 'Origin: https://adiutor.dev' -H 'X-Forwarded-For: 203.0.113.7' -H 'X-Real-IP: 203.0.113.7' -d '{"email":"user@adiutor.dev","password":"not-the-password"}'
   ```

   As a staff Admin, open your own account under **Users**: under **Recent activity**, that failed
   attempt must show your own address, not `203.0.113.7`.

3. On a VPS, from another machine, the app's own port must not answer:
   `curl -m 5 http://<server address>:3000` should fail.
4. The app's log must not show Better Auth's warning "Rate limiting could not determine a client
   IP".

## Background jobs

`pnpm jobs:run` (`scripts/run-jobs.ts`) runs the jobs once: it deletes expired sign-in links, codes
and sessions, finished rate-limit windows, sign-in errors and other recorded errors older than 7
days and audit events older than a year, clears provider
tokens a failed sign-in left behind, and sends invitation reminders. It's safe to run again at any time. A reminder
that can't be sent is undone (the invitation keeps its old link, which still works) and tried again
on the next run; the run still finishes the other jobs and reminders, then exits with 1, so cron's
mail or your monitoring tells you the mail setup is broken. In production, run it hourly from cron:

```cron
0 * * * * cd /srv/adiutor && pnpm jobs:run >> /var/log/adiutor-jobs.log 2>&1
```

## Logs

The server and the scripts in `scripts/` log to standard output and error. Before anything is
written, database values are taken out (`src/lib/log-redaction.ts`, installed by
`src/instrumentation.ts` and at the start of each script): a failed query is logged with its SQL,
its SQL state and constraint, and Next's `digest` of the error, but `params: [redacted]` instead
of the values it was sent, and without
Postgres's `detail` (e.g. `Key (email)=(…)`). That covers Next's own logging of errors
pages and server actions throw, Better Auth's logger and the app's own messages. Other text in
an error message stays, such as the address an SMTP server refused. In development without
`SMTP_URL`, emails are printed in full so their links can be opened (never in production).

## Looking up an error reference

When something fails unexpectedly, Adiutor's own error pages say so in the app's look (inside the
signed-in app the navigation stays) and show a reference such as `7KQ2-M9XD` with the time, which
users can copy and send to an administrator. The sign-in error page shows one too. To find out
what happened:

- **In the app**, as a staff Admin, open **Logs → Errors** (`/admin/logs/errors`) and look the
  reference up (case and the dash don't matter). It shows everything stored under it, and the
  page lists the errors of the last 7 days. After 7 days, or for errors over the limit below,
  use the server log.
- **In the server log**, search for the reference. Each error logs one line with the reference
  and where it happened, e.g.
  `App error TXCY-X79D: server render /(app)/companies/page (digest 2828711936)`; search for the
  digest to find Next's own log line with the stack. Sign-in errors log
  `Sign-in error 7KQ2-M9XD: state_mismatch`.
- **In the database**, for 7 days, query `app_error` (or `sign_in_error`) by `reference`:

  ```sql
  select created_at, source, route_type, route_path, path, name, message, user_id
  from app_error where reference = 'TXCY-X79D' order by created_at desc;
  ```

  A reference of a server error comes from Next's digest, so the same error happening again
  is stored again under the same reference, and the query can return several rows.

Rows hold where the error happened (`server` or `browser`, the route and the page's path without
its query string, with the token of an invitation, invite link or password reset link replaced by
`[token]`), the error's class name and message (database values taken out, at most 500
characters) and who was signed in. Errors are stored from `onRequestError` in
`src/instrumentation.ts` for the server, and reported by the error page for errors in the browser
(`src/server/app-errors.ts`); at most 20 per IP address per hour are stored, the rest only logged.

## Rotating the auth secret

`BETTER_AUTH_SECRET` signs cookies and encrypts authenticator secrets and backup codes. To replace
it without losing that data, use versioned secrets:

1. Keep `BETTER_AUTH_SECRET` as it is, and set `BETTER_AUTH_SECRETS="1:<new secret>"` (newest first;
   at least 32 characters). New data is encrypted with the new secret; data encrypted before still
   decrypts with `BETTER_AUTH_SECRET`.
2. Next time, add the new secret in front: `BETTER_AUTH_SECRETS="2:<newer>,1:<new>"`. Drop an old
   version only when nothing encrypted with it is left.

Changing the current secret signs everyone out once, because session cookies are signed with it.

## After a suspected leak

- **A session cookie or a user's device:** `pnpm sessions:revoke-all --user user@adiutor.dev` ends
  all of that user's sessions and forgets the devices they trusted, so a stolen one asks for the
  code step again; they're emailed. (An Admin can do the same from the user's page.)
- **The database:** sessions need their signed cookie, so the database alone gives no way in; to
  be safe, end every session and forget every trusted device with
  `pnpm sessions:revoke-all --yes` (nobody is emailed: tell users yourself if needed). Authenticator secrets and backup codes are encrypted with the secret, and
  passwords are hashed.
- **`BETTER_AUTH_SECRET`:** add a new secret as described above (which signs everyone out), then
  run `pnpm sessions:revoke-all --yes`. Ask users with an authenticator app to set it up again if
  the database may have leaked too, since its secrets were encrypted with the old secret.

Both are recorded in the audit log, with how many sessions were ended.
