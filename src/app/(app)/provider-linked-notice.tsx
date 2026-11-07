/**
 * @file Says that a GitHub or Google account was just connected to the user's
 * Adiutor account because they signed in with it (Better Auth matched its
 * verified email), naming the account when its name is known. Shown on the
 * pages after that sign-in until dismissed, from a short-lived cookie set by
 * `afterAccountCreate` (read with `useNextPageCookie`).
 */
'use client';

import { clearNextPageCookie, useNextPageCookie } from '@/components/auth/use-next-page-cookie';
import Alert from '@/components/ui/alert';
import TextLink from '@/components/ui/text-link';
import {
  parseProviderLinkedCookie,
  PROVIDER_LABELS,
  PROVIDER_LINKED_COOKIE,
} from '@/lib/sign-in/oauth-providers';

/**
 * The notice: an info `Alert` with a link to the Security page and a dismiss
 * button, in a region named after the provider.
 *
 * @returns The notice, or nothing.
 */
export default function ProviderLinkedNotice() {
  const linked = parseProviderLinkedCookie(useNextPageCookie(PROVIDER_LINKED_COOKIE));
  if (!linked) {
    return null;
  }
  const { provider, accountName } = linked;
  const label = PROVIDER_LABELS[provider];

  /** Hides the notice by removing the cookie. */
  const dismiss = () => {
    clearNextPageCookie(PROVIDER_LINKED_COOKIE);
  };

  return (
    <section aria-label={`${label} connected`}>
      <Alert tone="info" onDismiss={dismiss} dismissLabel={`Dismiss the ${label} notice`}>
        <p>
          Your {label} account
          {accountName && (
            <>
              {' '}
              <span className="font-medium wrap-anywhere">{accountName}</span>
            </>
          )}{' '}
          is now connected to your Adiutor account, because you signed in with it. Not you?{' '}
          <TextLink href="/account/security">Disconnect it on the Security page</TextLink>.
        </p>
      </Alert>
    </section>
  );
}
