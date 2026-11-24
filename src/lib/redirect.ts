/**
 * @file Helpers for redirect targets passed in URLs: the pages users go back
 * to after signing in, and the return addresses Better Auth's endpoints take
 * (checked by `src/server/auth/auth-guards/`). A target must be a page of
 * the app: never another site, and never an endpoint under `/api`, which a
 * redirect would call with the browser's cookies (e.g. a second
 * `/api/auth/magic-link/verify` that signs the browser in to another account).
 *
 * The sign-in page's own address with such a target is built in one place
 * ({@link signInPath}).
 *
 * A target may end in the anchor of a section of its page (`#invitations`,
 * the `id` of a `Card`), so whoever comes back lands on the card where they
 * clicked. Only section IDs count ({@link isSectionId}): other fragments are
 * dropped, e.g. text fragments (`#:~:text=…`) or one Next.js can't decode
 * (`#100%`).
 */

/** Where users go after signing in when no other page was requested. */
export const DEFAULT_SIGNED_IN_PATH = '/dashboard';

/** The Security page, where the step-up page and the provider connections come back to when nothing else is asked. */
export const SECURITY_PAGE = '/account/security';

/** A stand-in origin to resolve paths against; never shown or requested. */
const BASE = 'https://adiutor.invalid';

/** A section ID: a lowercase letter, then up to 63 lowercase letters, digits and hyphens. */
const SECTION_ID = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Checks whether a value can be the anchor of a section of a page: a short
 * lowercase ID like `invite-links`, but not `top`, which Next.js always
 * scrolls to the top of the page instead.
 *
 * @param value - The value, e.g. a `Card`'s `id` or a URL's fragment without `#`.
 * @returns Whether it is.
 */
export function isSectionId(value: unknown): value is string {
  return typeof value === 'string' && SECTION_ID.test(value) && value !== 'top';
}

/**
 * Reads the section a URL fragment names, e.g. `location.hash`.
 *
 * @param hash - The fragment, with or without its `#`.
 * @returns The section ID, or `null` when it isn't one ({@link isSectionId}).
 */
export function sectionFromHash(hash: string | null | undefined): string | null {
  const id = hash?.startsWith('#') ? hash.slice(1) : hash;
  return isSectionId(id) ? id : null;
}

/**
 * Points a path at a section of its page: sets its fragment, replacing any it
 * had. A value that isn't a section ID ({@link isSectionId}) leaves the path
 * as it is.
 *
 * @param path - A page of the app, e.g. `/admin/settings/staff?inv-page=2`.
 * @param section - The section, e.g. `invitations`.
 * @returns The path, e.g. `/admin/settings/staff?inv-page=2#invitations`.
 */
export function withSection(path: string, section: string | null | undefined): string {
  if (!isSectionId(section)) {
    return path;
  }
  const hashAt = path.indexOf('#');
  return `${hashAt === -1 ? path : path.slice(0, hashAt)}#${section}`;
}

/**
 * The fragment of a resolved URL when it names a section, otherwise nothing.
 *
 * @param url - The URL.
 * @returns `#<section>`, or an empty string.
 */
function sectionHash(url: URL): string {
  const section = sectionFromHash(url.hash);
  return section ? `#${section}` : '';
}

/**
 * Checks for control characters, whitespace and backslashes. Browsers drop
 * tabs and line breaks from URLs and read a backslash as `/`, so
 * `/<tab>/evil.example` would become `//evil.example`, another site.
 *
 * @param value - The requested path.
 * @returns Whether it contains such a character.
 */
function hasUnsafeCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || code === 0x5c;
  });
}

/**
 * Checks whether a resolved URL is a page of the app: on this site, with a
 * path that doesn't start with `//` (which a browser reads as another site,
 * e.g. what `/.//evil.example` resolves to) and isn't `/api` or below it, in
 * any case.
 *
 * @param url - The URL, resolved against {@link BASE}.
 * @returns Whether it is.
 */
function isAppPage(url: URL): boolean {
  if (url.origin !== BASE || url.pathname.startsWith('//')) {
    return false;
  }
  const path = url.pathname.toLowerCase();
  return path !== '/api' && !path.startsWith('/api/');
}

