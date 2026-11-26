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

## Changes are security changes

A webhook sends request texts out of Adiutor, so a stolen staff Admin session could use one to read
along:

- **A recent second step:** adding, changing, renewing the secret and turning on need the Admin's
  second step from the last 15 minutes (`confirmation_required`). Turning off and removing don't:
  they send less.
- **Rate-limited:** 30 changes per staff Admin per hour (`webhookChangesPerUser`).
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
