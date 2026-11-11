# 0012. Tests cover the application only

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

The project's rule is to add or update tests with every change. That left open whether code outside
the application needs tests of its own: config, tooling, the scripts in `scripts/` and the test
helpers in `tests/`. Some of it had them: the dev seed's sample errors
(`scripts/sample-errors.test.ts`), the check on which database the tests use
(`tests/database/database-url.test.ts`) and the check on whether a local end-to-end run can reuse
the last build (`tests/build/build-state.test.ts`).

## Decision

Tests cover the application only. Config, tooling, the scripts in `scripts/` and the test helpers
in `tests/` have no tests of their own. The rule to add tests with every change is about
application code. The three tests above were removed on 2026-11-07, when this was decided.

## Consequences

- Vitest's unit project only picks up `src/**/*.test.{ts,tsx}` (`vitest.config.mts`).
- Unit and component tests sit next to the code in `src/`, integration tests (`*.int.test.ts`) next
  to the services they test, and Playwright specs in `e2e/`.
- A change that only touches config, CI or tooling is documented, not tested.
- Code outside the application is still linted and type-checked, and the test runs, scripts and CI
  that use it exercise it.
- One deliberate exception: the dev seed's safety guard (`src/lib/dev-seed-guard.ts`, with its test)
  stays in `src/lib` and keeps its test. It refuses to wipe a database that isn't local, so it
  prevents data loss.

Details: [Testing](../testing.md) and the "Code style" rules in `CLAUDE.md`.

## Alternatives considered

- **Testing scripts and test helpers like application code.** That was how things were before this
  decision. Those tests checked tooling rather than anything the app does, so they were judged not
  worth keeping up to date along with it.