/**
 * Resolves a requested path when it's a safe page of the app: it starts with
 * a single `/`, has no unsafe character ({@link hasUnsafeCharacter}), and
 * both its resolved path and that path decoded once (as a server may route
 * `/%61pi/…` or `/x%2f..%2fapi`) are pages of the app ({@link isAppPage}).
 * A path that can't be decoded counts as unsafe.
 *
 * @param value - The requested path.
 * @returns The resolved URL, or `null` when it isn't safe.
 */
function resolveAppPage(value: string): URL | null {
  if (!value.startsWith('/') || value.startsWith('//') || hasUnsafeCharacter(value)) {
    return null;
  }
  let url: URL;
  let decoded: URL;
  try {
    url = new URL(value, BASE);
    decoded = new URL(decodeURIComponent(url.pathname), BASE);
  } catch {
    return null;
  }
  return isAppPage(url) && isAppPage(decoded) ? url : null;
}

/**
 * Returns a safe in-app path to redirect to, guarding against open redirects
 * to other sites (e.g. `?callbackURL=https://evil.example` or
 * `?callbackURL=/%09/evil.example`) and against redirects to endpoints under
 * `/api`.
 *
 * @param value - The requested path, e.g. from a `callbackURL` query parameter.
 * @returns The path (with its query, and its fragment when that names a
 *   section) when it's a page of the app, otherwise the default page.
 */
export function getSafeRedirectPath(value: string | null | undefined): string {
  const url = value ? resolveAppPage(value) : null;
  return url ? `${url.pathname}${url.search}${sectionHash(url)}` : DEFAULT_SIGNED_IN_PATH;
}

/**
 * Checks a return address exactly as it was sent, for the auth guards: a
 * string that starts with a single `/`, has no unsafe character, stays on
 * this site and isn't under `/api`, also once decoded (the same rules as
 * {@link getSafeRedirectPath}), with no fragment or one that names a section
 * ({@link isSectionId}). Absolute URLs are refused, even to this site. It
 * doesn't compare with {@link getSafeRedirectPath}'s answer, since resolving a
 * path re-encodes some characters (e.g. `'` in a query).
 *
 * @param value - The return address, as sent.
 * @returns Whether it's a safe page of the app.
 */
export function isSafeAppRedirect(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const url = resolveAppPage(value);
  return url !== null && (url.hash === '' || sectionHash(url) !== '');
}

/** The sign-in page. */
const SIGN_IN_PAGE = '/auth';

/**
 * Builds the sign-in page's address that goes on to a page afterwards, with
 * that page encoded, so it can't break out of its parameter. The sign-in
 * page itself only goes on to a safe page ({@link signedInPath}).
 *
 * @param callbackURL - Where to go after signing in, e.g. `/requests/142?entry=…`.
 * @param options - Options.
 * @param options.notice - A note for the sign-in page to show (`?notice=<code>`, before
 *   `callbackURL`), e.g. `joined-mfa-required`.
 * @returns The address, e.g. `/auth?callbackURL=%2Frequests%2F142`.
 */
export function signInPath(callbackURL: string, { notice }: { notice?: string } = {}): string {
  const noticeParam = notice ? `notice=${encodeURIComponent(notice)}&` : '';
  return `${SIGN_IN_PAGE}?${noticeParam}callbackURL=${encodeURIComponent(callbackURL)}`;
}

/**
 * Returns where to send someone who opens the sign-in page while signed in:
 * the requested page when it's safe ({@link getSafeRedirectPath}), but never
 * the sign-in page itself, so `/auth?callbackURL=/auth…` doesn't redirect
 * once per level of nesting.
 *
 * @param value - The requested path, e.g. from a `callbackURL` query parameter.
 * @returns The path to go on to.
 */
export function signedInPath(value: string | null | undefined): string {
  const path = getSafeRedirectPath(value);
  const { pathname } = new URL(path, BASE);
  return pathname === SIGN_IN_PAGE || pathname === `${SIGN_IN_PAGE}/`
    ? DEFAULT_SIGNED_IN_PATH
    : path;
}
