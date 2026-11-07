/**
 * @file Type-level checks that the parts of Better Auth's endpoint context
 * the app's hooks read (`AuthHookContext`, `AuthGuardContext`) still fit
 * Better Auth's own types. `src/lib/auth.ts` passes Better Auth's context to
 * them without a cast, which checks the top-level fields (`params`,
 * `setCookie`, ...), but Better Auth types `ctx.context` as `any` there, and
 * the app's fields are optional, so neither a changed type in `ctx.context`
 * nor a renamed or removed field would fail to compile: these checks do,
 * against Better Auth's `AuthContext`. `pnpm typecheck` enforces them; at
 * run time they do nothing.
 */
import type { AuthContext, HookEndpointContext } from 'better-auth';
import { describe, expectTypeOf, it } from 'vitest';

import type { AuthHookContext } from './auth-events';
import type { AuthGuardContext } from './auth-guards';

/**
 * Better Auth's request state (`ctx.context`) as after hooks get it, with the
 * endpoint's response or error (`returned`, declared by `HookEndpointContext`).
 */
type AfterHookState = AuthContext & { returned?: unknown };

describe('the hook contexts', () => {
  it("read only fields Better Auth's context has", () => {
    expectTypeOf<keyof AuthHookContext>().toExtend<keyof HookEndpointContext>();
    expectTypeOf<keyof AuthHookContext['context']>().toExtend<keyof AfterHookState>();
    expectTypeOf<keyof AuthGuardContext>().toExtend<keyof HookEndpointContext>();
    expectTypeOf<keyof AuthGuardContext['context']>().toExtend<keyof AuthContext>();
  });

  it("expect the types Better Auth's request state has", () => {
    expectTypeOf<AfterHookState>().toExtend<AuthHookContext['context']>();
    expectTypeOf<AuthContext>().toExtend<AuthGuardContext['context']>();
  });
});
