/**
 * @file Loads the signed-in user for the navigation, with its text
 * (`navigation`).
 */
import ClientMessages from '@/lib/i18n/client-messages';
import { getActor, getGlobalPermissions } from '@/server/authz';

import AppNavigation from './app-navigation';
import { staffSectionKeys } from './staff-sections';

/**
 * Reads the session and renders the navigation for the user. Render it inside
 * a Suspense boundary.
 *
 * @returns The navigation.
 */
export default async function Navigation() {
  const actor = await getActor({ allowMissingMfa: true });
  return (
    <ClientMessages namespaces={['navigation']}>
      <AppNavigation
        name={actor.name}
        email={actor.email}
        sections={staffSectionKeys(getGlobalPermissions(actor))}
      />
    </ClientMessages>
  );
}
