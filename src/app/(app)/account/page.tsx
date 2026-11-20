/**
 * @file The Profile page of the account, served at `/account`: name, email
 * (with verification), picture (a connected account's, or initials),
 * language (one of the languages, or Default), a
 * summary of sign-in security and recent activity on
 * the account (sign-ins and changes, from the audit log). Password, passkeys,
 * two-step verification and connected accounts are on the Security page. The
 * verification link comes back to the Email card (`#email`), which says
 * whether it worked. A staff member signed in as the user sees it read-only,
 * with a note, and the activity's IP addresses and browsers only when they see
 * the audit log (`personalDataShown`).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import ActivityList from '@/components/ui/activity-list';
import Alert from '@/components/ui/alert';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import { personalDataShown } from '@/lib/authz/impersonation';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { listOwnActivity } from '@/server/audit';
import { getActor } from '@/server/authz';
import { ownLanguage } from '@/server/people/own-locale';
import { ownPictureChoices } from '@/server/people/pictures';

import accountMessage, {
  type AccountParams,
  EMAIL_SECTION,
  LANGUAGE_SECTION,
} from './account-messages';
import { sendVerificationAction } from './actions';
import LanguageForm from './language-form';
import NameForm from './name-form';
import describeOwnActivity from './own-activity';
import PictureForm from './picture-form';
import SignedInAsNote from './signed-in-as-note';

/**
 * Page metadata: "Account", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('title') };
}

/**
 * Loads the user and shows their settings.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters; set after verifying the email.
 * @returns The page content.
 */
async function AccountSettings({ searchParams }: { searchParams: Promise<AccountParams> }) {
  const actor = await getActor({ allowMissingMfa: true });
  // A staff member signed in as the user sees the page read-only, with only the personal details
  // they see on the user's page.
  const shown = personalDataShown(actor);
  const [params, ownActivity, language, picture, t, tAuth, tAudit, tRoles] = await Promise.all([
    searchParams,
    listOwnActivity(appContext, actor),
    ownLanguage(appContext, actor),
    ownPictureChoices(appContext, actor),
    getTranslations('account'),
    getTranslations('auth'),
    getTranslations('audit'),
    getTranslations('roles'),
  ]);
  const message = accountMessage(t, tAuth, params);
  const activity = shown.origins
    ? ownActivity
    : ownActivity.map((event) => ({ ...event, ip: null, userAgent: null }));

  return (
    <>
      {actor.signedInAs && <SignedInAsNote actor={actor} shown={shown} />}
      <Card
        title={t('profile.securityTitle')}
        description={
          actor.mfaEnabled ? t('profile.securityProtected') : t('profile.securityUnprotected')
        }
        actions={
          <Button asChild variant={actor.mfaEnabled ? 'secondary' : 'primary'} size="sm">
            <Link href="/account/security">
              {actor.mfaEnabled ? t('profile.manage') : t('profile.setUp')}
            </Link>
          </Button>
        }
      >
        {actor.mfaEnabled ? (
          <Badge tone="success">{t('profile.protected')}</Badge>
        ) : (
          <Badge tone="warning">{t('profile.passwordOnly')}</Badge>
        )}
      </Card>
      <Card
        // The verification link comes back here, saying whether it worked.
        id={EMAIL_SECTION}
        title={t('profile.emailTitle')}
        description={
          actor.emailVerified
            ? t('profile.emailVerifiedDescription')
            : t('profile.emailUnverifiedDescription')
        }
        footer={
          actor.emailVerified ? undefined : (
            <RowAction action={sendVerificationAction} label={t('profile.sendVerification')} />
          )
        }
      >
        <div className="flex flex-col gap-4">
          {message && (
            <Alert tone={message.tone} focusOnShow>
              {message.text}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium break-all">{actor.email}</span>
            {actor.emailVerified ? (
              <Badge tone="success">{t('profile.verified')}</Badge>
            ) : (
              <Badge tone="warning">{t('profile.notVerified')}</Badge>
            )}
          </div>
        </div>
      </Card>
      <Card title={t('profile.nameTitle')} description={t('profile.nameDescription')}>
        <ClientMessages namespaces={['account']}>
          <NameForm name={actor.name} />
        </ClientMessages>
      </Card>
      <Card title={t('profile.pictureTitle')} description={t('profile.pictureDescription')}>
        <ClientMessages namespaces={['account']}>
          <PictureForm
            name={displayName(actor)}
            options={picture.choices}
            shown={picture.shown}
            chosen={picture.source !== null}
          />
        </ClientMessages>
      </Card>
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
          <LanguageForm choice={language.choice} defaultLocale={language.defaultLocale} />
        </ClientMessages>
      </Card>
      <Card
        title={t('profile.activityTitle')}
        description={
          activity.length === 0 ? t('profile.activityEmpty') : t('profile.activityDescription')
        }
        actions={
          activity.length > 0 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/account/security">{t('profile.reviewSecurity')}</Link>
            </Button>
          ) : undefined
        }
      >
        {activity.length > 0 && (
          <ActivityList
            label={t('profile.activityLabel')}
            items={activity.map((event) => ({
              id: event.id,
              at: event.at,
              userAgent: event.userAgent,
              ip: event.ip,
              description: describeOwnActivity(event, actor.id, {
                account: t,
                audit: tAudit,
                roles: tRoles,
              }),
            }))}
          />
        )}
      </Card>
    </>
  );
}

/**
 * The Profile page of the account.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function AccountPage({ searchParams }: PageProps<'/account'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <AccountSettings searchParams={searchParams} />
    </Suspense>
  );
}
