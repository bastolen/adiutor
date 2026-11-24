/**
 * @file The content of the request link's confirmation page: it looks the
 * link up without using it, and shows the account to continue as, or why
 * the link can't be used here. With nobody signed in in this browser, it
 * continues by itself (decision 0038).
 */
import { UserRoundCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import UnusableLink from '@/components/auth/unusable-link';
import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import IconTile from '@/components/ui/icon-tile';
import { signInPath } from '@/lib/redirect';
import { requestPathWithEntry } from '@/lib/requests';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { REQUEST_LINK_DAYS, REQUEST_LINK_RETRY_PARAM } from '@/lib/sign-in/request-link';
import appContext from '@/server/app-context';
import { getRequestLinkView, type RequestLinkView } from '@/server/auth/request-links';
import { getOptionalActor } from '@/server/authz';
import { ServiceError, serviceErrorMessage } from '@/server/errors';

import RequestLinkForm from './request-link-form';

/**
 * Says that a staff member signed in as someone must go back to their own
 * account before a link signs anyone in: switching here would end that
 * sign-in without recording its end.
 *
 * @returns The message.
 */
function SignedInAsSomeone() {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col gap-6">
      <IconTile icon={UserRoundCheck} size="lg" />
      <AuthHeading
        title={t('requestLink.signedInAsHeading')}
        description={t('requestLink.signedInAsDescription')}
      />
      <Button variant="secondary" fullWidth asChild>
        <Link href="/dashboard">{t('requestLink.openAdiutor')}</Link>
      </Button>
    </div>
  );
}

/**
 * The sign-in page, returning to the request (and the entry the link points
 * at) when the link names one.
 *
 * @param view - What the link is.
 * @param entry - The entry the link points at, if any.
 * @returns The address.
 */
function signInHref(view: RequestLinkView | null, entry: string | null = null): string {
  if (view === null || view.state === 'unknown') {
    return '/auth';
  }
  return signInPath(requestPathWithEntry(view.number, entry));
}

/**
 * Looks the link up and shows the step that fits: the account to continue
 * as, why a staff member signed in as someone can't use it, or why it can't
 * be used (every reason looks the same: expired, ended early, an account
 * that can't use it, or no such link). Only a link that can be used, with
 * nobody signed in in this browser, continues by itself, and not when its
 * own Continue already came back here (`retry`, see
 * `REQUEST_LINK_RETRY_PARAM`): switching accounts is always a person's
 * choice.
 *
 * @param props - Component props.
 * @param props.searchParams - The page's query string.
 * @returns The page content.
 */
export default async function RequestLinkStep({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const token = searchParam(params.token);
  // The entry the link points at, passed on to the request (checked where it's used).
  const entry = searchParam(params.entry) ?? null;
  // The page's own Continue came back here: it waits for a click.
  const retry = searchParam(params[REQUEST_LINK_RETRY_PARAM]) === '1';
  const unusable = t('requestLink.unusable', { days: REQUEST_LINK_DAYS });
  if (!token) {
    return <UnusableLink description={unusable} href={signInHref(null)} />;
  }

  let view: RequestLinkView;
  try {
    view = await getRequestLinkView(appContext, token);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      return (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-semibold text-foreground">{t('requestLink.title')}</h1>
          <Alert tone="error">{serviceErrorMessage(error, await getLocale())}</Alert>
          <Button variant="secondary" fullWidth asChild>
            <Link href={signInHref(null)}>{t('actions.goToSignIn')}</Link>
          </Button>
        </div>
      );
    }
    throw error;
  }
  if (view.state !== 'usable') {
    return <UnusableLink description={unusable} href={signInHref(view, entry)} />;
  }

  const actor = await getOptionalActor();
  if (actor?.signedInAs) {
    return <SignedInAsSomeone />;
  }
  return (
    <RequestLinkForm
      account={{ name: view.account.name, email: view.account.email }}
      continueByItself={!actor && !retry}
      reference={view.reference}
      requestHref={requestPathWithEntry(view.number, entry)}
      signedIn={
        actor && {
          name: actor.name,
          email: actor.email,
          same: actor.id === view.account.userId,
        }
      }
    />
  );
}
