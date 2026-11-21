# 0034. Settings in one key/value table, typed and checked in code

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Adiutor kept its settings in three tables of one row each: `staff_settings` (the staff's name,
languages, time zone and request prefix; its existence meant "set up"), `request_counter` and
`job_tick`. Each new setting took a column or a table, a migration and its own read-or-create code,
and saving a setting when the row was missing recreated it, which quietly marked Adiutor as set up.

## Decision

- **One `setting` table:** a row per setting, a unique `key` and a `jsonb` `value`.
- **Typed in code:** `src/server/settings/` declares every setting (key, zod schema, fallback) and
  is the only code that reads or writes the table. `readSettings` reads several in one query and
  gives the fallback for a missing row or one its schema refuses; `writeSettings` checks the
  values, locks the rows it changes (and those a check needs), runs the checks between settings
  and upserts, in the caller's transaction.
- **Set up is a setting of its own:** `setup.completed_at`, added once by setup (the key's unique
  index stops a second setup at the same moment). Saving any other setting never sets Adiutor up.
- **The request counter** is `requests.last_number`, counted by one upsert that holds the row until
  the request is stored, as before.

## Consequences

- A new setting is an entry in the registry, without a migration.
- The database no longer checks the values: a known language, at least one offered, the default
  among the offered ones ([decision 0029](0029-staff-choose-the-offered-languages.md) made that a
  database check), a single row. The schemas and `SETTING_CHECKS` check them in the writing
  transaction instead, so nothing may write the table around `src/server/settings/`.
- A value that no longer passes its schema (e.g. a language later removed) reads as the fallback.

## Alternatives considered

- **Keep a table or column per setting:** typed by the database, but a migration for every setting
  and a "set up" that depended on a row existing.
- **One wide settings row:** one table, still a migration per setting.
