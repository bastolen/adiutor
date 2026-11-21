/**
 * @file The Continue step of the link in an email about a request (decision
 * 0036): it names the account the link signs in to and the request it
 * opens, and only its click signs in, so a mail scanner that opens the link
 * gets no session.
 */
'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import AccountSummary, { accountLabel, type NamedAccount } from '@/components/auth/account-summary';
import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import IconTile from '@/components/ui/icon-tile';
import { usePageRestored } from '@/components/ui/use-page-restored';
import { useTransientState } from '@/components/ui/use-transient-state';
import { sectionFromHash } from '@/lib/redirect';
import { REQUEST_LINK_CONFIRMED_PARAM, REQUEST_LINK_URL_PATH } from '@/lib/sign-in/request-link';

/** Whoever is signed in in this browser, as the page names them. */
export interface SignedInAccount extends NamedAccount {
  /** Whether it's the account the link signs in to. */
  same: boolean;
}

/** Props for {@link RequestLinkForm}. */
interface RequestLinkFormProps {
  /** The account the link signs in to. */
  account: NamedAccount;
  /** The request it opens, as people see its number, e.g. "AD-142". */
  reference: string;
  /** The request's page. */
  requestHref: string;
  /** Whoever is signed in in this browser, or `null`. */
  signedIn: SignedInAccount | null;
}

/**
 * Nothing to subscribe to: the page's fragment and whether it runs in the
 * browser don't change while it's open.
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
 * Sends the link back to Better Auth's endpoint with a plain form submit, a
 * same-origin navigation the user made, marked as this page's Continue
 * ({@link REQUEST_LINK_CONFIRMED_PARAM}), which may switch from someone else
 * signed in here. The form only gets the link's token once it runs in the
 * browser, so tools that only fetch the page find no form that would use
 * it. The email's link may point at a part of the request (`#…`): the
 * browser kept it on this page's address, and the form's address passes it
 * on, when it names a section, so the request opens there.
 *
 * When someone else is signed in in this browser, the page says that
 * continuing switches to the link's account, and points out when both have
 * the same name; when it's that account already, it just opens the request.
 *
 * @param props - Component props.
 * @param props.account - The account the link signs in to.
 * @param props.reference - The request's number as people see it.
 * @param props.requestHref - The request's page.
 * @param props.signedIn - Whoever is signed in in this browser.
 * @returns The form.
 */
export default function RequestLinkForm({
  account,
  reference,
  requestHref,
  signedIn,
}: RequestLinkFormProps) {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const [pending, setPending] = useTransientState(false);
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const section = useSyncExternalStore(
    noSubscription,
    () => sectionFromHash(window.location.hash),
    () => null,
  );
  const token = searchParams.get('token') ?? '';
  const anchor = section ? `#${section}` : '';

  // Makes the button usable again when the browser shows the page from its
  // back/forward cache (e.g. Back after signing in).
  usePageRestored(() => setPending(false));

  const icon = <IconTile icon={MailCheck} size="lg" />;

  if (signedIn?.same) {
    return (
      <div className="flex flex-col gap-6">
        {icon}
        <AuthHeading
          title={t('requestLink.alreadySignedIn')}
          description={t('requestLink.alreadySignedInDescription', { reference })}
        />
        <AccountSummary {...account} />
        <Button fullWidth asChild>
          <Link href={`${requestHref}${anchor}`}>{t('requestLink.open', { reference })}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {icon}
      <AuthHeading
        title={t('requestLink.heading', { reference })}
        description={t('requestLink.description', { reference })}
      />
      <AccountSummary {...account} />
      {signedIn && (
        <Alert tone="info">
          {t('requestLink.switching', {
            signedIn: accountLabel(signedIn),
            account: accountLabel(account),
            sameName: sameName(signedIn, account) ? 'true' : 'false',
          })}
        </Alert>
      )}
      <form
        method="get"
        action={`${REQUEST_LINK_URL_PATH}${anchor}`}
        onSubmit={() => setPending(true)}
      >
        {inBrowser && (
          <>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name={REQUEST_LINK_CONFIRMED_PARAM} value="1" />
          </>
        )}
        <Button type="submit" fullWidth loading={pending} disabled={!inBrowser}>
          {t('requestLink.submit', { reference })}
        </Button>
      </form>
    </div>
  );
}
