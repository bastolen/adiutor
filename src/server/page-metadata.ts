/**
 * @file Page metadata that depends on who is looking. Someone who may not see
 * a page gets the 404 page, so its metadata gives them the 404 page's title
 * too ("Not found · Adiutor"), after the same check as the page: the browser
 * tab, the history and the route announcer (which reads the title after each
 * client-side navigation) then agree with the "Page not found" they see.
 *
 * The checks read the actor with `getActor()`, so they send people to sign in
 * or confirm it's them just like the page, but never end in the 404 page
 * themselves: Next would then render the page without a title (see
 * `findCompanyAccess`). They run at request time and stream in, which is
 * fine because the pages read the actor inside `<Suspense>` anyway.
 *
 * Every page or layout that calls `requireGlobalPermission` or
 * `requireCompanyAccess` with a permission exports its `generateMetadata`
 * from here, with the same permission (`src/app/permission-titles.test.ts`
 * checks it). Titles are message keys, translated in the request's language
 * with `translator` (`next-intl/server` stays out of `src/server/`).
 */
import 'server-only';
import type { Metadata } from 'next';
import type { MessageKeys, NestedKeyOf } from 'use-intl/core';

import type { Permission } from '@/lib/authz/permissions';
import type { Messages } from '@/lib/i18n/messages';
import requestLocale from '@/lib/i18n/request-locale';
import translator, { type Namespace } from '@/lib/i18n/translator';
import notFoundMetadata from '@/lib/not-found-metadata';

import type { Actor } from './actor';
import { findCompanyAccess, getActor, getGlobalPermissions } from './authz';

/**
 * A page's title: the full key of the message that names the page, e.g.
 * `admin.users.title` for "Users" (the root layout's template adds the
 * product's name). TypeScript checks it against the English (US) catalogues.
 */
export type PageTitleKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

/**
 * A page's metadata with its title in the request's language.
 *
 * @param title - The title's message key, or nothing for a layout (its pages keep their own).
 * @returns The metadata.
 */
async function titledMetadata(title: PageTitleKey | undefined): Promise<Metadata> {
  if (!title) {
    return {};
  }
  const cut = title.lastIndexOf('.');
  // The namespace is everything before the last dot; the key type above already checked the path.
  const t = translator(await requestLocale(), title.slice(0, cut) as Namespace);
  return { title: t(title.slice(cut + 1) as never) };
}

/**
 * Metadata for a page or layout that requires a permission that isn't about
 * one company, the one it checks with `requireGlobalPermission`, used as its
 * `generateMetadata`:
 *
 * ```ts
 * export const generateMetadata = globalPermissionMetadata('errors:view', 'admin.errors.title');
 * ```
 *
 * Without the permission (or when `exists` says the page's target doesn't
 * exist), the title is "Not found · Adiutor", also for every page below a
 * layout.
 *
 * @param permission - The permission the page requires.
 * @param title - The page's title for those who may see it, as a message
 *   key. A layout leaves it out, so its pages keep their own titles.
 * @param exists - Whether the page's target exists (e.g. the user in the
 *   URL), asked only once the permission is there; left out for pages
 *   without one.
 * @returns The `generateMetadata` function.
 */
export function globalPermissionMetadata<Props = unknown>(
  permission: Permission,
  title?: PageTitleKey,
  exists?: (actor: Actor, props: Props) => Promise<boolean>,
): (props: Props) => Promise<Metadata> {
  return async (props) => {
    const actor = await getActor();
    if (!getGlobalPermissions(actor).has(permission)) {
      return notFoundMetadata();
    }
    if (exists && !(await exists(actor, props))) {
      return notFoundMetadata();
    }
    return titledMetadata(title);
  };
}

/**
 * Metadata for a company page that requires a permission in the company, the
 * one it checks with `requireCompanyAccess`, used as its `generateMetadata`.
 * The company layout already gives the 404 title to everyone who can't see
 * the company; this adds those who can see it but not this page (a Watcher
 * on Members). For everyone else, the page's title (e.g. "Members") still
 * gets the company's name from the layout's template.
 *
 * @param permission - The permission the page requires.
 * @param title - The page's title for those who may see it, as a message
 *   key, e.g. `companies.members.title`.
 * @returns The `generateMetadata` function.
 */
export function companyPermissionMetadata(
  permission: Permission,
  title?: PageTitleKey,
): (props: { params: Promise<{ companyId: string }> }) => Promise<Metadata> {
  return async ({ params }) => {
    const { companyId } = await params;
    const access = await findCompanyAccess(companyId);
    return access?.permissions.has(permission) ? titledMetadata(title) : notFoundMetadata();
  };
}
