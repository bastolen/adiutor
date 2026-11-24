/**
 * @file The Preferences tab of the account, served at `/account/preferences`:
 * the user's language (one of the languages that are on, or Default; only
 * when there's more than one to choose from), their time zone, and whether
 * they get emails about requests. Changing the language or the time zone
 * reloads the page at its card (`#language`, `#time-zone`), saying it's
 * saved; the footer of those emails links to their card (`#request-emails`).
 * A staff member signed in as the user sees it read-only, with a note.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import { personalDataShown } from '@/lib/authz/impersonation';
import ClientMessages from '@/lib/i18n/client-messages';
import { timeZoneOptions } from '@/lib/i18n/time-zones';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ownLanguage } from '@/server/people/own-locale';
import { ownTimeZone } from '@/server/people/own-time-zone';
import { ownRequestEmails } from '@/server/people/request-emails';

import { type AccountParams, LANGUAGE_SECTION, TIME_ZONE_SECTION } from '../account-messages';
import SignedInAsNote from '../signed-in-as-note';
import LanguageForm from './language-form';
import RequestEmailsCard from './request-emails-card';
import TimeZoneForm from './time-zone-form';

/**
 * Page metadata: "Preferences · Account", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('preferences.title') };
}

/**
 * Loads the user's preferences and shows them.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters; set after saving the language or time zone.
 * @returns The page content.
 */
async function Preferences({ searchParams }: { searchParams: Promise<AccountParams> }) {
  const actor = await getActor({ allowMissingMfa: true });
  const [params, language, zone, requestEmails, t] = await Promise.all([
    searchParams,
    ownLanguage(appContext, actor),
    ownTimeZone(appContext, actor),
    ownRequestEmails(appContext, actor),
    getTranslations('account'),
  ]);
  const timeZone = zone.timeZone ?? zone.defaultTimeZone;

  return (
    <>
      {actor.signedInAs && <SignedInAsNote actor={actor} shown={personalDataShown(actor)} />}
      {/* With only one language offered there's nothing to choose. */}
      {language.offered.length > 1 && (
        <Card
          // The page reloads here after the language changed.
          id={LANGUAGE_SECTION}
          title={t('profile.languageTitle')}
          description={t('profile.languageDescription')}
        >
          {params.language === 'saved' && (
            <ToastOnArrival message={t('profile.languageSaved')} param="language" />
          )}
          <ClientMessages namespaces={['account']}>
            <LanguageForm
              choice={language.choice}
              defaultLocale={language.defaultLocale}
              notOffered={language.notOffered}
            />
          </ClientMessages>
        </Card>
      )}
      <Card
        // The page reloads here after the time zone changed.
        id={TIME_ZONE_SECTION}
        title={t('profile.timeZoneTitle')}
        description={t('profile.timeZoneDescription')}
      >
        {params.timeZone === 'saved' && (
          <ToastOnArrival message={t('profile.timeZoneSaved')} param="timeZone" />
        )}
        <ClientMessages namespaces={['account']}>
          <TimeZoneForm timeZone={timeZone} options={timeZoneOptions(new Date(), timeZone)} />
        </ClientMessages>
      </Card>
      <RequestEmailsCard on={requestEmails} />
    </>
  );
}

/**
 * The Preferences tab of the account.
 *
 * @returns The page.
 */
export default function PreferencesPage({ searchParams }: PageProps<'/account/preferences'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Preferences searchParams={searchParams} />
    </Suspense>
  );
}
