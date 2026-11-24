/**
 * @file The "Continue signing in" step of a sign-in email (see
 * `src/lib/sign-in/email-link.ts`): it names the account the link signs in
 * to, and only its Continue, a form `POST`, uses the link, so a mail scanner
 * that opens it can't (decision 0041).
 */
'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import AccountSummary, {
  accountLabel,
  type NamedAccount,
  sameName,
  type SignedInAccount,
} from '@/components/auth/account-summary';
import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import IconTile from '@/components/ui/icon-tile';
import { usePageRestored } from '@/components/ui/use-page-restored';
import { useTransientState } from '@/components/ui/use-transient-state';
import useInBrowser from '@/lib/in-browser';
import { getSafeRedirectPath, signInPath } from '@/lib/redirect';
import { MAGIC_LINK_VERIFY_PATH } from '@/lib/sign-in/email-link';

/**
 * Props for {@link EmailLinkForm}.
 */
interface EmailLinkFormProps {
  /** The account the link signs in to. */
  account: NamedAccount;
  /** Whoever is signed in in this browser, or `null`. */
  signedIn: SignedInAccount | null;
}

/**
 * Posts the link to Better Auth's endpoint with a plain form `POST`, a
 * same-origin page load that only this page makes (a link, even one on a
 * page of this site, is always a `GET`), which the guards require: Safari
 * never says a person clicked, so they don't ask for that (decision 0041).
 * Better Auth signs in and returns to the page the user came for, with a
 * full page load. The form only gets the link's
 * token once it runs in the browser, so tools that only fetch the page find
 * no form that would use it. The return addresses get safe defaults: Better
 * Auth answers a link without one with JSON instead of a redirect. Better
 * Auth sends links that were used or expired meanwhile back to the sign-in
 * page with an error, or, when someone else is signed in in this browser,
 * back to this page: the sign-in page would send them on to that account
 * without the error.
 *
 * The account the link signs in to is shown first, with its full address
 * (names can be copied, addresses can't). When someone else is signed in in
 * this browser, the page says that continuing switches to the link's
 * account, and points out when both have the same name; when it's that
 * account already, it just goes on without using the link.
 *
 * @param props - Component props.
 * @param props.account - The account the link signs in to.
 * @param props.signedIn - Whoever is signed in in this browser.
 * @returns The form.
 */
export default function EmailLinkForm({ account, signedIn }: EmailLinkFormProps) {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const [pending, setPending] = useTransientState(false);
  const inBrowser = useInBrowser();
  const token = searchParams.get('token') ?? '';
  const callbackURL = getSafeRedirectPath(searchParams.get('callbackURL'));
  const errorCallbackURL = searchParams.get('errorCallbackURL');
  const newUserCallbackURL = searchParams.get('newUserCallbackURL');
  let errorPage = signInPath(callbackURL);
  if (signedIn && !signedIn.same) {
    // The sign-in page would send the browser on to the account that's still signed in.
    errorPage = `/auth/email-link?${new URLSearchParams({ token, callbackURL })}`;
  } else if (errorCallbackURL) {
    errorPage = getSafeRedirectPath(errorCallbackURL);
  }
  const fields = [
    { name: 'token', value: token },
    { name: 'callbackURL', value: callbackURL },
    { name: 'errorCallbackURL', value: errorPage },
    ...(newUserCallbackURL
      ? [{ name: 'newUserCallbackURL', value: getSafeRedirectPath(newUserCallbackURL) }]
      : []),
  ];

  // Makes the button usable again when the browser shows the page from its
  // back/forward cache (e.g. Back after signing in).
  usePageRestored(() => setPending(false));

  const icon = <IconTile icon={MailCheck} size="lg" />;

  if (signedIn?.same) {
    return (
      <div className="flex flex-col gap-6">
        {icon}
        <AuthHeading
          title={t('emailLink.alreadySignedIn')}
          description={t('emailLink.alreadySignedInDescription')}
        />
        <AccountSummary {...account} />
        <Button fullWidth asChild>
          <Link href={callbackURL}>{t('emailLink.continue')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {icon}
      <AuthHeading title={t('emailLink.heading')} description={t('emailLink.description')} />
      <AccountSummary {...account} />
      {signedIn && (
        <Alert tone="info">
          {t('emailLink.switching', {
            signedIn: accountLabel(signedIn),
            account: accountLabel(account),
            sameName: sameName(signedIn, account) ? 'true' : 'false',
          })}
        </Alert>
      )}
      <form method="post" action={MAGIC_LINK_VERIFY_PATH} onSubmit={() => setPending(true)}>
        {inBrowser &&
          fields.map(({ name, value }) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        <Button type="submit" fullWidth loading={pending} disabled={!inBrowser}>
          {t('emailLink.submit')}
        </Button>
      </form>
    </div>
  );
}
