/**
 * @file The content of the page sign-in emails link to: it looks the link up
 * without using it, and shows the account to continue as or why the link
 * can't be used. Better Auth also comes back here with `?error=<code>` when
 * the link failed while someone else was signed in in this browser.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import UnusableLink from '@/components/auth/unusable-link';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import { getSafeRedirectPath } from '@/lib/redirect';
import { type AuthTranslator, knownAuthErrorText } from '@/lib/sign-in/auth-error-messages';
import { EMAIL_LINK_MINUTES } from '@/lib/sign-in/email-link';
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import appContext from '@/server/app-context';
import { getEmailLinkPreview } from '@/server/auth/email-links';
import { getOptionalActor } from '@/server/authz';
import { ServiceError, serviceErrorMessage } from '@/server/errors';

import EmailLinkForm from './email-link-form';

/**
 * Says why the link can't be used here, with a way back to sign in.
 *
 * @param props - Component props.
 * @param props.message - What's wrong.
 * @param props.signInHref - The sign-in page, returning to where the link would have.
 * @returns The message.
 */
function LinkProblem({ message, signInHref }: { message: string; signInHref: string }) {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('emailLink.problemHeading')}</h1>
      <Alert tone="error">{message}</Alert>
      <Button variant="secondary" fullWidth asChild>
        <Link href={signInHref}>{t('actions.goToSignIn')}</Link>
      </Button>
    </div>
  );
}

/**
 * Says why a link Better Auth refused can't be used, when that's more than
 * the usual "expired or used" (e.g. its account was deleted meanwhile).
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The `error` query parameter, if any.
 * @returns The message, or `null` for none, an unknown code, or a used or
 *   expired link (`INVALID_TOKEN`), which the usual text explains best.
 */
function refusalMessage(t: AuthTranslator, code: string | undefined): string | null {
  return code && code !== 'INVALID_TOKEN' ? knownAuthErrorText(t, code) : null;
}

/**
 * Looks the link up and shows the step that fits: the account to continue
 * as, or why the link can't be used (all reasons look the same, unless
 * Better Auth just refused it and said why).
 *
 * @param props - Component props.
 * @param props.searchParams - The page's query string.
 * @returns The page content.
 */
export default async function EmailLinkStep({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const token = searchParam(params.token);
  // A new link asked for from there goes to the same page as this one would have.
  const signInHref = `/auth?callbackURL=${encodeURIComponent(
    getSafeRedirectPath(searchParam(params.callbackURL)),
  )}`;
  if (!token) {
    return <LinkProblem message={t('emailLink.incomplete')} signInHref={signInHref} />;
  }

  let preview;
  try {
    preview = await getEmailLinkPreview(appContext, token);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      return (
        <LinkProblem
          message={serviceErrorMessage(error, await getLocale())}
          signInHref={signInHref}
        />
      );
    }
    throw error;
  }
  if (!preview) {
    return (
      <UnusableLink
        description={
          refusalMessage(t, searchParam(params.error)) ??
          t('emailLink.unusable', { minutes: EMAIL_LINK_MINUTES })
        }
        href={signInHref}
      />
    );
  }

  const actor = await getOptionalActor();
  return (
    <EmailLinkForm
      account={{ name: preview.name, email: preview.email }}
      signedIn={
        actor && {
          name: actor.name,
          email: actor.email,
          same: actor.id === preview.userId,
        }
      }
    />
  );
}
