# 0046. Webhooks: news about requests for the staff's systems

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Adiutor emails the people on a request ([decision 0031](0031-emails-about-requests.md)), but
nothing told other systems: the staff couldn't route a type of request to their procurement tool
or post what happens into a chat channel. What's sent leaves Adiutor for good, the address is typed
by a person and the server connects to it.

## Decision

How it works is in [Webhooks](../webhooks.md). The choices behind it:

- **The staff who manage request types set them up** (`staff:manage`, Settings › Webhooks). Each
  covers every request type or chosen ones, and picks its events: raised, replies, status changes,
  assignees, details, internal notes.
- **A webhook is a recipient of the news job** (`request-update`): one tick's news about a request
  is one delivery with its events in order, read when it's sent. The job makes the first attempt
  (a queued one makes it while the webhook is failing, so a dead receiver never holds up the
  emails); later ones are the delivery's own (5 minutes to 24 hours), since the queue retries only
  by throwing. Three days of failures, or `410 Gone`, turn it off and email the staff Admins.
- **Signed JSON by the Standard Webhooks specification, or a chat message** in Adiutor's default
  language, in which no one's text can ping a channel.
- **People by name and side only:** never an address, a user ID or who was signed in as whom.
- **The address is a secret too,** sealed like the signing secret, which is shown once.
- **Never inside Adiutor's network,** checked on every connection; only the operator can allow a
  network (`WEBHOOK_ALLOWED_NETWORKS`).
- **A security setting:** a change that can send more needs a second step from the last 15
  minutes; every change is rate-limited and audited with the name and host only.
- **A test is sent while the Admin waits** (10 seconds at most): an exception to
  [decision 0018](0018-background-jobs-in-postgres-with-one-tick.md).

## Consequences

- Internal notes and priorities leave Adiutor wherever a staff Admin points a webhook that chose
  them; the form says so.
- New news for webhooks is queued in `tellWebhooks`; a new kind of entry decides its event in
  `src/lib/webhooks.ts`.
- Delivery is at least once: receivers drop duplicates by `webhook-id` or an event's ID.
- Dropping an old auth secret makes sealed addresses unreadable; such a webhook turns off until
  it's given its address and a new secret.

## Alternatives considered

- **A webhook per request type:** one chat channel for everything took one webhook per type.
- **One delivery per event:** a reply and the status it set would be two chat messages.
- **The queue's own retries:** about 7 hours, an app error per attempt, and the staff Admins'
  alert for a fault outside Adiutor.
- **Checking the address only when it's saved:** a name can resolve elsewhere later.
