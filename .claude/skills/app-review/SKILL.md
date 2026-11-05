---
name: app-review
description: Full read-only, opinionated review of how this application is built (design and code quality, performance and data access, UX, UI and accessibility, tests, docs and tooling, plus a light security pass), with every finding verified by an independent skeptic, ending in a report ordered by value and a question about what to fix. Use when asked to review the app, for a second opinion, what you would do differently, or a code quality review. Code placement and unused code are /placement-check's job.
---

# App review

Review how this application is built, and report what an experienced engineer would do
differently, and why. Change nothing: this skill only reports. If the user named a lens or an
area when invoking it, review only that, but still verify and report the same way.

Where code lives and unused code are `/placement-check`'s job (`.claude/skills/placement-check/SKILL.md`);
leave them out. A light security pass is part of this review, but it never replaces a proper
security review.

## How to run it

Run it as a workflow (the Workflow tool): one reviewer per lens below, each looking at the whole
repository, then one skeptic per lens who tries to disprove each of that reviewer's findings.
Everyone stays read-only: no edits, moves or deletions, and no tests, builds, dev servers,
Playwright or `pnpm install`/`dlx` while reviewing. Reading files, grep and one-off read-only
scripts are fine. Most files may be untracked, so reviewers use the filesystem rather than
`git diff`.

What's reviewed is the same as for `/placement-check`: `src/` (`app`, `components`, `lib`,
`server`, `db`, `emails`, `styles`), `drizzle/`, `scripts/`, `tests/`, `e2e/`, `public/`, the
root config, `.github/`, the root Markdown files and `docs/`. Not part of the review: anything
Git ignores (`.gitignore`), such as `node_modules`, `.next` and test output.
`git ls-files --cached --others --exclude-standard` lists the files that are in scope, untracked
ones included. Ignored files are only read as references where this skill says so (the docs and
sources in `node_modules`), never reviewed or reported on.

## The lenses

1. **Design and code quality**
   - The same logic written more than once across features (a placement question, such as a
     helper in the wrong folder, is `/placement-check`'s), and abstractions that are too thin to
     help or too broad to follow.
   - Very long files or functions that do several jobs (e.g. a hook module that handles every Better Auth event in one file),
     where splitting them would make the code easier to change safely.
   - Error handling: consistent use of `ServiceError` (`src/server/errors.ts`) and `runAction`
     (`src/server/action-result.ts`), no swallowed errors, and messages users can act on.
   - Type safety: `any`, `as` casts, non-null assertions, and inputs that reach a service
     unchecked.
   - Consistency between similar flows (e.g. invitations and invite links, the Security page's
     actions), so the same rule isn't applied differently in two places.
   - Comments and JSDoc that no longer match the code.
2. **Performance and data access**
   - N+1 queries in services and pages, and queries whose `WHERE` or `ORDER BY` has no matching
     index in `src/db/schema`.
   - Over-fetching (whole rows or large joins where a few columns would do).
   - Transactions held open across emails or network calls, and several queries at once on one
     transaction client (`Promise.all` on a transaction).
   - Cache Components and `<Suspense>`: pages made dynamic without need, boundaries that block
     more than they have to, and work repeated per request that could be cached.
   - Server and client components: `'use client'` where a server component would do, and heavy
     imports in client code.
3. **UX, UI and accessibility**
   - The same patterns for lists, forms, dialogs and messages across screens, built from
     `src/components/ui/`.
   - Every state: empty, loading, error, busy and disabled, with the right cursor.
   - Wording as CLAUDE.md sets it, and messages that say what happened and what to do next.
   - Focus management and keyboard use beyond what axe catches (`e2e/a11y.spec.ts`): focus after
     a dialog closes or a form submits, logical tab order, Escape, `aria-*` that matches what's
     on screen.
   - Semantic colour tokens (`src/styles/theme.css`), dark mode, and narrow screens.
   - `useTransientState` and `useTransientActionState` for messages and dialogs, so nothing stale
     is shown when the user comes back to a page.
4. **Tests, docs and tooling**
   - Services, branches or rules without tests, and key user flows without an e2e spec.
   - Brittle tests: fixed waits, dependence on order or on shared seeded state, assertions that
     would pass even if the feature broke.
   - Docs that drifted from the code: spot-check the claims in `docs/` and `README.md` against the
     code, and check that every page is listed in `docs/README.md` and the README's
     Documentation table.
   - Scripts, CI (`.github/workflows/`: caching, pinned actions, least permissions) and developer
     experience (slow or confusing commands, missing checks).
5. **Security smells (light)**
   - Role or permission checks outside `src/lib/authz` and the services, and services that don't
     check permissions themselves.
   - Output that isn't escaped, personal data or secrets in logs, actions that send email or can
     be guessed at without a rate limit, cookie flags, and gaps in the Content Security Policy.
   - No proof tests here. Label every finding "needs a proper security review to confirm", and
     for anything serious, recommend the full method: reviewers per area who trace each attack
     from the request to the database, independent skeptics, and a temporary test that performs
     the attack.

## What to judge against

- **The rules in CLAUDE.md.** Never suggest something CLAUDE.md forbids, and don't report what
  it requires or explicitly allows.
- **The docs and sources the project depends on:** the Next.js 16 docs in
  `node_modules/next/dist/docs/` (don't assume older Next.js conventions), and Better Auth's and
  Drizzle's sources in `node_modules` where behaviour matters.
- **Decisions the project made on purpose.** Choices `docs/` records as deliberate (for example
  trusted provider addresses, fixed 7-day sessions, the lock order in
  `docs/security-measures.md`) aren't findings unless there's new evidence that the trade-off
  changed. Items the docs list as known or deferred are marked "known", not reported as new.
- **Value for the effort.** A suggestion has to be better in this project, not just different.

Each reviewer reports only concrete findings, the most valuable first and at most about 15 per
lens. Each finding has:

- what's there now, with evidence (`file:line`);
- what you'd do instead, and why that's better here;
- an effort estimate (S, M or L) and an impact (high, medium or low).

No style nits or taste (naming, formatting, preferences the linters don't enforce). Each
skeptic re-checks every finding it gets: is it real, did the reviewer miss something that
already handles it, and is the suggestion actually better given the project's rules, recorded
decisions and the cost of the change? It keeps, adjusts or rejects each finding, and may give a
better suggestion.

## Report

- Merge the findings different reviewers made about the same thing.
- Check the most important findings yourself before reporting them.
- Save the full list with evidence in the scratchpad, and give its full path.
- Group the findings by lens, and within each lens order them by impact for the effort, quick
  wins first. Each finding gets a file link, what to do and why.
- Say how many findings survived the skeptics and how many didn't.
- End by asking which findings or groups to fix. Fixing them is a task of its own: it goes
  through plan mode as CLAUDE.md requires, and nothing changes until the plan is approved.
