/**
 * @file The Continue step of the link in an email about a request (decision
 * 0036): it names the account the link signs in to and the request it
 * opens, and only its Continue signs in, so a mail scanner that only fetches
 * the link gets no session. Continue is a form `POST`, which no link can
 * send. With nobody signed in in this browser, Continue goes by itself once
 * the page has loaded (decision 0038), since some browsers (Safari) never
 * say a person clicked the email's link.
 */
'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useSyncExternalStore } from 'react';

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
import useInBrowser, { noSubscription } from '@/lib/in-browser';
import { sectionFromHash } from '@/lib/redirect';
import { ENTRY_PARAM, isEntryId } from '@/lib/requests';
import { REQUEST_LINK_URL_PATH } from '@/lib/sign-in/request-link';

/** Props for {@link RequestLinkForm}. */
interface RequestLinkFormProps {
  /** The account the link signs in to. */
  account: NamedAccount;
  /**
   * Whether Continue goes by itself once the page has loaded: a link that can be used, with
   * nobody signed in in this browser, whose Continue didn't come back to the page already.
   */
  continueByItself: boolean;
  /** The request it opens, as people see its number, e.g. "AD-142". */
  reference: string;
  /** The request's page, naming the entry the link points at (`?entry=`), if any. */
  requestHref: string;
  /** Whoever is signed in in this browser, or `null`. */
  signedIn: SignedInAccount | null;
}

/**
 * Whether Continue went by itself in this page load. It lives outside React,
 * so it holds however often the form mounts: a page kept alive in
 * `<Activity>` runs its effects again when it's shown, React's Strict Mode
 * runs them twice, and the back/forward cache brings the page back as it
 * was. Only a new page load starts afresh, and only one the browser opened
 * fresh goes by itself ({@link openedFresh}).
 */
let continuedByItself = false;

/**
 * Checks whether the browser opened this page fresh (from a link, a redirect
 * or a typed address), not with Back or Forward or a reload: coming back to
 * the page is never a reason to sign in again. A browser that can't tell
 * counts as not.
 *
 * @returns Whether the page load was a fresh navigation.
 */
function openedFresh(): boolean {
  const [navigation] = performance.getEntriesByType('navigation');
  return navigation !== undefined && 'type' in navigation && navigation.type === 'navigate';
}

/**
 * Checks whether the browser is preparing the page before anyone opened it
 * (prerendering, e.g. for an address it guesses while one is being typed).
 *
 * @returns Whether the page is being prerendered.
 */
function prerendering(): boolean {
  return 'prerendering' in document && document.prerendering === true;
}

/**
 * Sends the link back to Better Auth's endpoint with a plain form `POST`, a
 * same-origin navigation the user made, which only this page's Continue
 * makes (a link, even one on a page of this site, is always a `GET`), so it
 * may switch from someone else signed in here. The form only gets the
 * link's token once it runs in the browser, so tools that only fetch the
 * page find no form that would use it. The email's link may point at a part
 * of the request (`#…`): the browser kept it on this page's address, and the
 * form's address passes it on, when it names a section, so the request opens
 * there.
 *
 * With nobody signed in in this browser (`continueByItself`), the form
 * sends itself once the page has loaded (decision 0038): Safari never says a
 * person clicked the email's link, so the link always comes here there. It
 * does so once per page load, only for a page the browser opened fresh (not
 * Back, Forward or a reload), and only once the page is shown, not while the
 * browser prerenders it; Continue shows as busy meanwhile. It's marked as
 * sent by itself (`auto=1`, through a hidden submit button), so it never
 * switches from someone who signed in in another tab after the page was
 * rendered. If the server sends it back here, the page waits for a click
 * (`retry`). When someone else
 * is signed in in this browser, the page says that continuing switches to the
 * link's account, and points out when both have the same name, and waits for
 * a click; when it's that account already, it just opens the request.
 */
export default function RequestLinkForm({
  account,
  continueByItself,
  reference,
  requestHref,
  signedIn,
}: RequestLinkFormProps) {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const [pending, setPending] = useTransientState(false);
  const inBrowser = useInBrowser();
  // The page's fragment doesn't change while it's open.
  const section = useSyncExternalStore(
    noSubscription,
    () => sectionFromHash(window.location.hash),
    () => null,
  );
  const token = searchParams.get('token') ?? '';
  // The entry the link points at: Continue passes it on to the request.
  const entry = searchParams.get(ENTRY_PARAM);
  const anchor = section ? `#${section}` : '';

  const form = useRef<HTMLFormElement>(null);
  // Sends Continue when the page sends it by itself, marked so (`auto=1`): the server never lets
  // that one switch from someone signed in meanwhile (a page prerendered before a sign-in).
  const autoSubmitter = useRef<HTMLInputElement>(null);
  // Whether to send Continue by itself: once the form has the link, which it only gets in the
  // browser, and never while someone is signed in here.
  const goesByItself = continueByItself && signedIn === null && inBrowser && token !== '';

  // Makes the button usable again when the browser shows the page from its
  // back/forward cache (e.g. Back after signing in).
  usePageRestored(() => setPending(false));

  useEffect(() => {
    const shown = form.current;
    const submitter = autoSubmitter.current;
    // A browser without `requestSubmit` (before 2022) keeps the button.
    if (!goesByItself || continuedByItself || !shown || !submitter || !('requestSubmit' in shown)) {
      return undefined;
    }
    if (!openedFresh()) {
      return undefined;
    }
    /** Sends Continue, marked as sent by itself, which marks the button busy. */
    const send = () => {
      continuedByItself = true;
      shown.requestSubmit(submitter);
    };
    if (prerendering()) {
      document.addEventListener('prerenderingchange', send, { once: true });
      return () => document.removeEventListener('prerenderingchange', send);
    }
    send();
    return undefined;
  }, [goesByItself]);

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
        ref={form}
        method="post"
        action={`${REQUEST_LINK_URL_PATH}${anchor}`}
        onSubmit={() => setPending(true)}
      >
        {inBrowser && (
          <>
            <input type="hidden" name="token" value={token} />
            {isEntryId(entry) && <input type="hidden" name={ENTRY_PARAM} value={entry} />}
          </>
        )}
        {goesByItself && (
          <input ref={autoSubmitter} type="submit" name="auto" value="1" hidden tabIndex={-1} />
        )}
        <Button type="submit" fullWidth loading={pending} disabled={!inBrowser}>
          {t('requestLink.submit', { reference })}
        </Button>
      </form>
    </div>
  );
}
