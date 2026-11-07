# 0006. Nonce-based Content Security Policy

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

A Content Security Policy (CSP) is a response header that tells the browser which scripts may run.
A strict one means that markup someone manages to inject into a page can't run script. Next.js's own
scripts must still run, and so must the small inline script that applies the theme before the first
paint.

## Decision

The proxy (`src/proxy.ts`) sets the policy for every request, with a fresh nonce: a random value
made for that one response (`src/lib/request/csp.ts`). Only scripts carrying it run
(`'strict-dynamic'`, no `'unsafe-inline'`), and inline event handlers never do
(`script-src-attr 'none'`). Next.js adds the nonce to its own scripts, and the root layout reads it
for the theme script.

## Consequences

- Reading the nonce makes every page render per request, with an empty static shell. The root
  layout's `instant = false` only turns off Cache Components' check for that empty shell.
- Styles keep `'unsafe-inline'`: React and Radix position elements with `style` attributes, which a
  nonce can't cover.
- Never add inline scripts or `on…=` attributes. Raw HTML (`dangerouslySetInnerHTML`) is a lint
  error except for the theme script, and the end-to-end tests fail on CSP violations a page reports.
- Only real static files skip the proxy (`/brand/`, `/icon.svg`), never paths picked by extension.
  They get a fixed policy that runs nothing (`next.config.ts`).
- One known gap: Next.js's built-in page for errors outside rendering is prerendered, so its
  scripts carry no nonce.

Details: [Content Security Policy](../security-measures.md#content-security-policy).

## Alternatives considered

- **A fixed policy in `next.config.ts` that allows inline scripts**, as Next.js's CSP guide shows
  for apps without nonces. Pages could be prerendered, but injected markup could run script.
- **Hashes instead of nonces**, through Next.js's Subresource Integrity support, which keeps pages
  static. It's experimental, and these docs record no evaluation of it.
