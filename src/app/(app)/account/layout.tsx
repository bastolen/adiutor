/**
 * @file Layout of the account pages (Profile, Preferences, Security, Activity): the "Account"
 * header and tabs, then the page, in one column. Layouts stay mounted while
 * the pages under them change, so choosing a tab keeps focus on it and the
 * header doesn't reload.
 */
import { Suspense } from 'react';

import { PageHeaderSkeleton } from '@/components/ui/skeleton';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { loadPictures } from '@/server/people/pictures';

import AccountHeader from './account-header';

/**
 * Loads the signed-in user and shows the header. Like the account pages, it
 * lets users whose role requires MFA through before they have it: the
 * Security page is where they set it up.
 */
async function AccountHeaderLoader() {
  const actor = await getActor({ allowMissingMfa: true });
  const pictures = await loadPictures(appContext.db, [actor.id]);
  return (
    <AccountHeader name={actor.name} email={actor.email} picture={pictures.get(actor.id) ?? null} />
  );
}

/**
 * The account header above the account pages.
 */
export default function AccountLayout({ children }: LayoutProps<'/account'>) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Suspense fallback={<PageHeaderSkeleton />}>
        <AccountHeaderLoader />
      </Suspense>
      {children}
    </div>
  );
}
