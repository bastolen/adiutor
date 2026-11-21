# 0030. Times in each person's own time zone, which their browser sets first

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Every time Adiutor showed was in UTC and said so, on pages, in emails and in the day above copied
code. Companies and staff work in their own zones, so everyone had to work out their own time.

## Decision

Each account has a time zone (`user.time_zone`, an IANA name), and every time is shown in the
reader's zone:

- **The browser sets the first one.** The first time someone is signed in, their browser's zone is
  saved with their account (`saveFirstTimeZone`), once, never over a saved zone and never while a
  staff member is signed in as them. After that, the account's setting decides on every device.
- **Rendering reads a cookie**, like the language ([0020](0020-save-a-language-only-when-its-owner-picks-it.md)):
  `adiutor.time-zone` mirrors the account's zone, set at sign-in and whenever it's saved, and removed
  at sign-out. Without it (signed out, or before the first visit) pages use Adiutor's default zone
  (`staff_settings.default_time_zone`).
- **Emails** use the recipient's zone, else that of whoever sent their invitation, else the default
  (`recipientTimeZone`).
- **Pages show the time alone; emails and copied text name the zone.**

Details: [Time zones](../i18n.md#time-zones) and [Which time zone](../email.md#which-time-zone).

## Consequences

- Every helper in `src/lib/format.ts` takes the zone, so the compiler finds every place that shows a
  time, also in code written before this.
- The first visit can load the page once more, when the browser's zone isn't the default.
- Signed-out pages show the default zone, wherever the browser is.
- Timestamps stay in UTC in the database; only showing them uses a zone.
- A zone may have another name in another runtime (`Asia/Calcutta`, `Asia/Kolkata`), so `isTimeZone`
  accepts aliases as they're spelled.

## Alternatives considered

- **Format in the browser, in its own zone:** pages render on the server, so they would show one time
  and then another, and emails couldn't know the zone at all.
- **Ask everyone for their zone at their first sign-in:** an extra step, while the browser already
  knows.
- **A zone per company:** people in one company can sit in different zones; it can still come later.
- **Keep UTC with its name:** what everyone found hard to read.
