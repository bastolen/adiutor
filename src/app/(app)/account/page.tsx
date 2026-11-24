/**
 * @file The Profile tab of the account, served at `/account`: a summary of
 * sign-in security, the email address (with verification), name and picture
 * (a connected account's, or initials). Language, time zone and emails about
 * requests are on the Preferences tab; password, passkeys, two-step
 * verification and connected accounts on the Security tab; devices and
 * recent activity on the Activity tab. The verification link comes back to
 * the Email card (`#email`), which says whether it worked. A staff member
 * signed in as the user sees it read-only, with a note.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Alert from '@/components/ui/alert';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import { personalDataShown } from '@/lib/authz/impersonation';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ownPictureChoices } from '@/server/people/pictures';

import accountMessage, { type AccountParams, EMAIL_SECTION } from './account-messages';
import { sendVerificationAction } from './actions';
import NameForm from './name-form';
import PictureForm from './picture-form';
import SignedInAsNote from './signed-in-as-note';

/**
 * Page metadata: "Account", in the request's language.
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
 */
async function AccountSettings({ searchParams }: { searchParams: Promise<AccountParams> }) {
  const actor = await getActor({ allowMissingMfa: true });
  const [params, picture, t, tAuth] = await Promise.all([
    searchParams,
    ownPictureChoices(appContext, actor),
    getTranslations('account'),
    getTranslations('auth'),
  ]);
  const message = accountMessage(t, tAuth, params);

  return (
    <>
      {/* A staff member signed in as the user sees the page read-only. */}
      {actor.signedInAs && <SignedInAsNote actor={actor} shown={personalDataShown(actor)} />}
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
    </>
  );
}

/**
 * The Profile tab of the account.
 */
export default function AccountPage({ searchParams }: PageProps<'/account'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <AccountSettings searchParams={searchParams} />
    </Suspense>
  );
}
