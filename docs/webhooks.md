# Webhooks

Back to the [documentation](README.md).

A webhook is an address Adiutor sends what happens to requests to: a system of the staff's own (a
procurement tool, a script, an automation service) as signed JSON, or a chat channel as a message.
Why it works this way is in [decision 0046](decisions/0046-webhooks.md).

## Who sets them up

The staff who manage request types (`staff:manage`: staff Admins) add, change, turn off and on and
remove webhooks, and renew their signing secrets (`src/server/webhooks/manage.ts`). Nobody else
sees them, and a staff member signed in as a user can't change them
([decision 0028](decisions/0028-request-work-while-signed-in-as-a-user.md)).

A webhook has:

- **A name**, which the staff choose (at most 80 characters, by the rules for names, since the
  email that tells the staff Admins it was turned off quotes it).
- **An address**, `https://` in production (see [Addresses](#addresses)). It's a secret too: a chat
  app's address carries its token. It's stored sealed and never shown again; Settings shows its
  host. Left empty when the webhook is changed, it keeps the saved one.
- **A format:** signed JSON, or a chat message.
- **The request types it covers:** all of them, new ones too, or the ones chosen.
- **Its events**, at least one: a request raised, a reply (a solution included), a status change,
  a staff member assigned or removed, a change of title, type or priority, an internal note.
  Internal notes and priorities go wherever the webhook sends, so choose them only for a place
  that the staff alone read.
- **A signing secret** (`whsec_` and 32 random bytes), made by Adiutor, sealed, and shown once:
  when the webhook is added and when it's renewed. A renewed secret replaces the old one straight
  away.

## How news reaches a webhook

A webhook is a recipient of the news about requests, like a person on a request
([decision 0031](decisions/0031-emails-about-requests.md)), through the same queued job:

- **Who hears of what** is decided in one place, `tellWebhooks` (`src/server/requests/tell-webhooks.ts`),
  in the transaction of each change: a webhook that's on hears of the events it chose, on the request
  types it covers, whoever made the change. A change of type reaches the webhooks of the type it
  had and of the type it got, each once. Each piece of news is a `request-update` job for the
  webhook, holding IDs only (the request, the webhook, the type that matched, the event and the
  entry).
- **One delivery per tick:** the jobs of one webhook about one request share a batch key, so a reply
  and the status change it brought, or three replies in five minutes, go out as one delivery with
  their events in order (`deliverWebhookNews` in `src/server/webhooks/deliver.ts`).
- **Checked again when it's sent:** news for a webhook that's off or gone, that no longer chooses
  the event or covers the type the news was queued for, or about an entry that's gone, is skipped.
- **The first attempt** is made by the job, straight away; the delivery is recorded with the IDs of
  what it tells of (`webhook_delivery`), its result and the receiver's status, never its answer. A
  receiver that fails is recorded, never thrown: it fails no job and records no error in the app.
  An attempt goes on only while the delivery is still at the attempt before it, and records only
  if that still holds, so an attempt run twice never records twice. Deliveries are kept for 30
  days (the `retention` job, see [Background jobs](jobs.md#the-jobs)).
- **At least once:** a job that ran but couldn't be noted as done is run again, and its news can
  then go out in a second delivery, as an email can arrive twice. A receiver drops what it already
  has by an event's `id`.

## Retries and turning off

A receiver that doesn't take a delivery (anything but a `2xx` answer, no answer within 10 seconds,
a redirect, an address that can't be reached) is tried again, the same delivery with the same
`webhook-id`, 5 minutes, 30 minutes, 2 hours, 8 hours and a day after the attempt before
(`WEBHOOK_RETRY_MINUTES` in `src/lib/webhooks.ts`): six attempts over about a day and a half. Each
later attempt is a `webhook-delivery` job of its own, queued for when it's due, and every attempt
reads the news afresh, so a text edited meanwhile goes out as it is by then. After the sixth, the
delivery is given up (`failed`).

These are the delivery's own attempts, not the queue's: the queue retries a job only when it throws,
on one schedule for every kind, recording an error in the app each time and alerting the staff
Admins once it gives up, and a receiver that's down is no fault of Adiutor's. A delivery's job throws
only for Adiutor's own faults (the database), and the queue then tries it again as it would any
job. On the Jobs page a refused delivery counts as done; the webhook's deliveries show what
happened.

A webhook turns itself off (`src/server/webhooks/deliver.ts`):

- **after three days of nothing but failures** (`WEBHOOK_FAILING_DAYS`): every attempt since the
  last one a receiver took has failed (`webhook.failing_since`), so a receiver that's been gone for
  days doesn't keep a queue of attempts going;
- **at once when its receiver answers `410 Gone`**, as the Standard Webhooks specification
  describes for a receiver that's gone for good;
- **when its address or secret can't be read any more** (an old auth secret was dropped).

Turning off cancels what was still to be delivered to it, records `webhook_turned_off` in the audit
log with why (by nobody: Adiutor did it), and emails every active staff Admin
(`webhook-turned-off`, in their language, naming the webhook and why, never its address). A staff
Admin turns it on again once its receiver works; it then starts with a clean slate, and what
happened while it was off isn't sent.

## Tests and sending again

The staff who manage webhooks see a webhook's deliveries of the last 30 days, newest first: what
each told of (its events and request), its status, its attempts, the receiver's last status or how
the last attempt failed, and when the next one is due (`listDeliveries` in
`src/server/webhooks/history.ts`), never what was sent or what the receiver answered.

- **A test** (`sendTestEvent`) is sent while the Admin waits, at most 10 seconds, and the page says
  how it went: `webhook.test` with the webhook's name, or a chat message saying it works. A
  webhook that's off can be tested, to check it before turning it on. It's recorded among the
  deliveries, and never counts towards turning the webhook off. It's sent from the request rather
  than queued, an exception to [decision 0018](decisions/0018-background-jobs-in-postgres-with-one-tick.md)
  that [decision 0046](decisions/0046-webhooks.md) records: a queued test could wait minutes for a
  tick.
- **Send again** (`resendDelivery`) gives a delivery that's over (delivered, failed or cancelled)
  one more attempt at the next tick, with the same `webhook-id`, whatever it had before; once its
  own attempts ran out, no further ones follow by themselves. Only for a webhook that's on, and
  never a test.
- Both connect to an address, so they share a limit: 20 per staff Admin per hour
  (`webhookSendsPerUser`).

## What's sent

What a webhook is told is read when it's sent (`readWebhookNews` in
`src/server/requests/read-webhook-news.ts`), like an email about a request: the request as it is by
then, and its events in the order they happened. People are named as the request's page names them:
their own name, or their side's (the company's name, the staff's name) once their account is gone.
The people a text mentions are "@" and their name. Never an email address, a user ID, a link that
signs anyone in, or who did something while signed in as someone else
([decision 0028](decisions/0028-request-work-while-signed-in-as-a-user.md)).

### JSON

The Standard Webhooks shape, `{ type, timestamp, data }` (`jsonBody` in
`src/server/webhooks/formats.ts`):

```json
{
  "type": "request.updated",
  "timestamp": "2026-11-25T10:05:00.000Z",
  "data": {
    "request": {
      "id": "019abcde-…",
      "number": 142,
      "reference": "AD-142",
      "title": "The printer is broken",
      "status": "proposed",
      "type": { "key": "bug", "name": "Bug" },
      "priority": "high",
      "company": { "id": "019abcde-…", "name": "Adiutor" },
      "url": "https://adiutor.dev/requests/142?entry=019abcdf-…#entry-019abcdf-…",
      "raisedAt": "2026-11-25T09:12:00.000Z",
      "lastActivityAt": "2026-11-25T10:00:00.000Z"
    },
    "events": [
      {
        "type": "reply",
        "id": "019abcdf-…",
        "at": "2026-11-25T10:00:00.000Z",
        "by": { "name": "Ann Admin", "side": "staff" },
        "text": { "format": "markdown", "text": "Fixed it, see @Sam Support's note." }
      },
      {
        "type": "status",
        "id": "019abce0-…",
        "at": "2026-11-25T10:00:00.000Z",
        "by": { "name": "Ann Admin", "side": "staff" },
        "from": "in_progress",
        "to": "proposed"
      }
    ]
  }
}
```

- **The request:** its status, priority and type key are the values Adiutor stores (`open`,
  `todo`, `in_progress`, `waiting`, `proposed`, `done`, `cancelled`; `low`, `normal`, `high`), its
  link opens its page at the first event that has a place there.
- **The events**, each with an `id` (the entry of the request's history; the request's for
  `raised`), `at` and `by` (a name and a side, `company` or `staff`):
  - `raised`: the request was raised, with its description as `text`;
  - `reply` and `note`: a reply or an internal note, with its `text` as it is now (`format`
    `markdown`, or `plain` for a text written before Markdown);
  - `status`: `from` and `to`; a solution is a reply followed by a status change to `proposed`;
  - `assignee`: `change` (`assigned` or `unassigned`) and `person`, the staff member's name (`null`
    once their account is gone);
  - `details`: `field` (`title`, `type` or `priority`), `from` and `to` (a type as its key and
    name).
- **A test** is `{ "type": "webhook.test", "timestamp": "…", "data": { "webhook": { "name": "…" } } }`.

### Chat

A `{"text": "…"}` message, which Slack, Google Chat, Mattermost and Discord's Slack-compatible
address (`…/slack`) take as it is, in Adiutor's default language (`chatBody`): the reference and
title, a sentence per event (the `webhooks` catalogue), up to 300 characters of each text, and the
link on a line of its own. A text is shortened to its words: its formatting, links' addresses and
images are left out. What someone wrote can never form a chat app's markup: `<` and `>` become `‹`
and `›` (so no `<!here>`, `<@id>` or `<users/all>`), every `@` is followed by a word joiner (so
no `@here`, `@channel`, `@everyone` or a mention of anyone), and `![` is broken up (so no image
loads). A delivery with more events than fit in 3,000 characters says how many more there were.

## Changes are security changes

A webhook sends request texts out of Adiutor, so a stolen staff Admin session could use one to read
along:

- **A recent second step:** adding, changing, renewing the secret and turning on need the Admin's
  second step from the last 15 minutes (`confirmation_required`). Turning off and removing don't:
  they send less.
- **Rate-limited:** 30 changes per staff Admin per hour (`webhookChangesPerUser`), and 20 tests and
  deliveries sent again (`webhookSendsPerUser`).
- **In the audit log** (Companies and staff): `webhook_added`, `webhook_changed` (with what
  changed, and the host an address replaced), `webhook_secret_renewed`, `webhook_turned_off` (with
  why), `webhook_turned_on` and `webhook_removed`, each with the webhook's name and host, never its
  address or secret.
- **Turning off** cancels what was still to be delivered. **Turning on** needs an address and a
  secret that can still be read, starts with a clean slate (no days of failures behind it), and
  sends nothing of what happened meanwhile.

## Addresses

A webhook never reaches Adiutor's own network: an address that is, or resolves to, a private,
loopback, link-local, shared or reserved address is refused when it's saved and on every connection
(`src/server/webhooks/address-guard.ts`; how, and why, is under
[Webhooks' addresses](security-measures.md#webhooks-addresses)). An operator can allow a network of
their own with `WEBHOOK_ALLOWED_NETWORKS` (see [Webhooks](deploying.md#webhooks) in Deploying).

## Secrets

The address and the signing secret are sealed with the auth secret (`src/server/sealed-secrets.ts`,
Better Auth's `symmetricEncrypt` with the versioned secrets), so
[Rotating the auth secret](deploying.md#rotating-the-auth-secret) holds for them: keep an old
version while webhooks sealed with it are left. One that can't be read any more is turned off,
until it's given its address again and a new secret.

## Verifying a delivery

Every delivery is signed as the [Standard Webhooks](https://www.standardwebhooks.com)
specification describes, with three headers:

- `webhook-id`: the delivery's ID, the same on every attempt, so a receiver can drop one it already
  has;
- `webhook-timestamp`: when this attempt was sent, in seconds since 1970, so a receiver can refuse
  an old one as a replay (5 minutes is usual);
- `webhook-signature`: `v1,` and the base64 HMAC-SHA-256 of `<webhook-id>.<webhook-timestamp>.<body>`,
  keyed with the secret's bytes (the base64 after `whsec_`).

The specification's libraries check all three. By hand, compare in constant time and use the body
exactly as received.
