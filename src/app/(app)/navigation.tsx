/**
 * @file Loads the signed-in user for the navigation.
 */
import { getActor, getGlobalPermissions } from '@/server/authz';

import AppNavigation from './app-navigation';

/**
 * Reads the session and renders the navigation for the user. Render it inside
 * a Suspense boundary.
 *
 * @returns The navigation.
 */
export default async function Navigation() {
  const actor = await getActor({ allowMissingMfa: true });
  const permissions = getGlobalPermissions(actor);
  return (
    <AppNavigation
      name={actor.name}
      email={actor.email}
      isStaff={permissions.has('users:view')}
      canManageStaff={permissions.has('staff:manage')}
      canViewLogs={permissions.has('audit:view')}
    />
  );
}
