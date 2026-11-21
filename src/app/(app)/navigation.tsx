/**
 * @file Loads the signed-in user for the navigation, with its text
 * (`navigation`), and saves their browser's time zone the first time they're
 * signed in (`SaveBrowserTimeZone`).
 */
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { getActor, getGlobalPermissions } from '@/server/authz';
import { loadPictures } from '@/server/people/pictures';

import AppNavigation from './app-navigation';
import SaveBrowserTimeZone from './save-browser-time-zone';
import { staffSectionKeys } from './staff-sections';

/**
 * Reads the session and renders the navigation for the user, with their
 * picture in the account menu, and for an account without a time zone (not
 * while signed in as the user) the first visit's save of the browser's zone.
 * Render it inside a Suspense boundary.
 *
 * @returns The navigation.
 */
export default async function Navigation() {
  const actor = await getActor({ allowMissingMfa: true });
  const pictures = await loadPictures(appContext.db, [actor.id]);
  return (
    <ClientMessages namespaces={['navigation']}>
      <AppNavigation
        name={actor.name}
        email={actor.email}
        sections={staffSectionKeys(getGlobalPermissions(actor))}
        signedInAs={actor.signedInAs !== null}
        picture={pictures.get(actor.id) ?? null}
      />
      {actor.timeZone === null && actor.signedInAs === null && <SaveBrowserTimeZone />}
    </ClientMessages>
  );
}
