/**
 * @file The part of the sign-in error page that depends on the error: what
 * went wrong, and the reference to send to an admin (recorded with
 * `recordSignInError`, shown in the shared `ErrorReference` box), in the
 * request's language.
 */
import { getTranslations } from 'next-intl/server';

import ErrorReference from '@/components/ui/error-reference';
import { type SearchParams, searchParam } from '@/lib/search-params';
import appContext from '@/server/app-context';
import { cleanErrorCode, recordSignInError } from '@/server/auth/sign-in-errors';
import { getOptionalActor } from '@/server/authz';
import { actingUserId } from '@/server/signed-in-as';

import signInErrorMessage from './messages';

/**
 * Records the error and shows what went wrong and its reference. Rendered at
 * request time (it reads the query string and who is signed in), so each
 * visit gets a reference of its own.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: Better Auth's `error` and `error_description`.
 * @returns The message and the reference.
 */
export default async function SignInErrorDetails({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, actor, t] = await Promise.all([
    searchParams,
    getOptionalActor(),
    getTranslations('auth'),
  ]);
  const code = cleanErrorCode(searchParam(params.error));
  const { reference, at } = await recordSignInError(appContext, {
    code,
    description: searchParam(params.error_description) ?? null,
    // The person at the browser: a staff member signed in as someone is recorded as themselves.
    userId: actor ? actingUserId(actor) : null,
  });

  return (
    <>
      <p className="max-w-sm text-base text-balance text-muted-foreground">
        {signInErrorMessage(t, code)}
      </p>
      <ErrorReference reference={reference} at={at} />
    </>
  );
}
