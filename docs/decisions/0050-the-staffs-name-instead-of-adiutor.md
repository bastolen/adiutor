# 0050. The staff's name instead of Adiutor, with "Powered by Adiutor"

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Adiutor is meant to run in the look of whoever operates it, while still saying it's Adiutor
([decision 0049](0049-brand-colours-from-an-accent-and-a-tint.md) did the colours). The word
"Adiutor" was written into 168 messages, 95 of them in emails, and into authenticator entries and
passkey prompts. The staff already have a name, `staff.name` ("Acme Support"), set at setup and in
Settings, shown on requests and in invitations.

## Decision

- **One name, the staff's:** every text that said "Adiutor" names the staff instead, through the
  `{staff}` argument (`requestStaffName()` on the server, `useStaffName()` in client components,
  `emailName(brand)` in emails), staff-only texts too. "Adiutor" until setup names the staff, so
  an install that keeps it reads as before.
- **No odd sentences:** a text must read right with "Adiutor" and with a team's name; no article
  before the name and no compounds with it, and where an invitation's target is the staff
  themselves the name appears once (a `target` select). A guard test refuses "Adiutor" outside the
  texts that name the software itself (its default colours, setup, placeholders, "Powered by
  Adiutor") and formats every `{staff}` text with a team's name to catch repeats and articles.
- **"Powered by Adiutor"** shows on the sign-in pages, in the app's sidebar and in every email's
  footer, once the staff's name isn't Adiutor's own (`poweredByShown`).
- **New authenticator entries and passkeys** are labelled "Acme Support (Adiutor)"
  (`signInAppName`): Better Auth takes them from the request's app name, which a guard sets for the
  endpoints that create them. Entries made earlier keep their label; passkeys are bound to the host,
  never to the label.

## Consequences

- An install whose staff name is set shows it everywhere at once, the seed's "Adiutor Tests" too.
- A new text never says "Adiutor": it takes `{staff}` or is worded without a name, and the guard
  test enforces it. A name read per request falls back to "Adiutor" when the database can't be
  read; `global-error.tsx`, which can't reach it, always says "Adiutor".
- The email From name stays `EMAIL_FROM`'s, and the logo and favicon stay Adiutor's until they can
  be uploaded.

## Alternatives considered

- **A separate product name next to the staff's:** reads right in more sentences without
  rewording, but two names to set and explain, where the staff's name already is what users see.
- **Only the texts users see:** staff-only texts would keep "Adiutor", which an operator's staff
  would read as someone else's product.
- **Changing existing authenticator entries and passkeys:** not possible; their label was stored
  when they were made.
