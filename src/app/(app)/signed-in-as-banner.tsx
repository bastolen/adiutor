/**
 * @file The banner on every page of the signed-in app while a staff member is
 * signed in as a user ("Sign in as", see
 * docs/decisions/0017-staff-sign-in-as-users.md): whom they're signed in as,
 * that changes are turned off, when it ends, and "Back to my account". It
 * stays at the top of the content while the page scrolls (below the small
 * screens' top bar), and marks the tab as signed in as someone
 * (`SignedInAsMarker`), so controls that change something render disabled.
 * Once it ends by itself, the tab loads afresh (`ReloadWhenSignedInAsEnds`).
 * Text from `navigation.signedInAs`.
 */
import { Eye } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';
import displayName from '@/lib/display-name';
import { formatTime } from '@/lib/format';
import { getOptionalActor } from '@/server/authz';

import BackToOwnAccountButton from './back-to-own-account-button';
import ReloadWhenSignedInAsEnds from './reload-when-signed-in-as-ends';

/**
 * Shows the banner while the session is signed in as someone, and nothing
 * otherwise. Read inside the layout's `<Suspense>`, like the navigation.
 *
 * @returns The banner, or nothing.
 */
export default async function SignedInAsBanner() {
  const actor = await getOptionalActor();
  if (!actor?.signedInAs) {
    return null;
  }
  // Measured by the server's clock, so the browser's doesn't matter. After the request's data, so
  // it's request-time work, which Cache Components allows.
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request: this is how long is left at that moment
  const endsInMs = actor.signedInAs.endsAt.getTime() - Date.now();
  const [t, locale] = await Promise.all([getTranslations('navigation.signedInAs'), getLocale()]);
  return (
    <section
      aria-label={t('label')}
      className="sticky top-16 z-30 flex flex-col gap-3 rounded-xl border border-warning bg-warning-soft px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:top-4"
    >
      <p className="flex items-start gap-3 text-sm text-foreground">
        <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <span className="wrap-anywhere">
          {t('text', {
            name: displayName(actor),
            email: actor.email,
            time: formatTime(actor.signedInAs.endsAt, locale),
          })}
        </span>
      </p>
      <div className="shrink-0 self-start sm:self-auto">
        <BackToOwnAccountButton label={t('back')} />
      </div>
      <SignedInAsMarker />
      <ReloadWhenSignedInAsEnds endsInMs={endsInMs} endedMessage={t('ended')} />
    </section>
  );
}
