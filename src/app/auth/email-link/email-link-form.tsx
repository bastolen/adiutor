/**
 * @file The "Continue signing in" step of a sign-in email (see
 * `src/lib/sign-in/email-link.ts`): it names the account the link signs in to, and
 * only its click uses the link, so a mail scanner that opens it can't.
 */
'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';

import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import { useTransientState } from '@/components/ui/use-transient-state';
import { getSafeRedirectPath } from '@/lib/redirect';
import { MAGIC_LINK_VERIFY_PATH } from '@/lib/sign-in/email-link';

import AccountSummary, { accountLabel, type NamedAccount } from './account-summary';

/** Whoever is signed in in this browser, as the page names them. */
export interface SignedInAccount extends NamedAccount {
  /** Whether it's the account the link signs in to. */
  same: boolean;
}

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
 * Nothing to subscribe to: whether the page runs in the browser never
 * changes after hydration.
 *
 * @returns A no-op unsubscribe function.
 */
const noSubscription = () => () => {};

/**
 * Checks whether two accounts have the same name (anyone can give themselves
 * someone else's), ignoring case and surrounding spaces.
 *
 * @param first - One account.
 * @param second - The other.
 * @returns Whether both have a name, and it's the same.
 */
function sameName(first: NamedAccount, second: NamedAccount): boolean {
  const name = first.name.trim().toLowerCase();
  return name !== '' && name === second.name.trim().toLowerCase();
}

/**
 * Sends the link on to Better Auth with a plain form submit (a same-origin
 * navigation the user made, which the guards require), which signs in and
 * returns to the page the user came for. The form only gets the link's
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
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const token = searchParams.get('token') ?? '';
  const callbackURL = getSafeRedirectPath(searchParams.get('callbackURL'));
  const errorCallbackURL = searchParams.get('errorCallbackURL');
  const newUserCallbackURL = searchParams.get('newUserCallbackURL');
  let errorPage = `/auth?callbackURL=${encodeURIComponent(callbackURL)}`;
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

  useEffect(() => {
    /**
     * Makes the button usable again when the browser shows the page from its
     * back/forward cache (e.g. Back after signing in).
     *
     * @param event - The page being shown.
     */
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setPending(false);
      }
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, [setPending]);

  const icon = (
    <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
      <MailCheck aria-hidden="true" className="size-5" />
    </span>
  );

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
      <form method="get" action={MAGIC_LINK_VERIFY_PATH} onSubmit={() => setPending(true)}>
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
