/**
 * @file What a server action returns to its form. Pure and client-safe, so
 * the forms and UI components that show results share the contract with
 * `runAction` in `src/server/action-result.ts`.
 */

/** What a server action returns to its form. */
export type ActionResult<T = undefined> =
  { ok: true; message?: string; data?: T } | { ok: false; message: string };
