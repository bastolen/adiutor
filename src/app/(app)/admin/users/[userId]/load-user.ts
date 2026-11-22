/**
 * @file Loads the user on a user's page once per request, for the layout's
 * header, the tab's page and its title alike: the user (`getUserDetail`),
 * whether the viewer may sign in as them, and what the viewer gets on their
 * page (`userPageAccess`). Each route file still checks `users:view` itself
 * (`requireGlobalPermission`, or `globalPermissionMetadata` for its title)
 * before calling these.
 */
import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { impersonationVerdictFor } from '@/server/auth/impersonation';
import { getGlobalPermissions } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { getUserDetail, type UserDetail } from '@/server/people/user-admin';

import { type UserPageAccess, userPageAccess, type UserTab } from './user-access';

/** The user on the page, and what the viewer gets there. */
export interface LoadedUser {
  /** The user. */
  detail: UserDetail;
  /** Whether it's the viewer's own page. */
  isSelf: boolean;
  /** The tabs and cards the viewer gets. */
  access: UserPageAccess;
}

/**
 * Finds the user on the page, once per request and viewer (React's `cache`),
 * so the layout, the page and its title share it.
 *
 * @param actor - The viewer, who has `users:view`.
 * @param userId - The user in the URL (unvalidated).
 * @returns The user and what the viewer gets, or `null` when there's no such user.
 */
const findUser = cache(async (actor: Actor, userId: string): Promise<LoadedUser | null> => {
  try {
    // Independent reads, so they run together.
    const [detail, signInAs] = await Promise.all([
      getUserDetail(appContext, actor, userId),
      impersonationVerdictFor(appContext, actor, userId),
    ]);
    const isSelf = detail.id === actor.id;
    return {
      detail,
      isSelf,
      access: userPageAccess(getGlobalPermissions(actor), { isSelf, signInAs }),
    };
  } catch (error) {
    if (error instanceof ServiceError) {
      return null;
    }
    throw error;
  }
});

/**
 * Loads the user on the page, for its header and its tabs. An unknown user,
 * or a tab the viewer doesn't get there, ends on the 404 page.
 *
 * @param actor - The viewer, who has `users:view`.
 * @param userId - The user in the URL (unvalidated).
 * @param tab - The tab being shown, which the viewer must get; left out by the layout.
 * @returns The user and what the viewer gets on their page.
 */
export default async function loadUser(
  actor: Actor,
  userId: string,
  tab?: UserTab,
): Promise<LoadedUser> {
  const loaded = await findUser(actor, userId);
  if (!loaded || (tab && !loaded.access.tabs.includes(tab))) {
    notFound();
  }
  return loaded;
}

/**
 * Whether the viewer gets a tab of this user's page, for the tab's title:
 * `false` for an unknown user too. Never ends on the 404 page itself, which
 * would leave the page without a title (see `src/server/page-metadata.ts`).
 *
 * @param actor - The viewer, who has `users:view`.
 * @param userId - The user in the URL (unvalidated).
 * @param tab - The tab.
 * @returns Whether the viewer gets it.
 */
export async function offersUserTab(actor: Actor, userId: string, tab: UserTab): Promise<boolean> {
  const loaded = await findUser(actor, userId);
  return Boolean(loaded?.access.tabs.includes(tab));
}
