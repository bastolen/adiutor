/**
 * @file The content of the page sign-in emails link to: it looks the link up
 * without using it, and shows the account to continue as or why the link
 * can't be used. Better Auth also comes back here with `?error=<code>` when
 * the link failed while someone else was signed in in this browser.
 */
import Link from 'next/link';

import UnusableLink from '@/components/auth/unusable-link';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import { getSafeRedirectPath } from '@/lib/redirect';
import { knownAuthErrorMessage } from '@/lib/sign-in/auth-error-messages';
import { EMAIL_LINK_MINUTES } from '@/lib/sign-in/email-link';
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import appContext from '@/server/app-context';
import { getEmailLinkPreview } from '@/server/auth/email-links';
import { getOptionalActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';

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
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
      <Alert tone="error">{message}</Alert>
      <Button variant="secondary" fullWidth asChild>
        <Link href={signInHref}>Go to sign in</Link>
      </Button>
    </div>
  );
}

/**
 * Says why a link Better Auth refused can't be used, when that's more than
 * the usual "expired or used" (e.g. its account was deleted meanwhile).
 *
 * @param code - The `error` query parameter, if any.
 * @returns The message, or `null` for none, an unknown code, or a used or
 *   expired link (`INVALID_TOKEN`), which the usual text explains best.
 */
function refusalMessage(code: string | undefined): string | null {
  return code && code !== 'INVALID_TOKEN' ? knownAuthErrorMessage(code) : null;
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
  const params = await searchParams;
  const token = searchParam(params.token);
  // A new link asked for from there goes to the same page as this one would have.
  const signInHref = `/auth?callbackURL=${encodeURIComponent(
    getSafeRedirectPath(searchParam(params.callbackURL)),
  )}`;
  if (!token) {
    return (
      <LinkProblem
        message="This sign-in link is incomplete. Request a new one."
        signInHref={signInHref}
      />
    );
  }

  let preview;
  try {
    preview = await getEmailLinkPreview(appContext, token);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      return <LinkProblem message={error.message} signInHref={signInHref} />;
    }
    throw error;
  }
  if (!preview) {
    return (
      <UnusableLink
        description={
          refusalMessage(searchParam(params.error)) ??
          `It may have expired or been used already: sign-in links work once, for ${EMAIL_LINK_MINUTES} minutes. Request a new one from the sign-in page.`
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
