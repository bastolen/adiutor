/**
 * @file Checks that every return address an open Better Auth endpoint takes
 * is one the guards check (`RETURN_ADDRESS_FIELDS`), so a new plugin or an
 * upgrade can't add a redirect the browser follows unchecked. The list is
 * kept by hand, and missed the link of a reset email once.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { BROWSER_AUTH_PATHS } from '@/lib/sign-in/auth-endpoints';

import { RETURN_ADDRESS_FIELDS, type ReturnAddressFields } from './request-checks';

vi.hoisted(() => {
  // Loading the auth config validates the environment; nothing here connects to it.
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://adiutor:adiutor@localhost:5432/adiutor_test',
    BETTER_AUTH_SECRET: 'request-checks-test-secret-0123456789abcdef',
    BETTER_AUTH_URL: 'http://localhost:3000',
  });
});

/**
 * What a field that holds a return address is called: Better Auth's own
 * names (`callbackURL`, `errorCallbackURL`, `newUserCallbackURL`,
 * `redirectTo`) and anything else that ends in URL or URI or starts with
 * "redirect" or "return", so a new one is noticed too. `disableRedirect`, a
 * switch, isn't one.
 */
const RETURN_ADDRESS_NAME = /(url|uri)$|^(redirect|return)/i;

/**
 * Endpoints the browser can reach that take a return address the guards
 * don't check, because Better Auth never sends the browser to it here. Each
 * says why; an endpoint only belongs here once that's read in Better Auth's
 * source (or the guards never let a request reach it).
 */
const NEVER_FOLLOWED: ReadonlyMap<string, ReturnAddressFields> = new Map([
  // Better Auth's own sign-in link (the `GET`). The guards send every `GET` of it to the
  // confirmation page before Better Auth sees it (`confirmSignInLinkFirst`), and that page only
  // passes pages of the app on, to its Continue (the `POST` of the same path, which is checked).
  [
    '/magic-link/verify',
    { in: 'query', fields: ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] },
  ],
  // A password sign-in answers with JSON. Its `callbackURL` only comes back in that answer (and
  // in a `Location` header on a 200, which browsers ignore), for the caller's own script to
  // follow: the sign-in form sends none and goes to a page it checked itself
  // (`getSafeRedirectPath`). It would also go into the verification email of an unverified
  // address, which is off (`sendOnSignIn: false`), and whose link (`/verify-email`) is checked.
  ['/sign-in/email', { in: 'body', fields: ['callbackURL'] }],
  // Only handed to a provider that has a sign-out page of its own to come back from
  // (`createEndSessionURL`), which neither GitHub nor Google has. The app sends none.
  ['/sign-out', { in: 'body', fields: ['callbackURL'] }],
]);

/** The parts of a zod schema's definition that hold the fields it takes. */
interface SchemaDefinition {
  /** An object's fields. */
  shape?: Record<string, unknown>;
  /** The schema an optional, nullable or default one wraps. */
  innerType?: unknown;
  /** A union's alternatives. */
  options?: unknown[];
  /** An intersection's first half. */
  left?: unknown;
  /** An intersection's second half. */
  right?: unknown;
}

/**
 * Lists the fields a zod schema takes, through optional wrappers, unions and
 * intersections (Better Auth's `/sign-out` body is an optional object).
 *
 * @param schema - The schema of an endpoint's body or query, if it has one.
 * @returns The fields' names.
 */
function fieldNames(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null || !('def' in schema)) {
    return [];
  }
  const { shape, innerType, options = [], left, right } = schema.def as SchemaDefinition;
  return [
    ...Object.keys(shape ?? {}),
    ...[innerType, ...options, left, right].flatMap((inner) => fieldNames(inner)),
  ];
}

/** An endpoint as Better Auth registers it: its path pattern and its schemas. */
interface RegisteredEndpoint {
  /** The path, e.g. `/reset-password/:token`; server-only endpoints have none. */
  path?: string;
  /** The endpoint's options, with the schemas of its body and query. */
  options?: { body?: unknown; query?: unknown };
}

/**
 * Lists a map of return address fields as `<path> <body or query>:
 * <fields>` lines, sorted, so a difference reads as the endpoint and field
 * that's missing.
 *
 * @param entries - Each endpoint's path with where it takes which fields.
 * @returns The lines.
 */
function listed(entries: Iterable<readonly [string, ReturnAddressFields]>): string[] {
  return [...entries]
    .map(([path, rule]) => `${path} ${rule.in}: ${[...rule.fields].sort().join(', ')}`)
    .sort();
}

describe('return addresses of the endpoints the browser can reach', () => {
  it('are each checked by the guards, or never followed', async () => {
    const { auth } = await import('@/lib/auth');
    const open = new Set<string>(BROWSER_AUTH_PATHS);

    const taken = Object.values(auth.api).flatMap((endpoint) => {
      const { path, options } = endpoint as RegisteredEndpoint;
      if (!path || !open.has(path)) {
        return [];
      }
      return (['body', 'query'] as const).flatMap((where) => {
        const fields = fieldNames(options?.[where]).filter((name) =>
          RETURN_ADDRESS_NAME.test(name),
        );
        return fields.length > 0 ? [[path, { in: where, fields }] as const] : [];
      });
    });

    // Both ways: nothing an endpoint takes is unlisted, and nothing listed is no longer taken.
    expect(listed(taken)).toEqual(
      listed([...[...RETURN_ADDRESS_FIELDS].filter(([path]) => open.has(path)), ...NEVER_FOLLOWED]),
    );
  });

  it('finds the fields of the schemas Better Auth uses', async () => {
    // Guards the check above against a zod whose schemas it can no longer read.
    const { auth } = await import('@/lib/auth');
    const { options } = auth.api.signOut as RegisteredEndpoint;

    expect(fieldNames(options?.body).sort()).toEqual(['callbackURL', 'disableRedirect', 'state']);
  });
});
